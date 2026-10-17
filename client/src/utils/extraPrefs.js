// Preferências extras (trazidas do Discord): temas coloridos, ícone do app,
// modo streamer, sons, avisos, acessibilidade fina, voz e privacidade.
// Ficam em UserSettings.extraPrefs (servidor valida cada chave — ver
// server/src/controllers/settingsController.js) com cópia local pra
// aplicar na hora, antes da conta carregar.
import { useStore } from '../store/useStore';
import { updateUserSettings } from '../api/endpoints';
import { trackSave } from './saveIndicator';
import { browserTimeZone } from './notificationLevels';

export const EXTRA_DEFAULTS = Object.freeze({
  colorTheme: 'none',
  customTheme: { colors: ['#5b21b6', '#1e3a8a'], angle: 135, accent: '#8b5cf6', mix: 55 },
  themeSync: true,
  cacheMessages: true,
  themeOnProfiles: true,
  appIcon: 'default',
  streamerMode: false,
  streamerHidePersonal: true,
  streamerHideLinks: true,
  streamerMuteSounds: true,
  streamerMuteNotifs: true,
  groupSpacing: 16,
  spoilers: 'click',
  showReactions: true,
  emoticonsToEmoji: true,
  showSendButton: true,
  searchScope: 'all',
  stickerSuggestions: true,
  underlineLinks: false,
  minToastSec: 0,
  stickerAnim: 'always',
  gifFocusOnly: false,
  animatedEmoji: true,
  ttsRate: 1,
  showAltText: true,
  toggleIcons: false,
  notifyFriendOnline: false,
  notifyFriendAnniversary: true,
  notifyFriendProfile: true,
  shareProfileUpdates: true,
  notifyReactions: 'all',
  soundPack: 'auto',
  soundsOff: [],
  unreadBadge: true,
  // Padrão dos canais: 'all' | 'mentions' | 'none' (canal/categoria sobrescrevem).
  notifyLevel: 'mentions',
  // "Não perturbe" agendado — fuso do aparelho por padrão (servidor valida).
  quietHours: { enabled: false, start: '23:00', end: '07:00', days: [0, 1, 2, 3, 4, 5, 6], timezone: browserTimeZone() },
  emailComms: true,
  emailSocial: true,
  emailUpdates: true,
  emailTips: true,
  preJoinCheck: false, // desligado por padrão: entrar na call volta a ser 1 clique
  inputProfile: 'custom',
  sensitivityAuto: true,
  sensitivityDb: -60,
  joinSoundId: null,
  sfxVolume: 100,
  streamPreview: true,
  spamFilter: 'strangers',
  messageRequests: true,
  friendReqMessages: true,
  clipVoice: true,
  gameJoinFriends: true,
  gameJoinVoice: false,
});

const LOCAL_KEY = 'pc-extra-prefs';
const LOCAL_THEME_KEY = 'pc-extra-theme-local'; // tema quando "sincronizar" está desligado
const THEME_KEYS = ['colorTheme', 'customTheme'];

const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } };

export function loadLocalExtra() {
  return { ...EXTRA_DEFAULTS, ...(readJSON(LOCAL_KEY) || {}) };
}

// Preferências efetivas: padrão + conta (ou cache local) + tema local quando
// a pessoa desligou a sincronização do tema entre aparelhos.
export function resolveExtra(server) {
  const base = { ...EXTRA_DEFAULTS, ...(server && typeof server === 'object' ? server : readJSON(LOCAL_KEY) || {}) };
  if (base.themeSync === false) {
    const local = readJSON(LOCAL_THEME_KEY);
    if (local) THEME_KEYS.forEach((k) => { if (local[k] !== undefined) base[k] = local[k]; });
  }
  return base;
}

export function getExtra() {
  return resolveExtra(useStore.getState().userSettings?.extraPrefs);
}

export function useExtra(key) {
  const server = useStore((s) => s.userSettings?.extraPrefs);
  const all = resolveExtra(server);
  return key ? all[key] : all;
}

