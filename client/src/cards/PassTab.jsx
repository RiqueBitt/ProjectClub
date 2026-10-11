import { useEffect, useRef, useState } from 'react';
import { CardView, CardBack, Icon, UI } from './CardView.jsx';
import {
  cardsPass, cardsClaimPass, cardsCosmetics, cardsBuyCosmetic, cardsEquipCosmetic, errMsg,
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
          <h2>Passe da Arena <span className="tcg-dim">· temporada {pass.seasonKey}</span></h2>
          <div className="tcgpass-bar"><i style={{ width: `${pass.level >= pass.max ? 100 : (pass.intoLevel / pass.perLevel) * 100}%` }} /></div>
          <p className="tcg-dim">{pass.level >= pass.max ? 'Passe completo! 🎉' : `${pass.intoLevel}/${pass.perLevel} XP para o nível ${pass.level + 1}`} · termina em {fmtLeft(pass.endsAt)} · XP vem de partidas, missões da Arena e pacotes</p>
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

export function CosmeticsShop({ wallet, onWallet }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const load = () => cardsCosmetics().then(setData).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, []);
  const run = async (fn, msg) => {
    setErr(''); setOk('');
    try { setData(await fn()); if (msg) setOk(msg); onWallet?.(); } catch (e) { setErr(errMsg(e)); }
  };
  if (!data) return <p className="tcg-empty">{err || 'Carregando…'}</p>;
  const groups = [['BACK', 'Versos de carta', 'Aparecem na sua mão para o oponente, no seu baralho e nas pilhas da mesa.'], ['FRAME', 'Molduras do herói', 'O anel em volta do seu retrato na batalha.']];
  return (
    <section className="tcgcos">
      {err && <p className="tcg-error">{err}</p>}
      {ok && <p className="tcg-ok">{ok}</p>}
      {groups.map(([kind, title, hint]) => (
        <div key={kind} className="tcgcos-group">
          <h3 className="tcg-h3">{title} <small className="tcg-dim">{hint}</small></h3>
          <div className="tcgcos-grid">
            {data.items.filter((i) => i.kind === kind).map((i) => {
              const equipped = (kind === 'BACK' ? data.equipped.back : data.equipped.frame) === i.key;
              return (
                <div key={i.id} className={`tcgcos-item tcg-r-${i.rarity}${equipped ? ' is-on' : ''}`}>
                  <span className="tcgcos-prev">
                    {kind === 'BACK' ? <CardBack variant={i.key} /> : <span className={`tcgpass-frame f-${i.key.replace('frame:', '')}`}><span /></span>}
                  </span>
                  <b>{i.name}</b>
                  <small>{i.source === 'PASS' ? 'Prêmio do passe' : i.source === 'FREE' ? 'Grátis' : `${i.priceGems} gemas`}</small>
                  {equipped ? <span className="tcgcos-on"><Icon d={UI.check} size={13} />Em uso</span>
                    : i.owned ? <button type="button" className="tcg-btn tcg-btn-sm" onClick={() => run(() => cardsEquipCosmetic(i.key), `${i.name} equipado!`)}>Usar</button>
                      : i.source === 'SHOP' ? <button type="button" className="tcg-btn primary tcg-btn-sm" disabled={(wallet?.gems ?? 0) < i.priceGems} onClick={() => run(() => cardsBuyCosmetic(i.id), `${i.name} comprado!`)}><Icon d={UI.gem} size={13} />Comprar</button>
                        : <span className="tcg-dim">Bloqueado</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

export default function PassTab({ wallet, onWallet }) {
  return (
    <div className="tcgpass-tab">
      <PassTrack onWallet={onWallet} />
      <h2 className="tcg-h3" style={{ marginTop: 26 }}>Cosméticos</h2>
      <CosmeticsShop wallet={wallet} onWallet={onWallet} />
    </div>
  );
}
