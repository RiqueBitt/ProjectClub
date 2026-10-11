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
  // Daltonismo (Acessibilidade): troca as cores de status/sucesso/erro por
  // cores que dá pra distinguir e, opcionalmente, um filtro de correção.
  colorblind: 'none', // none | protanopia | deuteranopia | tritanopia | achromatopsia
  colorblindStrength: 100, // 0–100: o quanto as cores trocam (e o filtro age)
  colorblindFilter: false, // filtro de correção de cor no app inteiro (afeta imagens)
  statusShapes: false, // ícones além de cores nas bolinhas de status
});

export const COLORBLIND_MODES = ['none', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];

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
    colorblind: COLORBLIND_MODES.includes(p.colorblind) ? p.colorblind : d.colorblind,
    colorblindStrength: clampInt(p.colorblindStrength, 0, 100, d.colorblindStrength),
    colorblindFilter: typeof p.colorblindFilter === 'boolean' ? p.colorblindFilter : d.colorblindFilter,
    statusShapes: typeof p.statusShapes === 'boolean' ? p.statusShapes : d.statusShapes,
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

// Chaves que são de Acessibilidade (não voltam ao padrão pelo botão
// "Restaurar padrão" do layout, que mora em Aparência).
export const A11Y_PREF_KEYS = ['legibleFont', 'colorblind', 'colorblindStrength', 'colorblindFilter', 'statusShapes'];
export function layoutOnlyDefaults() {
  return Object.fromEntries(Object.entries(DEFAULT_LAYOUT_PREFS).filter(([k]) => !A11Y_PREF_KEYS.includes(k)));
}
export function isDefaultLayoutOnly(p) {
  const x = normalizeLayoutPrefs(p);
  return Object.entries(layoutOnlyDefaults()).every(([k, v]) => x[k] === v);
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

  applyColorVision(p);
  return { prefs: p, season, motionOff };
}

// ---------- Daltonismo ----------
// Cores "seguras" de cada modo (baseadas na paleta Okabe-Ito). Só as
// cores com significado mudam: status (online/ausente/não perturbe),
// sucesso/aviso/erro e o destaque de menções. A marca (azul) fica.
const BASE_SEMANTIC = { green: '#23a55a', yellow: '#f0b232', red: '#f23f43', online: '#23a55a', idle: '#f0b232', dnd: '#f23f43', offline: '#80848e', mention: '#f0b232' };
export const COLORBLIND_PALETTES = {
  // Vermelho e verde se confundem: sucesso vira azul-céu, erro vira laranja-vermelhão.
  protanopia: { green: '#3fa9e8', yellow: '#f0e442', red: '#e66100', online: '#3fa9e8', idle: '#f0e442', dnd: '#e66100', offline: '#8a8f98', mention: '#f0e442' },
  deuteranopia: { green: '#2f9ee8', yellow: '#f5d90a', red: '#d55e00', online: '#2f9ee8', idle: '#f5d90a', dnd: '#d55e00', offline: '#8a8f98', mention: '#f5d90a' },
  // Azul e amarelo se confundem: ausente vira laranja, sucesso verde-água, erro magenta.
  tritanopia: { green: '#1fbfa0', yellow: '#ff8a3d', red: '#e5306f', online: '#1fbfa0', idle: '#ff8a3d', dnd: '#e5306f', offline: '#8a8f98', mention: '#ff8a3d' },
  // Sem cores: diferença só de claro/escuro (e os formatos fazem o resto).
  // Botões verdes/vermelhos (texto branco por cima) ficam como estão: a
  // diferença de claro/escuro deles já existe; só os status mudam.
  achromatopsia: { green: '#23a55a', yellow: '#f0b232', red: '#f23f43', online: '#f2f3f5', idle: '#b5b9c0', dnd: '#8e929a', offline: '#5d6168', mention: '#c9ccd2' },
};

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
export function mixHex(a, b, t) {
  const x = hexToRgb(a); const y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * t));
}

// Cores semânticas finais pra um modo/intensidade (usado também na prévia).
export function colorVisionPalette(mode, strength = 100) {
  const target = COLORBLIND_PALETTES[mode];
  if (!target) return { ...BASE_SEMANTIC };
  const t = Math.min(100, Math.max(0, strength)) / 100;
  return Object.fromEntries(Object.keys(BASE_SEMANTIC).map((k) => [k, mixHex(BASE_SEMANTIC[k], target[k], t)]));
}

