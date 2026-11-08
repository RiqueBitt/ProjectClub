// Instalar como app (PWA) pelo navegador.
//
// O Chrome/Edge/Samsung Internet disparam `beforeinstallprompt` quando o site
// cumpre os critérios (manifest + service worker + HTTPS). Guardamos o evento
// e deixamos a pessoa decidir: botão em Configurações → Sistema, e um aviso
// discreto (uma vez só) depois de alguns usos. No iOS não existe o evento —
// mostramos a dica "Compartilhar → Adicionar à Tela de Início".
let deferredPrompt = null;
const listeners = new Set();

function notify() { for (const fn of listeners) { try { fn(getInstallState()); } catch { /* ok */ } } }

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
    || new URLSearchParams(window.location.search).get('source') === 'pwa';
}

export function isIosSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/crios|fxios/i.test(ua);
}

export function getInstallState() {
  if (typeof window === 'undefined') return 'unsupported';
  if (window.electronAPI) return 'unsupported';
  try { if (window.Capacitor?.isNativePlatform?.()) return 'unsupported'; } catch { /* ok */ }
  if (isStandalone()) return 'installed';
  if (deferredPrompt) return 'available';
  if (isIosSafari()) return 'ios';
  return 'unavailable';
}

export function onInstallStateChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let wired = false;
export function setupPwaInstall() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
    maybeSuggest();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    try { localStorage.setItem('pc:pwa-installed', '1'); } catch { /* ok */ }
    notify();
  });
}

export async function promptInstall() {
  if (!deferredPrompt) return { outcome: 'unavailable' };
  const ev = deferredPrompt;
  deferredPrompt = null;
  notify();
  try {
    ev.prompt();
    const choice = await ev.userChoice;
    return { outcome: choice?.outcome || 'dismissed' };
  } catch { return { outcome: 'error' }; }
}

// Sugestão discreta: só no 3º uso em diante, uma vez a cada 14 dias, só se
// a pessoa não recusou. Usa o toast padrão do app com o botão "Instalar".
let suggestHandler = null;
export function setInstallSuggestHandler(fn) { suggestHandler = fn; }
function maybeSuggest() {
  try {
    const visits = Number(localStorage.getItem('pc:visits') || 0);
    const last = Number(localStorage.getItem('pc:pwa-suggested-at') || 0);
    if (visits < 3 || Date.now() - last < 14 * 86400000) return;
    localStorage.setItem('pc:pwa-suggested-at', String(Date.now()));
  } catch { return; }
  suggestHandler?.();
}
export function countVisit() {
  try { localStorage.setItem('pc:visits', String(Number(localStorage.getItem('pc:visits') || 0) + 1)); } catch { /* ok */ }
}
