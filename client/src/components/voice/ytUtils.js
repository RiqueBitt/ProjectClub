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

// "t=1m30s", "t=90", "start=90" → segundos (0 quando não tem/é inválido).
export function parseYouTubeStart(input) {
  let u;
  try { u = new URL(String(input || '')); } catch { return 0; }
  const raw = u.searchParams.get('t') || u.searchParams.get('start') || (u.hash.match(/t=([^&]+)/)?.[1] ?? '');
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Math.min(Number(raw), 86400);
  const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return 0;
  return Math.min((Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0), 86400);
}

// Primeiro link de vídeo do YouTube num texto (youtube.com/watch,
// youtu.be, /shorts, /live, m.youtube…). Devolve { id, url, start, isShort }
// ou null.
const LINK_RE = /\bhttps?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?)\]]/gi;
export function findYouTubeLink(content) {
  const text = String(content || '');
  if (!/youtu/i.test(text)) return null;
  for (const m of text.matchAll(LINK_RE)) {
    const url = m[0];
    let host = '';
    try { host = new URL(url).hostname.replace(/^(www\.|m\.|music\.)/, '').toLowerCase(); } catch { continue; }
    if (host !== 'youtube.com' && host !== 'youtu.be' && host !== 'youtube-nocookie.com') continue;
    const id = parseYouTubeId(url);
    if (!id) continue;
    return { id, url, start: parseYouTubeStart(url), isShort: /\/shorts\//i.test(url) };
  }
  return null;
}

// Endereço do player embutido (sem cookies) que já começa tocando.
export function youTubeEmbedUrl(id, { start = 0, origin = '', captions = false } = {}) {
  const p = new URLSearchParams({ autoplay: '1', rel: '0', modestbranding: '1', playsinline: '1', hl: 'pt-BR', cc_lang_pref: 'pt' });
  if (start > 0) p.set('start', String(Math.floor(start)));
  if (captions) p.set('cc_load_policy', '1');
  if (origin) p.set('origin', origin);
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${p.toString()}`;
}

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
