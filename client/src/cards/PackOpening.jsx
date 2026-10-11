import { useEffect, useState } from 'react';
import { CardView, Icon, UI, RARITIES, RARITY_ORDER } from './CardView.jsx';
import { sfx } from './sfx';

// Abertura de pacote: o pacote treme, explode em luz e as cartas são viradas
// uma a uma (clique ou "Revelar todas"). Raridade alta = brilho maior.
export default function PackOpening({ pack, cards, onClose, onAgain, canAgain }) {
  const [phase, setPhase] = useState('shake'); // shake → burst → cards
  const [revealed, setRevealed] = useState(() => new Set());
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    sfx('pack');
    const t1 = setTimeout(() => setPhase('burst'), reduce ? 50 : 900);
    const t2 = setTimeout(() => setPhase('cards'), reduce ? 100 : 1400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const best = cards.reduce((b, c) => Math.max(b, RARITY_ORDER.indexOf(c.rarity)), 0);
  const bestColor = RARITIES[RARITY_ORDER[best]]?.color || '#fff';
  const all = revealed.size >= cards.length;
  return (
    <div className="tcgp-overlay" role="dialog" aria-label={`Abrindo ${pack.name}`} style={{ '--best': bestColor, '--pack': pack.color }}>
      {phase !== 'cards' && (
        <div className={`tcgp-pack is-${phase}`}>
          <span className="tcgp-pack-face"><Icon d={UI.pack} size={64} sw={1.6} /><b>{pack.name}</b></span>
          <span className="tcgp-rays" />
        </div>
      )}
      {phase === 'cards' && (
        <>
          <h2 className="tcgp-title">{all ? 'Suas novas cartas' : 'Clique nas cartas para revelar'}</h2>
          <div className="tcgp-cards">
            {cards.map((c, i) => {
              const open = revealed.has(i);
              return (
                <button
                  key={i} type="button" className={`tcgp-slot${open ? ' is-open' : ''} tcg-r-${c.rarity}`}
                  style={{ '--d': `${i * 70}ms`, '--rar': RARITIES[c.rarity]?.color }}
                  onClick={() => { if (!revealed.has(i)) sfx(RARITY_ORDER.indexOf(c.rarity) >= 3 || c.foil ? 'epic' : 'play'); setRevealed((s) => new Set(s).add(i)); }}
                  aria-label={open ? `${c.name}, ${RARITIES[c.rarity]?.label}` : 'Revelar carta'}
                >
                  <span className="tcgp-flip">
                    <span className="tcgp-back"><Icon d={UI.star} size={30} /></span>
                    <span className="tcgp-front"><CardView card={c} size="md" /></span>
                  </span>
                  {open && c.isNew && <span className="tcgp-new">Nova!</span>}
                  {open && c.foil && <span className="tcgp-new is-foil">✦ Brilhante!</span>}
                  {open && RARITY_ORDER.indexOf(c.rarity) >= 3 && <span className="tcgp-glow" />}
                </button>
              );
            })}
          </div>
          <div className="tcgp-actions">
            {!all && <button type="button" className="tcg-btn" onClick={() => setRevealed(new Set(cards.map((_, i) => i)))}>Revelar todas</button>}
            {all && canAgain && <button type="button" className="tcg-btn primary" onClick={onAgain}>Abrir outro</button>}
            <button type="button" className="tcg-btn ghost" onClick={onClose}>Fechar</button>
          </div>
        </>
      )}
    </div>
  );
}
