import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TOUR_STEPS, placePopover } from './tourSteps';
import { useFocusTrap } from './useFocusTrap';

// Tour de boas-vindas: destaca uma parte da interface por vez (recorte
// escuro em volta do alvo) com um balão explicando. Acessível: é um
// diálogo modal (role="dialog", aria-modal), o Tab fica preso nele, Esc
// pula o tour, ← / → navegam, e o texto do passo é anunciado.
function findTarget(selectors) {
  for (const sel of selectors || []) {
    let list = [];
    try { list = [...document.querySelectorAll(sel)]; } catch { list = []; }
    for (const el of list) {
      const r = el.getBoundingClientRect();
      const visible = r.width > 4 && r.height > 4 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
      if (visible && getComputedStyle(el).visibility !== 'hidden') return el;
    }
  }
  return null;
}

const PAD = 6;

export default function WelcomeTour({ onClose }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999, side: 'center' });
  const popRef = useRef(null);
  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;

  const finish = useCallback((completed) => onClose?.({ completed }), [onClose]);
  useFocusTrap(popRef, { active: true, onEscape: () => finish(false), initialFocus: '[data-tour-primary]' });

  // Mede o alvo (e acompanha rolagem/redimensionamento).
  const measure = useCallback((scroll = false) => {
    const el = findTarget(step.target);
    if (el) {
      if (scroll) { try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* ok */ } }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    } else setRect(null);
  }, [step]);
  useLayoutEffect(() => { measure(true); }, [measure]);
  useEffect(() => {
    let raf = 0;
    const onChange = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => measure(false)); };
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onChange); window.removeEventListener('scroll', onChange, true); };
  }, [measure]);
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const size = { width: pop.offsetWidth, height: pop.offsetHeight };
    setPos(placePopover(rect, size, { width: window.innerWidth, height: window.innerHeight }));
  }, [rect, index]);

  // ← / → também navegam (fora de campos de texto, que não existem aqui).
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); if (last) finish(true); else setIndex((i) => i + 1); }
      if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); setIndex((i) => i - 1); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [index, last, finish]);

  return createPortal(
    <div className="pc-tour" data-side={pos.side}>
      {/* Recorte: sem alvo, a tela inteira escurece. */}
      <div
        className={`pc-tour-spot${rect ? '' : ' is-empty'}`}
        aria-hidden="true"
        style={rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : undefined}
      />
      <div
        ref={popRef}
        className="pc-tour-pop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pc-tour-title"
        aria-describedby="pc-tour-body"
        style={{ top: pos.top, left: pos.left }}
        tabIndex={-1}
      >
        <div className="pc-tour-head">
          <span className="pc-tour-count" aria-hidden="true">{index + 1} / {TOUR_STEPS.length}</span>
          <button type="button" className="pc-tour-skip" onClick={() => finish(false)}>Pular tour</button>
        </div>
        <h2 id="pc-tour-title" className="pc-tour-title" aria-live="polite">
          <span className="pc-sr-only">Passo {index + 1} de {TOUR_STEPS.length}: </span>{step.title}
        </h2>
        <p id="pc-tour-body" className="pc-tour-body">{step.body}</p>
        <div className="pc-tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((s, i) => <span key={s.id} className={i === index ? 'is-on' : i < index ? 'is-done' : ''} />)}
        </div>
        <div className="pc-tour-actions">
          {index > 0 && <button type="button" className="pc-btn pc-btn-ghost" onClick={() => setIndex((i) => i - 1)}>Voltar</button>}
          <button
            type="button" className="pc-btn pc-btn-primary" data-tour-primary
            onClick={() => (last ? finish(true) : setIndex((i) => i + 1))}
          >
            {last ? 'Concluir' : index === 0 ? 'Começar' : 'Próximo'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
