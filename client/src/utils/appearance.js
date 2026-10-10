// Personalizar layout (Configurações → Aparência / Acessibilidade).
// Tudo que é preferência de layout vive num objeto só (layoutPrefs):
// cache no localStorage (aplica na hora, antes da conta carregar) e
// a conta como fonte de verdade (UserSettings.layoutPrefs no servidor).
// Aplicado como atributos/variáveis CSS no <html> — toda página segue
// sem precisar saber de nada (ver styles/appearance.css).
import { updateUserSettings } from '../api/endpoints';
import { trackSave } from './saveIndicator';

export const DEFAULT_LAYOUT_PREFS = Object.freeze({
  density: 'compact', // compact | normal | spacious (compacta é o padrão)
  corners: 'round', // round | square
  sidebarWidth: 272, // px, só no PC
  fontSize: 16, // px, base do chat/canais/membros
  showMembers: true, // lista de membros aberta por padrão
  animatedBg: 'off', // off | gradient | particles
  seasonal: true, // temas sazonais automáticos
  legibleFont: false, // fonte mais fácil de ler (Atkinson Hyperlegible)
  resumeLastPage: false, // ao abrir, volta pra última página em vez do Início
});

export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 420;
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 20;

const LOCAL_KEY = 'pc-layout-prefs';
const FOCUS_KEY = 'pc-focus-mode';

const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// Sempre devolve um objeto completo e válido (valores estranhos voltam ao padrão).
export function normalizeLayoutPrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_LAYOUT_PREFS;
  return {
    density: ['compact', 'normal', 'spacious'].includes(p.density) ? p.density : d.density,
    corners: ['round', 'square'].includes(p.corners) ? p.corners : d.corners,
    sidebarWidth: clampInt(p.sidebarWidth, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, d.sidebarWidth),
    fontSize: clampInt(p.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, d.fontSize),
    showMembers: typeof p.showMembers === 'boolean' ? p.showMembers : d.showMembers,
    animatedBg: ['off', 'gradient', 'particles'].includes(p.animatedBg) ? p.animatedBg : d.animatedBg,
    seasonal: typeof p.seasonal === 'boolean' ? p.seasonal : d.seasonal,
    legibleFont: typeof p.legibleFont === 'boolean' ? p.legibleFont : d.legibleFont,
    resumeLastPage: typeof p.resumeLastPage === 'boolean' ? p.resumeLastPage : d.resumeLastPage,
  };
}

export function sameLayoutPrefs(a, b) {
  const x = normalizeLayoutPrefs(a);
  const y = normalizeLayoutPrefs(b);
  return Object.keys(x).every((k) => x[k] === y[k]);
}

export function isDefaultLayoutPrefs(p) {
  return sameLayoutPrefs(p, DEFAULT_LAYOUT_PREFS);
}

export function loadLocalLayoutPrefs() {
  try { return normalizeLayoutPrefs(JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null')); } catch { return { ...DEFAULT_LAYOUT_PREFS }; }
}

export function saveLocalLayoutPrefs(prefs) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(prefs)); } catch { /* localStorage indisponível — fica só em memória */ }
}

// Salva na conta com um pequeno atraso (o slider dispara várias
// mudanças por segundo). Falha em silêncio: o cache local continua valendo.
let saveTimer = null;
export function scheduleServerSave(prefs, delay = 700) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    trackSave(updateUserSettings({ layoutPrefs: prefs })).catch(() => {});
  }, delay);
}

export function loadFocusMode() {
  try { return sessionStorage.getItem(FOCUS_KEY) === '1'; } catch { return false; }
}
export function saveFocusMode(on) {
  try { sessionStorage.setItem(FOCUS_KEY, on ? '1' : '0'); } catch { /* sem sessionStorage */ }
}

// ---------- Temas sazonais ----------
// Aniversário do Project Club (mês 1–12, dia). Troque aqui se a data mudar.
export const PROJECT_CLUB_BIRTHDAY = { month: 9, day: 20 }; // primeiro commit do projeto (20/09)

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher) — Carnaval é 47 dias antes.
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export const SEASONS = {
  natal: { label: 'Natal', greeting: 'Boas festas!', when: '1 a 31 de dezembro' },
  anonovo: { label: 'Ano Novo', greeting: 'Feliz Ano Novo!', when: '1 a 6 de janeiro' },
  carnaval: { label: 'Carnaval', greeting: 'Bom Carnaval!', when: 'sábado até quarta de cinzas' },
  halloween: { label: 'Halloween', greeting: 'Feliz Halloween!', when: '20 a 31 de outubro' },
  aniversario: { label: 'Aniversário do Project Club', greeting: 'Parabéns, Project Club!', when: `${PROJECT_CLUB_BIRTHDAY.day}/${String(PROJECT_CLUB_BIRTHDAY.month).padStart(2, '0')} e os 2 dias seguintes` },
};