let timer = null;
let pending = {};
// Muda uma ou mais chaves: aplica na hora, salva local e manda pra conta
// (com um pequeno atraso pra juntar várias mudanças seguidas).
export function setExtra(patch) {
  const st = useStore.getState();
  const current = { ...EXTRA_DEFAULTS, ...(st.userSettings?.extraPrefs || readJSON(LOCAL_KEY) || {}) };
  const next = { ...current, ...patch };
  const syncOff = next.themeSync === false;
  if (syncOff) {
    // Tema só neste aparelho: guarda local e não manda as chaves de tema.
    const turningOff = patch.themeSync === false && current.themeSync !== false;
    const localTheme = turningOff ? {} : { ...(readJSON(LOCAL_THEME_KEY) || {}) };
    THEME_KEYS.forEach((k) => {
      if (k in patch) localTheme[k] = patch[k];
      else if (localTheme[k] === undefined) localTheme[k] = current[k];
    });
    writeJSON(LOCAL_THEME_KEY, localTheme);
    THEME_KEYS.forEach((k) => { next[k] = current[k]; });
  }
  writeJSON(LOCAL_KEY, next);
  useStore.setState((s) => ({ userSettings: s.userSettings ? { ...s.userSettings, extraPrefs: next } : s.userSettings, extraTick: (s.extraTick || 0) + 1 }));
  pending = next;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const body = pending;
    trackSave(updateUserSettings({ extraPrefs: body })).catch(() => {
      useStore.getState().pushNotice?.('Não foi possível salvar essa configuração. Verifique sua conexão.');
    });
  }, 500);
}

// ---------- Temas coloridos ----------
// Fundo em degradê + superfícies tingidas (calculadas, sempre sólidas pra
// manter contraste) + cor de destaque. Sempre escuros (o app é escuro).
export const COLOR_THEMES = [
  { id: 'menta', name: 'Verde-menta', colors: ['#0f766e', '#134e4a'], angle: 160, accent: '#2dd4bf' },
  { id: 'citrico', name: 'Sorvete cítrico', colors: ['#a16207', '#365314'], angle: 135, accent: '#facc15' },
  { id: 'chuva', name: 'Nuvem de chuva retrô', colors: ['#334155', '#1e293b', '#0f172a'], angle: 180, accent: '#94a3b8' },
  { id: 'hanami', name: 'Hanami', colors: ['#9d174d', '#4c1d95'], angle: 135, accent: '#f9a8d4' },
  { id: 'nascer', name: 'Nascer do sol', colors: ['#c2410c', '#7e22ce'], angle: 150, accent: '#fb923c' },
  { id: 'algodao', name: 'Algodão-doce', colors: ['#be185d', '#1d4ed8'], angle: 120, accent: '#f0abfc' },
  { id: 'lofi', name: 'LoFi Vibes', colors: ['#3730a3', '#7c2d12'], angle: 200, accent: '#a5b4fc' },
  { id: 'deserto', name: 'Cáqui do deserto', colors: ['#78716c', '#57534e', '#292524'], angle: 170, accent: '#d6d3d1' },
  { id: 'por-do-sol', name: 'Pôr do sol', colors: ['#b91c1c', '#c2410c', '#581c87'], angle: 165, accent: '#fdba74' },
  { id: 'cromatico', name: 'Brilho cromático', colors: ['#0e7490', '#7e22ce', '#be123c'], angle: 135, accent: '#67e8f9' },
  { id: 'floresta', name: 'Floresta', colors: ['#166534', '#14532d', '#052e16'], angle: 180, accent: '#4ade80' },
  { id: 'lua', name: 'Lua carmesim', colors: ['#7f1d1d', '#1c1917'], angle: 200, accent: '#f87171' },
  { id: 'meia-noite', name: 'Azul meia-noite', colors: ['#1e3a8a', '#0c0a3e'], angle: 180, accent: '#60a5fa' },
  { id: 'marte', name: 'Marte', colors: ['#9a3412', '#431407'], angle: 150, accent: '#fb923c' },
  { id: 'crepusculo', name: 'Crepúsculo', colors: ['#6d28d9', '#be185d', '#0f172a'], angle: 170, accent: '#c4b5fd' },
  { id: 'mar', name: 'Sob o mar', colors: ['#0369a1', '#0f766e', '#082f49'], angle: 190, accent: '#7dd3fc' },
  { id: 'tempestade', name: 'Tempestade retrô', colors: ['#4338ca', '#0f766e'], angle: 135, accent: '#a78bfa' },
  { id: 'neon', name: 'Noites neon', colors: ['#c026d3', '#0891b2', '#1e1b4b'], angle: 135, accent: '#e879f9' },
  { id: 'morango', name: 'Limonada de morango', colors: ['#e11d48', '#ca8a04'], angle: 135, accent: '#fda4af' },
  { id: 'aurora', name: 'Aurora', colors: ['#047857', '#4338ca', '#0f172a'], angle: 160, accent: '#6ee7b7' },
  { id: 'sepia', name: 'Sépia', colors: ['#78350f', '#451a03'], angle: 180, accent: '#fcd34d' },
  { id: 'ametista', name: 'Crepúsculo ametista', colors: ['#581c87', '#312e81'], angle: 150, accent: '#d8b4fe' },
];

const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbToHex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const avg = (cols) => { const rgb = cols.map(hexToRgb); return [0, 1, 2].map((i) => rgb.reduce((s, c) => s + c[i], 0) / rgb.length); };
const shade = (rgb, keep) => rgbToHex(rgb[0] * keep, rgb[1] * keep, rgb[2] * keep);
const darkenHex = (h, keep) => shade(hexToRgb(h), keep);