// Matrizes de simulação (espaço sRGB, aproximação clássica) e a correção
// "daltonize": o que a pessoa não enxerga é empurrado pros canais que
// ela enxerga. M = I + E·(I − S); a intensidade mistura com a identidade.
const SIM = {
  protanopia: [[0.567, 0.433, 0], [0.558, 0.442, 0], [0, 0.242, 0.758]],
  deuteranopia: [[0.625, 0.375, 0], [0.7, 0.3, 0], [0, 0.3, 0.7]],
  tritanopia: [[0.95, 0.05, 0], [0, 0.433, 0.567], [0, 0.475, 0.525]],
};
const SHIFT = {
  protanopia: [[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]],
  deuteranopia: [[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]],
  tritanopia: [[1, 0, 0.7], [0, 1, 0.7], [0, 0, 0]],
};
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const mul3 = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
export function colorVisionMatrix(mode, strength = 100) {
  const t = Math.min(100, Math.max(0, strength)) / 100;
  let m;
  if (mode === 'achromatopsia') {
    // Sem cor pra corrigir: realça o contraste de claro/escuro.
    const c = 1 + 0.25 * t; const o = -0.125 * t;
    return [c, 0, 0, 0, o, 0, c, 0, 0, o, 0, 0, c, 0, o, 0, 0, 0, 1, 0].map((v) => +v.toFixed(4)).join(' ');
  }
  if (SIM[mode]) {
    const diff = I3.map((row, i) => row.map((v, j) => v - SIM[mode][i][j]));
    const corr = mul3(SHIFT[mode], diff);
    m = I3.map((row, i) => row.map((v, j) => v + corr[i][j] * t));
  } else {
    m = I3;
  }
  return [...m[0], 0, 0, ...m[1], 0, 0, ...m[2], 0, 0, 0, 0, 0, 1, 0].map((v) => +v.toFixed(4)).join(' ');
}

const CB_VARS = { green: '--green', yellow: '--yellow', red: '--red', online: '--pc-st-online', idle: '--pc-st-idle', dnd: '--pc-st-dnd', offline: '--pc-st-offline', mention: '--pc-mention' };
const CB_FILTER_ID = 'pc-cb-filter';

function ensureColorVisionFilter(matrix) {
  let svg = document.getElementById(`${CB_FILTER_ID}-svg`);
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = `${CB_FILTER_ID}-svg`;
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    svg.innerHTML = `<filter id="${CB_FILTER_ID}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="" /></filter>`;
    document.body.appendChild(svg);
  }
  svg.querySelector('feColorMatrix').setAttribute('values', matrix);
}

// Aplica (ou tira) as cores seguras e o filtro. Sem modo: nada muda.
export function applyColorVision(p) {
  const html = document.documentElement;
  const mode = p.colorblind && p.colorblind !== 'none' ? p.colorblind : null;
  const on = !!mode && p.colorblindStrength > 0;
  if (on) {
    html.setAttribute('data-pc-cb', mode);
    const pal = colorVisionPalette(mode, p.colorblindStrength);
    Object.entries(CB_VARS).forEach(([k, v]) => html.style.setProperty(v, pal[k]));
  } else {
    html.removeAttribute('data-pc-cb');
    Object.values(CB_VARS).forEach((v) => html.style.removeProperty(v));
  }
  // O filtro vale pro app inteiro (pedido do dono): sempre que um modo de
  // daltonismo estiver ativo, tudo passa por ele — telas, imagens e vídeos.
  const filterOn = on && typeof document !== 'undefined' && !!document.body;
  if (filterOn) ensureColorVisionFilter(colorVisionMatrix(mode, p.colorblindStrength));
  if (filterOn) html.setAttribute('data-pc-cb-filter', '1'); else html.removeAttribute('data-pc-cb-filter');
  // Formatos nas bolinhas: escolha da pessoa, ou sempre no modo sem cores.
  if (p.statusShapes || mode === 'achromatopsia') html.setAttribute('data-pc-status-shapes', '1');
  else html.removeAttribute('data-pc-status-shapes');
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
