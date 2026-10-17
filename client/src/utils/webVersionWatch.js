// "Nova versão disponível" (só no site, no navegador).
//
// O build grava dist/version.json com a versão do conteúdo (vite.config.js
// → { web: "2026.10.16-1432-abc1234" }) e a mesma versão vai embutida no
// JS (__WEB_VERSION__). De tempos em tempos (e ao voltar pra aba) o site
// pergunta a versão publicada; se mudou, avisa com um aviso discreto em vez
// de deixar a pessoa numa versão velha até um pedaço (chunk) falhar.
//
// Desktop (Electron) e Android têm o próprio atualizador (ver
// nativeUpdateCheck.js) — lá isso não roda.

export const POLL_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 60 * 1000; // foco/visibilidade não pergunta mais que 1x por minuto
const DISMISS_KEY = 'pc-update-dismissed';

// Versão publicada é diferente (e válida) da que está rodando?
export function isDifferentWebVersion(loaded, remote) {
  const a = typeof loaded === 'string' ? loaded.trim() : '';
  const b = typeof remote === 'string' ? remote.trim() : '';
  if (!a || !b) return false;
  if (b.length > 80 || !/^[\w.:+-]+$/.test(b)) return false;
  return a !== b;
}

// Lê a versão do corpo do version.json (tolerante a lixo).
export function parseVersionPayload(body) {
  if (!body || typeof body !== 'object') return null;
  return typeof body.web === 'string' ? body.web : null;
}

export function readDismissed() {
  try { return sessionStorage.getItem(DISMISS_KEY) || null; } catch { return null; }
}
export function writeDismissed(version) {
  try { sessionStorage.setItem(DISMISS_KEY, version); } catch { /* sem storage */ }
}

export async function fetchPublishedVersion(fetchImpl = typeof fetch !== 'undefined' ? fetch : null) {
  if (!fetchImpl) return null;
  try {
    const r = await fetchImpl(`/version.json?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' });
    if (!r.ok) return null; // 502 durante o deploy etc.: tenta na próxima
    return parseVersionPayload(await r.json());
  } catch {
    return null;
  }
}

// Começa a vigiar. `onNewVersion(version)` é chamado quando a versão
// publicada difere da carregada. Devolve a função de parar.
export function watchWebVersion({ loaded, onNewVersion, pollMs = POLL_MS }) {
  if (typeof window === 'undefined' || !loaded) return () => {};
  let stopped = false;
  let lastCheck = 0;
  let announced = null;
  const check = async () => {
    if (stopped || Date.now() - lastCheck < MIN_GAP_MS) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    lastCheck = Date.now();
    const remote = await fetchPublishedVersion();
    if (stopped || !isDifferentWebVersion(loaded, remote) || remote === announced) return;
    announced = remote;
    onNewVersion(remote);
  };
  const timer = setInterval(check, pollMs);
  const onVisible = () => { if (document.visibilityState === 'visible') check(); };
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', onVisible);
  // Primeira checagem depois que o app já abriu (não disputa com a abertura).
  const first = setTimeout(check, 30 * 1000);
  return () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(first);
    window.removeEventListener('focus', check);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