export function themeDef(prefs) {
  if (!prefs || prefs.colorTheme === 'none' || !prefs.colorTheme) return null;
  if (prefs.colorTheme === 'custom') {
    const c = prefs.customTheme || EXTRA_DEFAULTS.customTheme;
    return { id: 'custom', name: 'Personalizado', colors: c.colors, angle: c.angle, accent: c.accent, mix: c.mix };
  }
  return COLOR_THEMES.find((t) => t.id === prefs.colorTheme) || null;
}

// Variáveis CSS do tema (também usado na prévia das configurações).
export function themeVars(def) {
  const mix = (def.mix ?? 55) / 100; // quanto da cor aparece (0 = quase preto)
  const k = (base) => base * (0.7 + mix * 0.6); // ajusta a intensidade
  const tone = avg(def.colors);
  const grad = `linear-gradient(${def.angle}deg, ${def.colors.map((c) => darkenHex(c, 0.42 + mix * 0.3)).join(', ')})`;
  return {
    '--bg-deepest': shade(tone, k(0.16)),
    '--bg-secondary': shade(tone, k(0.22)),
    '--bg-primary': shade(tone, k(0.27)),
    '--bg-primary-solid': shade(tone, k(0.27)),
    '--bg-elevated': shade(tone, k(0.34)),
    '--bg-elevated-solid': shade(tone, k(0.34)),
    '--bg-floating': shade(tone, k(0.2)),
    '--bg-floating-solid': shade(tone, k(0.2)),
    '--bg-modifier-hover': 'rgba(255, 255, 255, 0.07)',
    '--border': shade(tone, k(0.3)),
    '--divider-strong': shade(tone, k(0.45)),
    '--scrollbar': shade(tone, k(0.14)),
    '--brand': def.accent,
    '--brand-hover': darkenHex(def.accent, 0.82),
    '--text-link': def.accent,
    '--pc-ct-grad': grad,
  };
}

const THEME_VAR_NAMES = Object.keys(themeVars({ colors: ['#000000'], angle: 0, accent: '#000000' }));

// ---------- Ícones do app ----------
export const APP_ICONS = [
  { id: 'default', name: 'Padrão' },
  { id: 'gotico', name: 'Gótico', bg: ['#1a0006', '#4a0010'], fg: '#ff3355' },
  { id: 'carvao', name: 'Carvão', bg: ['#27272a', '#3f3f46'], fg: '#e4e4e7' },
  { id: 'pastel', name: 'Pastel', bg: ['#fbcfe8', '#bfdbfe'], fg: '#1e1b4b' },
  { id: 'neon', name: 'Neon', bg: ['#0f0c29', '#302b63'], fg: '#39ff14' },
  { id: 'sakura', name: 'Sakura', bg: ['#fce7f3', '#f9a8d4'], fg: '#831843' },
  { id: 'oceano', name: 'Oceano', bg: ['#0c4a6e', '#0891b2'], fg: '#e0f2fe' },
  { id: 'ouro', name: 'Ouro', bg: ['#78350f', '#f59e0b'], fg: '#fffbeb' },
  { id: 'holograma', name: 'Holograma', bg: ['#a5f3fc', '#c4b5fd', '#fbcfe8'], fg: '#312e81' },
  { id: 'menta', name: 'Menta', bg: ['#064e3b', '#10b981'], fg: '#ecfdf5' },
  { id: 'arcoiris', name: 'Arco-íris', bg: ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'], fg: '#ffffff' },
  { id: 'crepusculo', name: 'Crepúsculo', bg: ['#1e1b4b', '#7c3aed', '#f472b6'], fg: '#fdf4ff' },
  { id: 'uwu', name: 'uwu~', bg: ['#fdf2f8', '#e9d5ff'], fg: '#db2777' },
  { id: 'tatico', name: 'Tático', bg: ['#1c1917', '#365314'], fg: '#bef264' },
];

const iconCache = new Map();
let baseIcon = null;
function loadBase() {
  if (baseIcon) return baseIcon;
  baseIcon = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = '/icon-192.png';
  });
  return baseIcon;
}