export function seasonForDate(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (m === 12) return 'natal';
  if (m === 1 && d <= 6) return 'anonovo';
  if (m === 10 && d >= 20) return 'halloween';
  const bd = new Date(y, PROJECT_CLUB_BIRTHDAY.month - 1, PROJECT_CLUB_BIRTHDAY.day);
  const dayMs = 86400000;
  const today = new Date(y, m - 1, d);
  const diffBd = Math.round((today - bd) / dayMs);
  if (diffBd >= 0 && diffBd <= 2) return 'aniversario';
  const easter = easterSunday(y);
  const diffEaster = Math.round((today - easter) / dayMs);
  if (diffEaster >= -51 && diffEaster <= -46) return 'carnaval';
  return null;
}

// Prévia manual (só pra testes): ?estacao=natal na URL ou localStorage pc-season-preview.
export function currentSeason() {
  try {
    const q = new URLSearchParams(window.location.search).get('estacao') || localStorage.getItem('pc-season-preview');
    if (q && SEASONS[q]) return q;
  } catch { /* ignora */ }
  return seasonForDate();
}

// ---------- Fonte legível ----------
const LEGIBLE_FONT_HREF = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap';
export function ensureLegibleFontLoaded() {
  if (document.getElementById('pc-legible-font')) return;
  const link = document.createElement('link');
  link.id = 'pc-legible-font';
  link.rel = 'stylesheet';
  link.href = LEGIBLE_FONT_HREF;
  document.head.appendChild(link);
}

// Aplica as preferências no <html>. Só liga atributos quando o valor
// foge do padrão — quem nunca mexeu continua com o visual de sempre.
export function applyLayoutPrefs(prefs, { reducedMotion = false } = {}) {
  const html = document.documentElement;
  const p = normalizeLayoutPrefs(prefs);
  const setAttr = (name, on, value) => { if (on) html.setAttribute(name, value); else html.removeAttribute(name); };

  setAttr('data-pc-density', p.density !== 'normal', p.density);
  setAttr('data-pc-corners', p.corners !== 'round', p.corners);
  setAttr('data-pc-sidebar', p.sidebarWidth !== DEFAULT_LAYOUT_PREFS.sidebarWidth, '1');
  html.style.setProperty('--pc-sidebar-w', `${p.sidebarWidth}px`);

  // Densidade + tamanho da fonte viram um zoom só pro conteúdo (chat, canais, membros).
  const densityScale = { compact: 0.93, normal: 1, spacious: 1.06 }[p.density];
  const textZoom = Math.round((p.fontSize / 16) * densityScale * 1000) / 1000;
  setAttr('data-pc-text', textZoom !== 1, '1');
  html.style.setProperty('--pc-text-zoom', String(textZoom));

  html.classList.toggle('pc-legible-font', p.legibleFont);
  if (p.legibleFont) ensureLegibleFontLoaded();

  // Movimento reduzido: preferência do sistema OU da conta.
  const systemReduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionOff = reducedMotion || systemReduced;
  setAttr('data-pc-anim-bg', p.animatedBg !== 'off' && !motionOff, p.animatedBg);

  const season = p.seasonal ? currentSeason() : null;
  setAttr('data-pc-season', !!season, season || '');
  return { prefs: p, season, motionOff };
}

// ---------- Memória de página / rolagem ----------
const LAST_PATH_KEY = 'pc-last-path';
const LAST_CHANNEL_KEY = 'pc-last-channel';
const SCROLL_KEY = 'pc-scroll-positions';

export function rememberPath(path) {
  if (!path || path === '/') return;
  try { localStorage.setItem(LAST_PATH_KEY, path); } catch { /* ignora */ }
  if (path.startsWith('/channels/')) {
    try { sessionStorage.setItem(LAST_CHANNEL_KEY, path.slice('/channels/'.length)); } catch { /* ignora */ }
  }
}
export function lastRememberedPath() {
  try { return localStorage.getItem(LAST_PATH_KEY); } catch { return null; }
}
export function lastRememberedChannelId() {
  try { return sessionStorage.getItem(LAST_CHANNEL_KEY); } catch { return null; }
}

function readScrollMap() {
  try { return JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}') || {}; } catch { return {}; }
}
export function saveScrollPosition(path, top) {
  const map = readScrollMap();
  map[path] = Math.max(0, Math.round(top));
  // Guarda só as 40 páginas mais recentes.
  const keys = Object.keys(map);
  if (keys.length > 40) delete map[keys[0]];
  try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify(map)); } catch { /* ignora */ }
}
export function readScrollPosition(path) {
  const v = readScrollMap()[path];
  return typeof v === 'number' ? v : null;
}
