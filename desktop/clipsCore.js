// Clipes (Fase 7) — regras puras: configuração, atalho, áudio permitido,
// codec, qualidade, escolha da janela do jogo e nome do arquivo. Sem
// Electron (testado em test/clipsCore.test.js); quem usa é clipsManager.js.
const path = require('path');
const screenAudio = require('./screenAudio');

const DEFAULT_HOTKEY = 'Alt+F10';
const DEFAULT_SETTINGS = Object.freeze({
  enabled: false, // desligado por padrão — só grava depois que a pessoa liga
  hotkey: DEFAULT_HOTKEY,
  audio: false, // som do PC: só onde dá pra excluir o som do próprio app (call)
  source: 'screen', // 'screen' (tela escolhida) | 'game' (janela do jogo detectado)
  displayId: null, // id da tela (screen.getAllDisplays) — null = principal
  quality: '1080p', // '720p' | '1080p'
  fps: 30, // 30 | 60
});
const QUALITIES = {
  '720p': { width: 1280, height: 720, bitrate30: 4_000_000 },
  '1080p': { width: 1920, height: 1080, bitrate30: 8_000_000 },
};
const CLIP_SECONDS = 30;
const FOLDER_NAME = 'Project Club Clipes';

function sanitizeSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { ...DEFAULT_SETTINGS };
  if (typeof src.enabled === 'boolean') out.enabled = src.enabled;
  if (typeof src.audio === 'boolean') out.audio = src.audio;
  if (src.source === 'screen' || src.source === 'game') out.source = src.source;
  if (src.quality in QUALITIES) out.quality = src.quality;
  if (src.fps === 30 || src.fps === 60) out.fps = src.fps;
  const display = Number(src.displayId);
  out.displayId = src.displayId != null && Number.isSafeInteger(display) ? display : null;
  out.hotkey = normalizeAccelerator(src.hotkey) || DEFAULT_HOTKEY;
  return out;
}

// ---------- Atalho (accelerator do Electron) ----------
const MODIFIERS = {
  ctrl: 'CommandOrControl', control: 'CommandOrControl', commandorcontrol: 'CommandOrControl', cmdorctrl: 'CommandOrControl',
  alt: 'Alt', option: 'Alt', shift: 'Shift', super: 'Super', meta: 'Super',
};
const MOD_ORDER = ['CommandOrControl', 'Alt', 'Shift', 'Super'];
const NAMED_KEYS = {
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert', delete: 'Delete',
  printscreen: 'PrintScreen', space: 'Space', backspace: 'Backspace', tab: 'Tab',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  numadd: 'numadd', numsub: 'numsub', nummult: 'nummult', numdiv: 'numdiv',
};

// "alt + f10" → "Alt+F10". Teclas de função valem sozinhas; o resto
// precisa de pelo menos um modificador (senão a tecla deixaria de
// funcionar em todos os outros programas). null = inválido.
function normalizeAccelerator(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 4) return null;
  const mods = new Set();
  let key = null;
  for (const raw of parts) {
    const low = raw.toLowerCase();
    if (MODIFIERS[low]) { mods.add(MODIFIERS[low]); continue; }
    if (key) return null; // duas teclas comuns
    if (/^f([1-9]|1[0-9]|2[0-4])$/.test(low)) key = low.toUpperCase();
    else if (/^[a-z0-9]$/.test(low)) key = low.toUpperCase();
    else if (/^num[0-9]$/.test(low)) key = low;
    else if (NAMED_KEYS[low]) key = NAMED_KEYS[low];
    else return null;
  }
  if (!key) return null;
  const isFn = /^F\d+$/.test(key);
  if (!isFn && mods.size === 0) return null;
  if (!isFn && mods.size === 1 && mods.has('Shift')) return null; // Shift+A = letra maiúscula
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+');
}

