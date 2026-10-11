// Utilitários do "Assistir juntos" (sem React) — usados pelo palco e pelo navegador.
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeId(input) {
  const s = String(input || '').trim();
  if (ID_RE.test(s)) return s;
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '').toLowerCase();
  let id = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else id = u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/)?.[2] || null;
  }
  return id && ID_RE.test(id) ? id : null;
}

export const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

// App desktop com <webview> liberado (main.js webviewTag) → mostra a aba "YouTube completo".
export function canUseWebview() {
  if (typeof window === 'undefined' || !window.electronAPI) return false;
  try {
    if (window.customElements?.get?.('webview')) return true;
    return !(document.createElement('webview') instanceof HTMLUnknownElement);
  } catch { return false; }
}

// Legendas: preferência do usuário (padrão: desligadas, inclusive as
// automáticas). O player do YouTube aplica via módulo "captions".
const CC_KEY = 'pc.yt.captions';
export function readCaptionsPref() {
  try { return localStorage.getItem(CC_KEY) === 'on'; } catch { return false; }
}
export function writeCaptionsPref(on) {
  try { localStorage.setItem(CC_KEY, on ? 'on' : 'off'); } catch { /* sem storage */ }
}
export function applyCaptions(player, on) {
  if (!player) return;
  try {
    if (on) {
      player.loadModule?.('captions');
      player.setOption?.('captions', 'track', { languageCode: 'pt' });
    } else {
      player.setOption?.('captions', 'track', {});
      player.unloadModule?.('captions');
    }
  } catch { /* módulo ainda não carregado */ }
}
