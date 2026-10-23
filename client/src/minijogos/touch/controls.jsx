import { useEffect, useRef, useState } from 'react';
import { vibrate } from './gameInput.js';

// Peças dos controles na tela: direcional (4/8 direções, dá pra deslizar o
// dedo entre as setas), analógico flutuante, setas soltas e botões de ação.
// Cada peça acompanha o(s) próprio(s) dedo(s) por pointerId, então mover e
// apertar ação ao mesmo tempo (multitoque) funciona.

const DIRS4 = ['right', 'down', 'left', 'up'];
const ROT = { up: 0, right: 90, down: 180, left: 270 };
const LABEL = { up: 'Cima', down: 'Baixo', left: 'Esquerda', right: 'Direita' };

// Ângulo (0 = direita, sentido horário, tela tem y pra baixo) → teclas.
function keysForVector(dx, dy, mode, dead) {
  const dist = Math.hypot(dx, dy);
  if (dist < dead) return [];
  const a = (Math.atan2(dy, dx) * 180) / Math.PI; // -180..180
  if (mode === 8) {
    const sector = Math.round(((a + 360) % 360) / 45) % 8;
    return [['right'], ['right', 'down'], ['down'], ['down', 'left'], ['left'], ['left', 'up'], ['up'], ['up', 'right']][sector];
  }
  const sector = Math.round(((a + 360) % 360) / 90) % 4;
  return [DIRS4[sector]];
}

function useHeldKeys(input) {
  const cur = useRef([]);
  const [active, setActive] = useState([]);
  const apply = (next) => {
    const prev = cur.current;
    if (prev.length === next.length && prev.every((k) => next.includes(k))) return;
    prev.filter((k) => !next.includes(k)).forEach((k) => input.up(k));
    const added = next.filter((k) => !prev.includes(k));
    added.forEach((k) => input.down(k));
    if (added.length) vibrate(8);
    cur.current = next;
    setActive(next);
  };
  useEffect(() => () => { cur.current.forEach((k) => input.up(k)); cur.current = []; }, [input]);
  return [active, apply];
}

export function Arrow({ dir, size = 26 }) {
  return (
    <svg className="mjt-arrow" width={size} height={size} viewBox="0 0 24 24" style={{ transform: `rotate(${ROT[dir]}deg)` }} aria-hidden="true">
      <path d="M12 4.5 20.5 17.5a1.2 1.2 0 0 1-1 1.8H4.5a1.2 1.2 0 0 1-1-1.8z" fill="currentColor" />
    </svg>
  );
}

// Acompanha um dedo (pointerId) do toque até soltar, mesmo se sair do
// elemento (pointer capture). Os callbacks mais recentes ficam num ref.
function usePointerTrack(onVector, onEnd) {
  const id = useRef(null);
  const cb = useRef({ onVector, onEnd });
  cb.current = { onVector, onEnd };
  const end = (e) => { if (id.current === e.pointerId) { id.current = null; cb.current.onEnd(); } };
  return {
    onPointerDown: (e) => {
      e.preventDefault();
      if (id.current !== null) return;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignora */ }
      id.current = e.pointerId;
      cb.current.onVector(e, true);
    },
    onPointerMove: (e) => { if (id.current === e.pointerId) cb.current.onVector(e, false); },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    onContextMenu: (e) => e.preventDefault(),
  };
}

// Direcional em cruz: um único alvo redondo; a direção sai da posição do
// dedo em relação ao centro, então deslizar troca de seta sem levantar.
export function DPad({ input, mode = 4, size = 148 }) {
  const ref = useRef(null);
  const [active, apply] = useHeldKeys(input);
  const handlers = usePointerTrack((e) => {
    const r = ref.current.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    apply(keysForVector(dx, dy, mode, r.width * 0.12));
  }, () => apply([]));
  return (
    <div ref={ref} className="mjt-dpad" style={{ '--s': `${size}px` }} role="group" aria-label="Direcional" data-testid="mjt-dpad" {...handlers}>
      {['up', 'right', 'down', 'left'].map((d) => (
        <span key={d} className={`mjt-dpad-btn is-${d}${active.includes(d) ? ' is-on' : ''}`} aria-label={LABEL[d]} data-dir={d}>
          <Arrow dir={d} />
        </span>
      ))}
      <span className="mjt-dpad-hub" aria-hidden="true" />
    </div>
  );
}

// Analógico flutuante: encosta o dedo em qualquer lugar da área e a base
// aparece ali; o quanto o dedo se afasta escolhe a(s) seta(s) (8 direções).
export function Joystick({ input, radius = 56 }) {
  const ref = useRef(null);
  const base = useRef(null);
  const [active, apply] = useHeldKeys(input);
  const [stick, setStick] = useState(null); // { x, y, kx, ky }
  const handlers = usePointerTrack((e, first) => {
    const r = ref.current.getBoundingClientRect();
    const x = e.clientX - r.left; const y = e.clientY - r.top;
    if (first || !base.current) base.current = { x, y };
    let dx = x - base.current.x; let dy = y - base.current.y;
    const d = Math.hypot(dx, dy);
    if (d > radius) { dx = (dx / d) * radius; dy = (dy / d) * radius; }
    apply(keysForVector(dx, dy, 8, radius * 0.3));
    setStick({ x: base.current.x, y: base.current.y, kx: dx, ky: dy });
  }, () => { base.current = null; setStick(null); apply([]); });
  return (
    <div ref={ref} className="mjt-joy-zone" role="group" aria-label="Analógico" data-testid="mjt-joystick" data-active={active.join(' ')} {...handlers}>
      {stick ? (
        <span className="mjt-joy-base" style={{ left: stick.x, top: stick.y, '--r': `${radius}px` }}>
          <span className="mjt-joy-knob" style={{ transform: `translate(${stick.kx}px, ${stick.ky}px)` }} />
        </span>
      ) : (
        <span className="mjt-joy-base is-idle" style={{ '--r': `${radius}px` }} aria-hidden="true"><span className="mjt-joy-knob" /></span>
      )}
    </div>
  );
}

// Botão solto (seta grande ou ação). keyName = tecla em KEYS.
export function KeyButton({ input, keyName, className = '', label, children, repeat, testId }) {
  const [on, setOn] = useState(false);
  const ids = useRef(new Set());
  const press = (e) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignora */ }
    if (ids.current.size === 0) { input.down(keyName, { repeat }); setOn(true); vibrate(10); }
    ids.current.add(e.pointerId);
  };
  const release = (e) => {
    if (!ids.current.delete(e.pointerId)) return;
    if (ids.current.size === 0) { input.up(keyName); setOn(false); }
  };
  useEffect(() => () => { if (ids.current.size) { ids.current.clear(); input.up(keyName); } }, [input, keyName]);
  return (
    <button
      type="button" tabIndex={-1} className={`mjt-key ${className}${on ? ' is-on' : ''}`} aria-label={label} data-testid={testId}
      onPointerDown={press} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}
