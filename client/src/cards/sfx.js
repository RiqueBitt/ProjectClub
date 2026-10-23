// Sons da Guerra das Cartas — sintetizados com Web Audio (sem arquivos).
// Mudo e volume ficam salvos no navegador.
let ctx = null;
let master = null;
let music = null;
const KEY = 'pc-cards-sfx';

function prefs() {
  try { return { muted: false, music: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { muted: false, music: true }; }
}
export function getSfxPrefs() { return prefs(); }
export function setSfxPrefs(p) {
  const next = { ...prefs(), ...p };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignora */ }
  if (master) master.gain.value = next.muted ? 0 : 0.5;
  if (!next.music || next.muted) stopMusic();
  return next;
}

function ac() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = prefs().muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone({ f = 440, f2, d = 0.15, type = 'sine', g = 0.25, delay = 0, attack = 0.005 }) {
  const c = ac();
  if (!c || prefs().muted) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const gain = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + d);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(g, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(gain).connect(master);
  o.start(t);
  o.stop(t + d + 0.05);
}

function noise({ d = 0.2, g = 0.2, delay = 0, filter = 1200 }) {
  const c = ac();
  if (!c || prefs().muted) return;
  const t = c.currentTime + delay;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * d), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = filter;
  const gain = c.createGain();
  gain.gain.value = g;
  src.connect(lp).connect(gain).connect(master);
  src.start(t);
}

const SOUNDS = {
  play: () => { tone({ f: 330, f2: 520, d: 0.12, type: 'triangle', g: 0.2 }); noise({ d: 0.12, g: 0.08, filter: 3000 }); },
  epic: () => { [523, 659, 784, 1047].forEach((f, i) => tone({ f, d: 0.35, type: 'triangle', g: 0.16, delay: i * 0.07 })); noise({ d: 0.5, g: 0.12, filter: 5000 }); },
  spell: () => { tone({ f: 900, f2: 300, d: 0.35, type: 'sawtooth', g: 0.08 }); tone({ f: 1200, f2: 1800, d: 0.25, type: 'sine', g: 0.1, delay: 0.05 }); },
  attack: () => { noise({ d: 0.12, g: 0.18, filter: 2500 }); tone({ f: 200, f2: 90, d: 0.12, type: 'square', g: 0.08 }); },
  hit: () => { tone({ f: 140, f2: 60, d: 0.18, type: 'sine', g: 0.35 }); noise({ d: 0.1, g: 0.15, filter: 900 }); },
  hero: () => { tone({ f: 90, f2: 45, d: 0.35, type: 'sine', g: 0.45 }); noise({ d: 0.25, g: 0.2, filter: 600 }); },
  death: () => { tone({ f: 400, f2: 60, d: 0.4, type: 'sawtooth', g: 0.1 }); noise({ d: 0.35, g: 0.1, filter: 1500 }); },
  heal: () => { tone({ f: 660, f2: 990, d: 0.3, type: 'sine', g: 0.12 }); tone({ f: 880, f2: 1320, d: 0.3, type: 'sine', g: 0.08, delay: 0.08 }); },
  shield: () => { tone({ f: 1500, f2: 700, d: 0.2, type: 'triangle', g: 0.12 }); },
  freeze: () => { tone({ f: 2000, f2: 1200, d: 0.3, type: 'sine', g: 0.08 }); noise({ d: 0.3, g: 0.06, filter: 8000 }); },
  turn: () => { tone({ f: 523, d: 0.12, type: 'triangle', g: 0.15 }); tone({ f: 784, d: 0.2, type: 'triangle', g: 0.15, delay: 0.1 }); },
  draw: () => { noise({ d: 0.06, g: 0.06, filter: 4000 }); },
  win: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ f, d: 0.45, type: 'triangle', g: 0.15, delay: i * 0.11 })); },
  lose: () => { [392, 330, 262, 196].forEach((f, i) => tone({ f, d: 0.45, type: 'sine', g: 0.14, delay: i * 0.16 })); },
  click: () => { tone({ f: 800, d: 0.04, type: 'square', g: 0.05 }); },
  power: () => { tone({ f: 260, f2: 780, d: 0.3, type: 'triangle', g: 0.14 }); tone({ f: 520, f2: 1560, d: 0.25, type: 'sine', g: 0.08, delay: 0.06 }); },
  synergy: () => { [440, 554, 659, 880].forEach((f, i) => tone({ f, d: 0.22, type: 'triangle', g: 0.12, delay: i * 0.06 })); },
  emote: () => { tone({ f: 700, f2: 900, d: 0.08, type: 'sine', g: 0.08 }); },
  pack: () => { noise({ d: 0.6, g: 0.18, filter: 2500 }); [392, 523, 659].forEach((f, i) => tone({ f, d: 0.3, type: 'triangle', g: 0.12, delay: 0.3 + i * 0.08 })); },
};

export function sfx(name) {
  try { SOUNDS[name]?.(); } catch { /* áudio indisponível */ }
}

// Música ambiente simples (acordes suaves em loop) durante a batalha.
const CHORDS = [[220, 277, 330], [196, 247, 294], [174.6, 220, 262], [196, 247, 294]];
export function startMusic() {
  const c = ac();
  if (!c || music || prefs().muted || !prefs().music) return;
  let i = 0;
  const play = () => {
    if (!music || prefs().muted) return;
    for (const f of CHORDS[i % CHORDS.length]) tone({ f, d: 3.6, type: 'sine', g: 0.03, attack: 0.8 });
    tone({ f: CHORDS[i % CHORDS.length][0] / 2, d: 3.6, type: 'triangle', g: 0.025, attack: 0.5 });
    i += 1;
  };
  music = setInterval(play, 3600);
  play();
}
export function stopMusic() {
  if (music) clearInterval(music);
  music = null;
}
