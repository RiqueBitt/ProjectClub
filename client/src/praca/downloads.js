// Centro de Download do Club Penguin: pacotes por categoria (evento, jogo
// base, minigames, iglus, festas 2013-2017, roupas…).
//
// Servidor: GET /api/plaza/packs (lista), /packs/:id/stream?from=N (fluxo no
// mesmo formato do instalador) e /packs/:id/urls (pra apagar do cache).
// O progresso de cada pacote fica no localStorage (pc.dl.<id>): pausar e
// voltar continua do arquivo em que parou.
import { api } from '../api/client.js';
import { GAME_CACHE, installPack, installFiles } from './installer.js';

const KEY = (id) => `pc.dl.${id}`;

export function readPackState(id) {
  try { return JSON.parse(localStorage.getItem(KEY(id)) || 'null'); } catch { return null; }
}
function writePackState(id, st) {
  try { if (st) localStorage.setItem(KEY(id), JSON.stringify(st)); else localStorage.removeItem(KEY(id)); } catch { /* ok */ }
}

/** Estado de um pacote: 'done' | 'partial' | 'none', mais quantos arquivos já vieram. */
export function packStatus(pack, extraDone = false) {
  const st = readPackState(pack.id);
  if (st && st.version === pack.version && st.done) return { state: 'done', doneFiles: pack.files, bytes: pack.bytes };
  if (extraDone && !st) return { state: 'done', doneFiles: pack.files, bytes: pack.bytes };
  if (st && st.version === pack.version && st.doneFiles > 0) return { state: 'partial', doneFiles: st.doneFiles, bytes: st.bytes || 0 };
  return { state: 'none', doneFiles: 0, bytes: 0 };
}

export async function fetchPacks() {
  const { data } = await api.get('/plaza/packs');
  return data;
}

/**
 * Baixa (ou continua) um pacote. `useCache`: grava no Cache Storage (servido
 * pelo service worker); sem ele, baixa arquivo a arquivo pro cache HTTP.
 */
export async function downloadPack(pack, { useCache, signal, onProgress = () => {} }) {
  const prev = packStatus(pack);
  const from = prev.state === 'partial' ? prev.doneFiles : 0;
  const baseBytes = prev.state === 'partial' ? prev.bytes : 0;
  let last = 0;
  const save = (doneFiles, bytes, done) => writePackState(pack.id, { version: pack.version, doneFiles, bytes, done: !!done, at: Date.now() });
  const progress = (p) => {
    const doneFiles = from + (p.doneFiles || 0);
    const bytes = baseBytes + (p.bytes || 0);
    onProgress({ doneFiles, bytes, ratio: pack.bytes ? Math.min(1, bytes / pack.bytes) : doneFiles / Math.max(1, pack.files) });
    const now = Date.now();
    if (now - last > 1000) { last = now; save(doneFiles, bytes, false); }
  };
  if (useCache) {
    await installPack({ url: `/api/plaza/packs/${encodeURIComponent(pack.id)}/stream?from=${from}`, bytes: pack.bytes - baseBytes, files: pack.files - from }, { signal, onProgress: progress });
  } else {
    const { data } = await api.get(`/plaza/packs/${encodeURIComponent(pack.id)}/urls`);
    const files = data.urls.slice(from).map((url) => ({ url, size: 0 }));
    await installFiles(files, { signal, onProgress: (p) => progress({ doneFiles: p.doneFiles, bytes: pack.bytes ? Math.round((p.doneFiles / Math.max(1, pack.files)) * pack.bytes) : 0 }) });
  }
  if (signal?.aborted) throw new DOMException('abort', 'AbortError');
  save(pack.files, pack.bytes, true);
}

/** Apaga um pacote do cache do jogo (os arquivos voltam a vir da rede). */
export async function deletePack(pack) {
  writePackState(pack.id, null);
  try {
    const { data } = await api.get(`/plaza/packs/${encodeURIComponent(pack.id)}/urls`);
    const cache = await caches.open(GAME_CACHE);
    for (let i = 0; i < data.urls.length; i += 200) {
      await Promise.all(data.urls.slice(i, i + 200).map((u) => cache.delete(new URL(u, window.location.origin).href).catch(() => false)));
    }
  } catch { /* sem cache: nada a apagar */ }
}

export const fmtSize = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1048576).toFixed(b >= 1048576 * 100 ? 0 : 2)}M`);
