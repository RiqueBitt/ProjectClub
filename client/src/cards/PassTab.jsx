import { useEffect, useRef, useState } from 'react';
import { CardView, CardBack, Icon, UI } from './CardView.jsx';
import {
  cardsPass, cardsClaimPass, errMsg,
} from './api';
import { sfx } from './sfx';

// Passe da temporada (gratuito) + cosméticos (versos de carta e molduras).

const fmtLeft = (end) => {
  const ms = Math.max(0, new Date(end).getTime() - Date.now());
  const d = Math.floor(ms / 86400000);
  return d > 0 ? `${d} dia(s)` : `${Math.floor(ms / 3600000)}h`;
};

function RewardIcon({ r }) {
  if (r.cosmetic) {
    return r.cosmetic.startsWith('back:')
      ? <span className="tcgpass-rw is-cos"><CardBack variant={r.cosmetic} /></span>
      : <span className="tcgpass-rw is-cos"><span className={`tcgpass-frame f-${r.cosmetic.replace('frame:', '')}`} /></span>;
  }
  if (r.pack) return <span className="tcgpass-rw is-pack"><Icon d={UI.pack} size={22} /></span>;
  return <span className="tcgpass-rw is-coin"><Icon d={UI.coin} size={20} /></span>;
}
const rewardText = (r) => [r.coins ? `${r.coins} moedas` : '', r.pack ? `Pacote (${r.pack} cartas)` : '', r.gems ? `${r.gems} gemas` : '', r.cosmeticName ? `Cosmético: ${r.cosmeticName}` : ''].filter(Boolean).join(' + ');

export function PassTrack({ onWallet }) {
  const [pass, setPass] = useState(null);
  const [err, setErr] = useState('');
  const [got, setGot] = useState(null);
  const trackRef = useRef(null);
  const load = () => cardsPass().then((d) => setPass(d.pass)).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!pass || !trackRef.current) return;
    const el = trackRef.current.querySelector('.tcgpass-node.is-next, .tcgpass-node.is-ready');
    el?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pass?.level]); // eslint-disable-line react-hooks/exhaustive-deps
  const claim = async (lv) => {
    setErr('');
    try { const r = await cardsClaimPass(lv); sfx('epic'); setGot(r.reward); setPass(r.pass); onWallet?.(); } catch (e) { setErr(errMsg(e)); }
  };
  if (!pass) return <p className="tcg-empty">{err || 'Carregando o passe…'}</p>;
  const ready = pass.levels.filter((l) => l.unlocked && !l.claimed).length;
  return (
    <section className="tcgpass">
      <header className="tcgpass-head">
        <div className="tcgpass-lv"><small>Nível</small><b>{pass.level}</b><small>de {pass.max}</small></div>
        <div className="tcgpass-info">
          <h2>Passe da Guerra das Cartas <span className="tcg-dim">· temporada {pass.seasonKey}</span></h2>
          <div className="tcgpass-bar"><i style={{ width: `${pass.level >= pass.max ? 100 : (pass.intoLevel / pass.perLevel) * 100}%` }} /></div>
          <p className="tcg-dim">{pass.level >= pass.max ? 'Passe completo! 🎉' : `${pass.intoLevel}/${pass.perLevel} XP para o nível ${pass.level + 1}`} · termina em {fmtLeft(pass.endsAt)} · XP vem de partidas, missões da Guerra das Cartas e pacotes</p>
        </div>
        {ready > 0 && <span className="tcgpass-ready">{ready} prêmio(s) para resgatar</span>}
      </header>
      {err && <p className="tcg-error">{err}</p>}
      <div className="tcgpass-track" ref={trackRef}>
        {pass.levels.map((l) => {
          const next = !l.unlocked && l.level === pass.level + 1;
          return (
            <div key={l.level} className={`tcgpass-node${l.claimed ? ' is-claimed' : l.unlocked ? ' is-ready' : ''}${next ? ' is-next' : ''}${l.reward.cosmetic ? ' is-big' : ''}`} title={rewardText(l.reward)}>
              <span className="tcgpass-num">{l.level}</span>
              <RewardIcon r={l.reward} />
              <small className="tcgpass-txt">{l.reward.cosmeticName || (l.reward.pack ? 'Pacote' : `${l.reward.coins}`)}{l.reward.gems ? ` +${l.reward.gems}💎` : ''}</small>
              {l.claimed ? <span className="tcgpass-done"><Icon d={UI.check} size={14} /></span>
                : l.unlocked ? <button type="button" className="tcg-btn primary tcg-btn-sm" onClick={() => claim(l.level)}>Pegar</button>
                  : <span className="tcgpass-lock"><Icon d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z" size={13} /></span>}
            </div>
          );
        })}
      </div>
      {got && (
        <div className="tcg-modal" onClick={() => setGot(null)}>
          <div className="tcgpass-got" onClick={(e) => e.stopPropagation()}>
            <h3>Nível {got.level} resgatado!</h3>
            <p>{[got.coins ? `+${got.coins} moedas` : '', got.gems ? `+${got.gems} gemas` : '', got.cosmetic ? `Novo cosmético: ${got.cosmetic.name}` : ''].filter(Boolean).join(' · ')}</p>
            {got.cards?.length > 0 && <div className="tcgpass-cards">{got.cards.map((c, i) => <CardView key={i} card={c} size="sm" tilt={false} />)}</div>}
            {got.cosmetic?.kind === 'BACK' && <div className="tcgpass-cosprev"><CardBack variant={got.cosmetic.key} /></div>}
            <button type="button" className="tcg-btn primary" onClick={() => setGot(null)}>Legal!</button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function PassTab({ onWallet }) {
  return (
    <div className="tcgpass-tab">
      <PassTrack onWallet={onWallet} />
      {/* Versos de cartas agora são vendidos na Loja (categoria Versos de Cartas). */}
      <p className="tcg-dim" style={{ marginTop: 22 }}>Versos de cartas ficam na <a className="tcg-link" href="/loja?cat=versos">Loja → Versos de Cartas</a>.</p>
    </div>
  );
}
