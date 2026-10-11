import { useState } from 'react';

// Controles na tela pro celular: os jogos esperam teclado (setas/Espaço),
// então cada botão manda o evento de tecla pra dentro do jogo (iframe da
// mesma origem — HTML5 e o player do Ruffle).
const KEYS = {
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  space: { key: ' ', code: 'Space', keyCode: 32 },
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
};

function targetsOf(frame) {
  const out = [];
  try {
    const w = frame?.contentWindow;
    if (!w) return out;
    const add = (win) => {
      if (!win) return;
      const d = win.document;
      const ruffle = d.querySelector('ruffle-player, ruffle-object');
      if (ruffle) out.push(ruffle);
      if (d.activeElement && d.activeElement !== d.body) out.push(d.activeElement);
      out.push(d.body, d, win);
    };
    add(w);
    const inner = w.document.querySelector('iframe')?.contentWindow;
    add(inner);
  } catch { /* outra origem: ignora */ }
  return out;
}

function send(frame, type, k) {
  targetsOf(frame).forEach((t) => {
    try {
      const Ev = (t.ownerDocument?.defaultView || t.defaultView || t).KeyboardEvent || KeyboardEvent;
      const ev = new Ev(type, { key: k.key, code: k.code, bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'keyCode', { get: () => k.keyCode });
      Object.defineProperty(ev, 'which', { get: () => k.keyCode });
      t.dispatchEvent(ev);
    } catch { /* ignora */ }
  });
}

function PadBtn({ frameRef, k, className, label, children }) {
  const down = (e) => { e.preventDefault(); send(frameRef.current, 'keydown', KEYS[k]); };
  const up = (e) => { e.preventDefault(); send(frameRef.current, 'keyup', KEYS[k]); };
  return (
    <button type="button" className={`mj-pad-btn ${className || ''}`} aria-label={label}
      onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </button>
  );
}

const Arrow = ({ rot }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" style={{ transform: `rotate(${rot}deg)` }} aria-hidden="true"><path d="M12 5l7 9H5z" fill="currentColor" /></svg>
);

// Layouts por jogo (catalog.js → pad): 'none' (só toque/arraste), 'lr' (◀ ▶),
// 'lra' (◀ ▶ + A/OK), 'dpad' (4 setas), 'dpada' (4 setas + A/OK) e
// 'arrows' (4 setas em linha, para a Dança).
export default function TouchPad({ frameRef, layout = 'dpada' }) {
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const [show, setShow] = useState(true);
  if (!coarse || layout === 'none') return null;
  const dirs = layout === 'lr' || layout === 'lra' ? ['left', 'right'] : ['up', 'left', 'right', 'down'];
  const action = layout === 'lra' || layout === 'dpada';
  const ROT = { up: 0, right: 90, down: 180, left: -90 };
  const LABEL = { up: 'Cima', down: 'Baixo', left: 'Esquerda', right: 'Direita' };
  return (
    <>
      <button type="button" className="mj-pad-toggle" onClick={() => setShow((v) => !v)} aria-pressed={show}>
        {show ? 'Esconder controles' : 'Mostrar controles'}
      </button>
      {show && (
        <div className={`mj-pad is-${layout}`} aria-label="Controles na tela">
          {layout === 'arrows' ? (
            <div className="mj-pad-row">
              {['left', 'down', 'up', 'right'].map((d) => <PadBtn key={d} frameRef={frameRef} k={d} className="row" label={LABEL[d]}><Arrow rot={ROT[d]} /></PadBtn>)}
            </div>
          ) : (
            <div className={`mj-pad-dpad${dirs.length === 2 ? ' is-lr' : ''}`}>
              {dirs.map((d) => <PadBtn key={d} frameRef={frameRef} k={d} className={d} label={LABEL[d]}><Arrow rot={ROT[d]} /></PadBtn>)}
            </div>
          )}
          {action && (
            <div className="mj-pad-actions">
              <PadBtn frameRef={frameRef} k="enter" className="small" label="Confirmar">OK</PadBtn>
              <PadBtn frameRef={frameRef} k="space" className="big" label="Ação">A</PadBtn>
            </div>
          )}
        </div>
      )}
    </>
  );
}
