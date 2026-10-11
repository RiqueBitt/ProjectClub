import { useMemo, useState } from 'react';
import { CardView, Icon, UI } from './CardView.jsx';
import { errMsg } from './api';
import { sfx } from './sfx';

// Primeiro acesso à Arena: apresenta o jogo e entrega o pacote de
// boas-vindas (cartas comuns). Quem decide e entrega é o servidor — só
// uma vez por conta.
const STEPS = [
  { icon: UI.pack, title: 'Colecione', text: 'Abra pacotes com moedas e gemas. Raras, épicas, lendárias — e brilhantes!' },
  { icon: UI.deck, title: 'Monte seu baralho', text: 'Combine elementos, habilidades e feitiços num baralho do seu jeito.' },
  { icon: UI.sword, title: 'Batalhe', text: 'Duele contra bots, amigos e na partida rápida. Vencer dá moedas e sobe na temporada.' },
];

export default function WelcomeModal({ home, user, cards = [], onClaim, onLater }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const show = useMemo(() => {
    const pool = cards.filter((c) => c.rarity === 'COMUM' && c.kind !== 'SPELL');
    return pool.length >= 3 ? [pool[0], pool[Math.floor(pool.length / 2)], pool[pool.length - 1]] : [];
  }, [cards]);
  const n = home.starterCount || home.rules.deckSize;
  const claim = async () => {
    setBusy(true); setErr('');
    try { sfx('pack'); await onClaim(); } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <div className="tcgw" role="dialog" aria-modal="true" aria-labelledby="tcgw-title">
      <div className="tcgw-box">
        <div className="tcgw-glow" aria-hidden="true" />
        {show.length > 0 && (
          <div className="tcgw-fan" aria-hidden="true">
            {show.map((c, i) => <div key={c.id} className="tcgw-fan-card" style={{ '--i': i - 1 }}><CardView card={c} size="sm" tilt={false} /></div>)}
          </div>
        )}
        <p className="tcgw-kicker">Novo jogo no Project Club</p>
        <h2 id="tcgw-title">Bem-vindo à Arena de Cartas{user?.displayName ? `, ${user.displayName}` : ''}!</h2>
        <p className="tcgw-sub">Um jogo de cartas colecionáveis com batalhas de verdade, direto na comunidade.</p>
        <ol className="tcgw-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} style={{ '--d': `${200 + i * 120}ms` }}>
              <span className="tcgw-step-icon"><Icon d={s.icon} size={20} /></span>
              <span><b>{s.title}</b><small>{s.text}</small></span>
            </li>
          ))}
        </ol>
        <div className="tcgw-gift">
          <span className="tcgw-gift-box" aria-hidden="true"><Icon d={UI.pack} size={30} /></span>
          <span><b>Presente de boas-vindas</b><small>{n} cartas comuns pra montar seu primeiro baralho e já começar a batalhar.</small></span>
        </div>
        {err && <p className="tcg-error">{err}</p>}
        <div className="tcgw-actions">
          <button type="button" className="tcg-btn ghost" onClick={onLater} disabled={busy}>Depois</button>
          <button type="button" className="tcg-btn primary tcg-btn-xl" onClick={claim} disabled={busy}>{busy ? 'Abrindo…' : 'Abrir meu presente'}</button>
        </div>
      </div>
    </div>
  );
}
