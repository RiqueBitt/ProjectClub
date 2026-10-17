// Preferências de "Voz e vídeo" guardadas no próprio navegador (por
// pessoa, por dispositivo). Tudo aqui é self-service: só mexe no SEU
// próprio áudio/experiência, nunca no dos outros.
//
// Itens pedidos cobertos por este arquivo:
//  B. Redutor de ruído (ligado por padrão).
//  E. Nivelar volume automaticamente (desligado por padrão).
//  F. Apertar pra falar (push-to-talk), com tecla configurável.
//  H. Modo da tela da chamada (auto / grade / foco em quem apresenta).
//  I. Reações rápidas (lista de emojis + limite anti-spam no cliente).
//  K. Legendas ao vivo (desligado por padrão).

const KEY = 'pc.voicePrefs';

const DEFAULTS = {
  noiseReduction: true,       // B — redutor de ruído (RNNoise no servidor próprio)
  autoLevelVolume: false,     // E — nivelar volume automático
  pushToTalkEnabled: false,   // F — apertar pra falar
  pushToTalkKey: 'Space',     // F — tecla (event.code)
  captions: false,            // K — legendas ao vivo (pt-BR)
  callViewMode: 'auto',       // H — 'auto' | 'grid' | 'focus'
};

let cache = null;

function read() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    cache = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function getVoicePrefs() {
  return { ...read() };
}

export function getVoicePref(name) {
  return read()[name];
}

const listeners = new Set();

export function setVoicePref(name, value) {
  const next = { ...read(), [name]: value };
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sem storage — só não lembra */ }
  listeners.forEach((fn) => { try { fn(next); } catch { /* um ouvinte com erro não derruba os outros */ } });
  return next;
}

export function onVoicePrefsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- Reações rápidas (I) ----------
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮'];

export function isValidReaction(emoji) {
  return QUICK_REACTIONS.includes(emoji);
}

// Limite anti-spam no cliente: no máximo 5 reações a cada 4s (o servidor
// tem o seu próprio limite também — ver server/src/services/voiceExtras.js).
export function makeReactionRateLimiter({ max = 5, windowMs = 4000 } = {}) {
  let hits = [];
  return function allow(now = Date.now()) {
    hits = hits.filter((t) => now - t < windowMs);
    if (hits.length >= max) return false;
    hits.push(now);
    return true;
  };
}

// Nome amigável de uma tecla (event.code) pra mostrar na configuração.
export function prettyKeyName(code) {
  if (!code) return '—';
  if (code === 'Space') return 'Barra de espaço';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return `Seta ${({ Up: 'cima', Down: 'baixo', Left: 'esquerda', Right: 'direita' })[code.slice(5)] || ''}`.trim();
  const map = { ControlLeft: 'Ctrl', ControlRight: 'Ctrl (dir.)', ShiftLeft: 'Shift', ShiftRight: 'Shift (dir.)', AltLeft: 'Alt', AltRight: 'Alt (dir.)' };
  return map[code] || code;
}
