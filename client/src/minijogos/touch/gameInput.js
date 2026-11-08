// Ponte entre os controles na tela e o jogo aberto no iframe (mesma origem).
// Os jogos já escutam o teclado (setas/Espaço/Enter), então o jeito menos
// invasivo é gerar keydown/keyup "de mentira" com as mesmas teclas:
//  - HTML5 (jQuery/sbd.js): escutam no window do Game.html (iframe interno).
//  - Flash (Ruffle): escuta no window do player.html e lê o estado da tecla a
//    cada quadro — por isso todo toque segura a tecla por pelo menos MIN_HOLD
//    (um toque rápido demais caía entre dois quadros e o jogo nem via).
// Cada evento é disparado UMA vez por janela (antes ia pra 4–5 alvos e o
// window recebia a mesma tecla repetida — no trenó virava 3 curvas).

export const KEYS = {
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  space: { key: ' ', code: 'Space', keyCode: 32 },
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
};

const MIN_HOLD = 90; // ms (~3 quadros a 30 fps)

// Janela onde o jogo de fato roda: o Game.html (iframe.game-box) nos jogos
// HTML5, ou o próprio player.html nos jogos em Flash.
export function gameWindow(frame) {
  try {
    const outer = frame?.contentWindow;
    if (!outer) return null;
    const inner = outer.document.querySelector('iframe.game-box')?.contentWindow;
    return inner || outer;
  } catch { return null; } // outra origem
}

function frameWindows(frame) {
  const out = [];
  try {
    const outer = frame?.contentWindow;
    if (!outer) return out;
    out.push(outer);
    const inner = outer.document.querySelector('iframe.game-box')?.contentWindow;
    if (inner) out.push(inner);
  } catch { /* outra origem */ }
  return out;
}

function dispatchKey(frame, type, k) {
  const win = gameWindow(frame);
  if (!win) return;
  try {
    const d = win.document;
    const ruffle = d.querySelector('ruffle-player, ruffle-object');
    const active = d.activeElement && d.activeElement !== d.body ? d.activeElement : null;
    const target = ruffle || active || d.body || d;
    const Ev = win.KeyboardEvent || KeyboardEvent;
    const ev = new Ev(type, { key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode, bubbles: true, cancelable: true, composed: true });
    // Alguns navegadores ignoram keyCode/which no construtor (jQuery usa e.which).
    if (ev.keyCode !== k.keyCode) {
      try { Object.defineProperty(ev, 'keyCode', { get: () => k.keyCode }); } catch { /* ignora */ }
      try { Object.defineProperty(ev, 'which', { get: () => k.keyCode }); } catch { /* ignora */ }
    }
    target.dispatchEvent(ev);
  } catch { /* ignora */ }
}

// Volta o som do jogo (AudioContext suspenso / música em autoplay barrada).
// Precisa rodar dentro de um toque — o player chama no primeiro toque.
export function resumeGameAudio(frame) {
  frameWindows(frame).forEach((w) => {
    try { w.__pcResumeAudio?.(); } catch { /* ignora */ }
  });
}

export function focusGame(frame) {
  try {
    if (!frame) return;
    const doc = frame.ownerDocument;
    if (doc.activeElement !== frame) frame.focus({ preventScroll: true });
    const win = gameWindow(frame);
    const ruffle = win?.document.querySelector('ruffle-player, ruffle-object');
    if (ruffle && win.document.activeElement !== ruffle) ruffle.focus({ preventScroll: true });
  } catch { /* ignora */ }
}

// Controlador de teclas "seguradas" pelos controles na tela. Conta quantos
// controles seguram cada tecla (dois dedos na mesma seta não soltam antes
// da hora) e garante que tudo é solto ao sair/cancelar.
export function createGameInput(getFrame) {
  const held = new Map(); // nome -> { count, since, upTimer, repeatTimer }

  const down = (name, opts = {}) => {
    const k = KEYS[name];
    if (!k) return;
    let s = held.get(name);
    if (s && s.count > 0) { s.count += 1; return; }
    if (s?.upTimer) { clearTimeout(s.upTimer); s.upTimer = null; dispatchKey(getFrame(), 'keyup', k); }
    s = { count: 1, since: performance.now(), upTimer: null, repeatTimer: null };
    held.set(name, s);
    focusGame(getFrame());
    dispatchKey(getFrame(), 'keydown', k);
    // Repetição (igual segurar a tecla no teclado) pros jogos que andam um
    // passo por keydown, como o trenó.
    if (opts.repeat) {
      const { delay = 260, interval = 130 } = opts.repeat;
      const tick = () => {
        if (held.get(name) !== s || s.count <= 0) return;
        dispatchKey(getFrame(), 'keydown', k);
        s.repeatTimer = setTimeout(tick, interval);
      };
      s.repeatTimer = setTimeout(tick, delay);
    }
  };

  const up = (name) => {
    const k = KEYS[name];
    const s = held.get(name);
    if (!k || !s || s.count <= 0) return;
    s.count -= 1;
    if (s.count > 0) return;
    clearTimeout(s.repeatTimer);
    const wait = MIN_HOLD - (performance.now() - s.since);
    const release = () => { s.upTimer = null; if (held.get(name) === s) held.delete(name); dispatchKey(getFrame(), 'keyup', k); };
    if (wait > 0) s.upTimer = setTimeout(release, wait);
    else release();
  };

  const releaseAll = () => {
    held.forEach((s, name) => {
      clearTimeout(s.repeatTimer);
      clearTimeout(s.upTimer);
      dispatchKey(getFrame(), 'keyup', KEYS[name]);
    });
    held.clear();
  };

  const isHeld = (name) => (held.get(name)?.count || 0) > 0;

  return { down, up, releaseAll, isHeld };
}

export function vibrate(ms = 10) {
  try { navigator.vibrate?.(ms); } catch { /* ignora */ }
}