// Recolore o ícone: o preto vira o degradê escolhido e o branco vira a cor
// da frente (mantém o desenho "PC" e as bordas arredondadas).
export async function renderAppIcon(id, size = 192) {
  const def = APP_ICONS.find((i) => i.id === id);
  if (!def || !def.bg) return null;
  const key = `${id}:${size}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const img = await loadBase();
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size);
  const g = document.createElement('canvas');
  g.width = size; g.height = size;
  const gx = g.getContext('2d');
  const grad = gx.createLinearGradient(0, 0, size, size);
  def.bg.forEach((c, i) => grad.addColorStop(def.bg.length === 1 ? 0 : i / (def.bg.length - 1), c));
  gx.fillStyle = grad; gx.fillRect(0, 0, size, size);
  const bg = gx.getImageData(0, 0, size, size).data;
  const fg = hexToRgb(def.fg);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
    d[i] = bg[i] * (1 - l) + fg[0] * l;
    d[i + 1] = bg[i + 1] * (1 - l) + fg[1] * l;
    d[i + 2] = bg[i + 2] * (1 - l) + fg[2] * l;
  }
  ctx.putImageData(data, 0, 0);
  const url = cv.toDataURL('image/png');
  iconCache.set(key, url);
  return url;
}

let lastIcon = null;
async function applyAppIcon(id) {
  if (lastIcon === id) return;
  lastIcon = id;
  try {
    const url = id === 'default' ? null : await renderAppIcon(id, 192);
    const link = document.querySelector('link[rel="icon"]');
    if (link) link.href = url || '/icon.png';
    window.electronAPI?.setAppIcon?.(url ? await renderAppIcon(id, 256) : null);
  } catch { /* ícone é só enfeite */ }
}

// ---------- Aplicar no <html> ----------
let lastThemeKey = null;
export function applyExtraPrefs(p) {
  const html = document.documentElement;
  const setAttr = (name, on, value = '1') => { if (on) html.setAttribute(name, value); else html.removeAttribute(name); };

  const def = themeDef(p);
  // Só mexe nas variáveis de cor quando o tema muda de verdade (repintar o
  // app inteiro é caro).
  const themeKey = def ? JSON.stringify(def) : '';
  if (themeKey === lastThemeKey) { /* tema igual: nada a fazer */ } else if (def) {
    lastThemeKey = themeKey;
    const vars = themeVars(def);
    Object.entries(vars).forEach(([k, v]) => html.style.setProperty(k, v));
    setAttr('data-pc-ctheme', true, def.id);
  } else {
    lastThemeKey = '';
    THEME_VAR_NAMES.forEach((k) => html.style.removeProperty(k));
    setAttr('data-pc-ctheme', false);
  }
  setAttr('data-pc-plain-profiles', p.themeOnProfiles === false);
  setAttr('data-pc-streamer', !!p.streamerMode);
  setAttr('data-pc-streamer-personal', !!p.streamerMode && p.streamerHidePersonal !== false);
  setAttr('data-pc-streamer-links', !!p.streamerMode && p.streamerHideLinks !== false);
  setAttr('data-pc-underline', !!p.underlineLinks);
  setAttr('data-pc-noreactions', p.showReactions === false);
  setAttr('data-pc-nosend', p.showSendButton === false);
  setAttr('data-pc-sticker-anim', p.stickerAnim !== 'always', p.stickerAnim);
  setAttr('data-pc-noanim-emoji', p.animatedEmoji === false);
  setAttr('data-pc-toggle-icons', !!p.toggleIcons);
  setAttr('data-pc-spoilers', p.spoilers === 'always', 'always');
  html.style.setProperty('--pc-group-gap', `${p.groupSpacing ?? 16}px`);
  setAttr('data-pc-group-gap', (p.groupSpacing ?? 16) !== 16);
  applyAppIcon(p.appIcon || 'default');
}

// Modo streamer: sons e notificações de desktop ficam quietos.
export function streamerQuiet(kind) {
  const p = getExtra();
  if (!p.streamerMode) return false;
  return kind === 'sound' ? p.streamerMuteSounds !== false : p.streamerMuteNotifs !== false;
}

// Converte emoticons simples em emoji ao enviar (Aparência → Caixa de chat).
const EMOTICONS = [
  [':)', '🙂'], [':-)', '🙂'], [':D', '😄'], [':-D', '😄'], [';)', '😉'], [';-)', '😉'], [':(', '🙁'], [':-(', '🙁'],
  [':P', '😛'], [':p', '😛'], [':O', '😮'], [':o', '😮'], ['<3', '❤️'], ['</3', '💔'], [":'(", '😢'], ['XD', '😆'],
  ['xD', '😆'], [':|', '😐'], ['B)', '😎'], ['>:(', '😠'], [':*', '😘'], ['o/', '👋'], ['^^', '😊'],
];
export function convertEmoticons(text) {
  if (!text || getExtra().emoticonsToEmoji === false) return text;
  // Não mexe em blocos de código nem em links.
  if (/```|`/.test(text)) return text;
  let out = text;
  for (const [from, to] of EMOTICONS) {
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(^|\\s)${esc}(?=$|\\s|[.,!?])`, 'g'), `$1${to}`);
  }
  return out;
}
