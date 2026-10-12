// Navegador do Project Club: interpretar o que foi digitado na barra,
// buscadores e páginas internas (pc://).

export const nativeBrowser = () => {
  const b = typeof window !== 'undefined' ? window.electronAPI?.browser : null;
  return b && b.version >= 1 ? b : null;
};

// Modo offline: o app desktop abriu a cópia embutida do navegador porque o
// servidor do Project Club não respondeu (pcapp://). Sem chat/amigos ali.
export const isOfflineMode = () => typeof window !== 'undefined' && window.location.protocol === 'pcapp:';

export const SEARCH_ENGINES = {
  ddg: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?kl=br-pt&q=', home: 'https://duckduckgo.com' },
  google: { name: 'Google', url: 'https://www.google.com/search?hl=pt-BR&q=', home: 'https://www.google.com' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=', home: 'https://search.brave.com' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?setlang=pt-BR&q=', home: 'https://www.bing.com' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?language=portuguese&query=', home: 'https://www.startpage.com' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=', home: 'https://www.ecosia.org' },
};

export const INTERNAL = {
  'pc://nova-aba': 'Nova aba',
  'pc://historico': 'Histórico',
  'pc://favoritos': 'Favoritos',
  'pc://downloads': 'Downloads',
  'pc://senhas': 'Senhas salvas',
  'pc://config': 'Configurações do navegador',
};
export const NEW_TAB = 'pc://nova-aba';
export const isInternal = (url) => String(url || '').startsWith('pc://');

const TLD_RE = /\.[a-z]{2,24}$/i;
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;

// "youtube.com" → https://youtube.com ; "gatos fofos" → busca ; "pc://x" → interna.
export function toUrl(input, engine = 'ddg') {
  const text = String(input || '').trim();
  if (!text) return null;
  if (isInternal(text)) return INTERNAL[text.replace(/\/$/, '')] ? text.replace(/\/$/, '') : NEW_TAB;
  if (/^(https?|view-source):/i.test(text)) return text;
  if (/^(about|chrome|file|javascript|data|vbscript):/i.test(text)) return searchUrl(text, engine);
  if (!/\s/.test(text)) {
    const hostPart = text.split(/[/?#]/)[0];
    const host = hostPart.replace(/:\d+$/, '');
    if (/^localhost$/i.test(host) || IP_RE.test(hostPart)) return `http://${text}`;
    if (TLD_RE.test(host) && /^[a-z0-9.-]+$/i.test(host) && !host.startsWith('.')) return `https://${text}`;
  }
  return searchUrl(text, engine);
}

export const searchUrl = (q, engine = 'ddg') => (SEARCH_ENGINES[engine] || SEARCH_ENGINES.ddg).url + encodeURIComponent(q);

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// O que mostrar na barra de endereço quando ela não está em foco.
export function displayUrl(url) {
  if (!url || url === NEW_TAB) return '';
  if (isInternal(url)) return url;
  try {
    const u = new URL(url);
    const path = `${u.pathname === '/' ? '' : decodeURIComponent(u.pathname)}${u.search}${u.hash}`;
    return `${u.host.replace(/^www\./, '')}${path}`;
  } catch { return url; }
}

// Busca feita no buscador? Mostra o termo em vez da URL enorme.
export function searchTermOf(url) {
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (/duckduckgo\.com$/.test(h) || /google\.[a-z.]+$/.test(h) || /bing\.com$/.test(h) || /search\.brave\.com$/.test(h) || /ecosia\.org$/.test(h)) return u.searchParams.get('q') || '';
    if (/startpage\.com$/.test(h)) return u.searchParams.get('query') || '';
  } catch { /* não é URL */ }
  return '';
}

export const faviconFor = (url) => {
  const h = hostOf(url);
  return h ? `https://icons.duckduckgo.com/ip3/${h}.ico` : null;
};

export const isYouTubeWatch = (url) => {
  try {
    const u = new URL(url);
    if (/(^|\.)youtube\.com$/.test(u.hostname) && u.pathname === '/watch') return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12);
  } catch { /* não é URL */ }
  return null;
};

export const PERMISSION_TEXT = {
  media: (extra) => (/video/.test(extra) && /audio/.test(extra) ? 'usar sua câmera e seu microfone' : /video/.test(extra) ? 'usar sua câmera' : 'usar seu microfone'),
  geolocation: () => 'saber sua localização',
  notifications: () => 'mostrar notificações',
  'clipboard-read': () => 'ler sua área de transferência',
  'display-capture': () => 'compartilhar sua tela',
  midi: () => 'usar dispositivos MIDI',
  midiSysex: () => 'controlar dispositivos MIDI',
  'idle-detection': () => 'saber quando você está ausente',
  'storage-access': () => 'usar cookies dentro de outro site',
  'top-level-storage-access': () => 'usar cookies dentro de outro site',
  openExternal: (extra) => `abrir ${String(extra).split(':')[0] === 'mailto' ? 'seu e-mail' : `o aplicativo "${String(extra).split(':')[0]}"`}`,
  keyboardLock: () => 'capturar o teclado',
};

export function fmtBytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