// ---------- Áudio ----------
// Som do PC só onde dá pra EXCLUIR o som do próprio app (as vozes da
// call nunca entram no clipe sem consentimento de quem fala): Windows 10
// 22H2+ com o Chromium que entende 'loopbackWithoutChrome' (ver
// screenAudio.js). Linux: o microfone virtual do venmic é o mesmo da
// transmissão de tela (não dá pra usar os dois juntos com segurança), e
// macOS não é o público do app — sem som nesses casos.
function pickClipAudio({ platform = process.platform, osRelease, chromeVersion = process.versions.chrome, env = process.env } = {}) {
  if (String(env?.PROJECT_CLUB_SCREEN_AUDIO || '').toLowerCase() === 'off') return null;
  if (platform !== 'win32') return null;
  const chromeMajor = parseInt(String(chromeVersion || '0'), 10) || 0;
  const build = screenAudio.windowsBuild(osRelease ?? require('os').release());
  if (chromeMajor >= screenAudio.MIN_CHROME_PROCESS_LOOPBACK && build >= screenAudio.MIN_WIN_BUILD_PROCESS_LOOPBACK) return 'loopbackWithoutChrome';
  return null;
}

// ---------- Vídeo ----------
// Ordem de preferência do formato (todos .webm). VP9 primeiro (melhor
// qualidade por bit, e acelerado por hardware na maioria das placas
// recentes); VP8 é o mais leve em software; H.264 dentro de WebM só toca
// bem no Chromium/VLC, por isso fica por último.
const MIME_PREFERENCE = [
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9',
  'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8',
  'video/webm;codecs=h264,opus', 'video/webm;codecs=h264',
  'video/webm',
];
function pickMimeType(isTypeSupported, { audio = false } = {}) {
  const list = MIME_PREFERENCE.filter((m) => audio || !m.includes('opus'));
  for (const m of list) {
    try { if (isTypeSupported(m)) return m; } catch { /* segue */ }
  }
  return null;
}

function videoProfile(settings) {
  const s = sanitizeSettings(settings);
  const q = QUALITIES[s.quality];
  // 60 fps pede ~1,5x a taxa pra mesma qualidade.
  const bitrate = Math.round(q.bitrate30 * (s.fps === 60 ? 1.5 : 1));
  return { width: q.width, height: q.height, fps: s.fps, videoBitsPerSecond: bitrate, audioBitsPerSecond: 128_000 };
}

// ---------- Janela do jogo ----------
const simplify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

// Escolhe, entre as janelas abertas (desktopCapturer), a do jogo
// detectado: título igual, depois título que contém o nome (ou o
// contrário). Nunca escolhe a janela do próprio Project Club.
function pickGameWindow(sources, gameName) {
  const target = simplify(gameName);
  if (!target || target.length < 2) return null;
  const windows = (sources || []).filter((s) => s && typeof s.id === 'string' && s.id.startsWith('window:') && !/project\s*club/i.test(s.name || ''));
  const scored = windows.map((s) => {
    const n = simplify(s.name);
    let score = 0;
    if (n === target) score = 3;
    else if (n.startsWith(target)) score = 2;
    else if (n.includes(target) || (n.length >= 4 && target.includes(n))) score = 1;
    return { s, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored[0]?.s || null;
}

// Tela pelo id (screen.getAllDisplays) → fonte "screen:" do desktopCapturer.
function pickScreenSource(sources, displayId) {
  const screens = (sources || []).filter((s) => s && typeof s.id === 'string' && s.id.startsWith('screen:'));
  if (!screens.length) return null;
  if (displayId != null) {
    const match = screens.find((s) => String(s.display_id) === String(displayId));
    if (match) return match;
  }
  return screens[0];
}

// ---------- Arquivo ----------
const pad = (n) => String(n).padStart(2, '0');
function clipFileName(date = new Date(), gameName = null) {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  const game = String(gameName || '').replace(/[<>:"/\\|?*\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${game ? `${game} ` : 'Clipe '}${stamp}.webm`;
}

// Não sobrescreve um clipe salvo no mesmo segundo.
function uniquePath(dir, name, exists) {
  let candidate = path.join(dir, name);
  const ext = path.extname(name);
  const base = name.slice(0, -ext.length);
  for (let i = 2; exists(candidate) && i < 1000; i += 1) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

module.exports = {
  DEFAULT_HOTKEY, DEFAULT_SETTINGS, QUALITIES, CLIP_SECONDS, FOLDER_NAME, MIME_PREFERENCE,
  sanitizeSettings, normalizeAccelerator, pickClipAudio, pickMimeType, videoProfile,
  pickGameWindow, pickScreenSource, clipFileName, uniquePath,
};
