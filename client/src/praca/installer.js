// Instalação do Club Penguin no navegador.
//
// O jogo é um monte de arquivos Flash que o Ruffle pede um a um; abrir
// tudo pela rede a cada visita é lento. Aqui o jogo COMPLETO (2012) é
// baixado uma vez, num único fluxo ("pacote"), e gravado no Cache Storage
// (pc-praca). O service worker (public/sw.js) serve /play/… e /playstart/…
// direto de lá: o jogo roda inteiro do navegador.
//
// Formato do pacote (servidor: services/waddle streamPack): repetido
//   [4 bytes BE: tamanho do cabeçalho][cabeçalho JSON {u,s,t}][s bytes]
//
// Sem Cache Storage/service worker (app nativo, navegador antigo), cai no
// modo simples: baixa a lista de arquivos um a um, que ficam no cache HTTP.

import { getAccessToken, refreshAccessToken } from '../api/client.js';

export const GAME_CACHE = 'pc-praca';
const CONCURRENCY = 6;

/** Cache Storage + service worker controlando a página? (pede registro se preciso) */
export async function gameCacheReady() {
  if (typeof window === 'undefined' || !('caches' in window) || !('serviceWorker' in navigator)) return false;
  // nunca segura a página: se o worker não assumir em alguns segundos, modo simples
  return Promise.race([gameCacheReadyInner(), new Promise((r) => setTimeout(() => r(false), 8000))]);
}

// Registra o service worker do site também no app de desktop (Electron) e no
// Android: lá o push é nativo (utils/webPush não registra), mas o cache do
// jogo precisa do worker do mesmo jeito.
async function ensureGameServiceWorker() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    const mine = regs.find((r) => (r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || '').endsWith('/sw.js'));
    if (mine) { mine.update().catch(() => {}); return mine; } // pega versão nova do worker
    return await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  } catch (err) {
    console.warn('[praca] service worker indisponível:', err?.message || err);
    return null;
  }
}

async function gameCacheReadyInner() {
  try {
    const reg = await ensureGameServiceWorker();
    if (!reg) return false;
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      // o worker novo assume a página com clients.claim(); espera um pouco
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 4000);
        navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); resolve(); }, { once: true });
      });
    }
    if (!navigator.serviceWorker.controller) return false;
    // Armazenamento persistente: no Firefox isso abre um PEDIDO de permissão
    // e a promessa só resolve quando a pessoa responde — por isso não se
    // espera por ela (o cache funciona do mesmo jeito sem a permissão).
    try { navigator.storage?.persist?.().catch(() => {}); } catch { /* ok */ }
    return true;
  } catch {
    return false;
  }
}

export async function clearGameCache() {
  try { await caches.delete(GAME_CACHE); } catch { /* ok */ }
}

/** Quantos bytes já estão no cache do jogo (aproximado, pela estimativa do navegador). */
export async function gameCacheUsage() {
  try { const est = await navigator.storage?.estimate?.(); return est?.usage || 0; } catch { return 0; }
}

/**
 * Baixa um pacote num fluxo só e grava cada arquivo no cache. `onProgress`
 * recebe {ratio, bytes, total, files, doneFiles}. Lança se a rede falhar
 * (quem chama tenta de novo).
 */
export async function installPack(pack, { signal, onProgress = () => {} } = {}) {
  const cache = await caches.open(GAME_CACHE);
  const headers = () => { const t = getAccessToken(); return t ? { Authorization: `Bearer ${t}` } : {}; };
  let res = await fetch(pack.url, { signal, credentials: 'same-origin', cache: 'no-store', headers: headers() });
  if (res.status === 401) { await refreshAccessToken().catch(() => null); res = await fetch(pack.url, { signal, credentials: 'same-origin', cache: 'no-store', headers: headers() }); }
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('X-Pack-Bytes')) || pack.bytes || 0;
  const files = Number(res.headers.get('X-Pack-Files')) || pack.files || 0;
  const reader = res.body.getReader();
  let buf = new Uint8Array(0);
  let bytes = 0; let doneFiles = 0; let lastReport = 0;
  const report = (force) => {
    const now = performance.now();
    if (!force && now - lastReport < 150) return;
    lastReport = now;
    onProgress({ ratio: total ? Math.min(1, bytes / total) : (files ? doneFiles / files : 0), bytes, total, files, doneFiles });
  };
  const append = (chunk) => {
    const next = new Uint8Array(buf.length + chunk.length);
    next.set(buf, 0); next.set(chunk, buf.length);
    buf = next;
  };
  const puts = [];
  let done = false;
  while (!done) {
    const { value, done: end } = await reader.read();
    if (end) { done = true; } else { append(value); }
    // consome todos os arquivos completos que já estão no buffer
    let off = 0;
    for (;;) {
      if (buf.length - off < 4) break;
      const hlen = new DataView(buf.buffer, buf.byteOffset + off, 4).getUint32(0);
      if (buf.length - off < 4 + hlen) break;
      const head = JSON.parse(new TextDecoder().decode(buf.subarray(off + 4, off + 4 + hlen)));
      if (buf.length - off < 4 + hlen + head.s) break;
      const body = buf.slice(off + 4 + hlen, off + 4 + hlen + head.s);
      off += 4 + hlen + head.s;
      const url = new URL(head.u, window.location.origin).href;
      puts.push(cache.put(url, new Response(body, { headers: { 'Content-Type': head.t || 'application/octet-stream', 'Content-Length': String(head.s), 'Cache-Control': 'public, max-age=2592000, immutable' } })).catch(() => {}));
      if (puts.length >= 64) { await Promise.all(puts.splice(0)); }
      bytes += head.s; doneFiles += 1; report(false);
    }
    if (off > 0) buf = buf.slice(off);
    if (signal?.aborted) throw new DOMException('abort', 'AbortError');
  }
  await Promise.all(puts);
  report(true);
  return { bytes, doneFiles };
}

/**
 * Modo simples (sem Cache Storage): baixa cada arquivo com as mesmas URLs
 * que o jogo usa; ficam no cache HTTP (30 dias). Falha de um arquivo não
 * derruba o resto.
 */
export async function installFiles(files, { signal, onProgress = () => {} } = {}) {
  const total = files.reduce((n, f) => n + (f.size || 0), 0);
  let bytes = 0; let doneFiles = 0; let failed = 0;
  const queue = files.slice();
  const report = () => onProgress({ ratio: total ? Math.min(1, bytes / total) : doneFiles / Math.max(1, files.length), doneFiles, files: files.length, bytes, total });
  const worker = async () => {
    while (queue.length) {
      if (signal?.aborted) return;
      const f = queue.shift();
      try {
        const res = await fetch(f.url, { signal, credentials: 'same-origin', cache: 'default' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await res.arrayBuffer();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        failed += 1;
      }
      bytes += f.size || 0; doneFiles += 1; report();
    }
  };
  report();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  return { failed };
}
