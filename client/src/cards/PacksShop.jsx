import { useEffect, useState } from 'react';
import { Icon, UI, RARITIES, RARITY_ORDER } from './CardView.jsx';
import PackOpening from './PackOpening.jsx';
import { cardsPacks, cardsOpenPack, errMsg } from './api';
import '../styles/cards.css';

// Loja de pacotes do Jogo de Cartas — usada na Arena (aba Pacotes) e na
// Loja do Project Club (categoria Cartas). A compra e o sorteio acontecem
// no servidor; aqui só mostramos e animamos a abertura.
export default function PacksTab({ home, onOpened }) {
  const [packs, setPacks] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null);
  const [opening, setOpening] = useState(null);
  const load = () => cardsPacks().then((d) => setPacks(d.packs)).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, []);
  const open = async (p, currency) => {
    setBusy(p.id + currency); setErr('');
    try {
      const r = await cardsOpenPack(p.id, currency);
      setOpening({ pack: p, cards: r.cards, currency });
      onOpened(r.wallet);
      load();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  };
  if (!home.enabled.packs) return <p className="tcg-empty">A loja de pacotes está fechada no momento.</p>;
  return (
    <div>
      {err && <p className="tcg-error">{err}</p>}
      <div className="tcg-packs">
        {packs === null && <p className="tcg-empty">Carregando…</p>}
        {packs?.map((p) => {
          const total = Object.values(p.weights).reduce((s, n) => s + Number(n || 0), 0) || 1;
          const limit = p.dailyLimit ? p.dailyLimit - p.openedToday : null;
          return (
            <div key={p.id} className="tcg-pack" style={{ '--pack': p.color }}>
              <div className="tcg-pack-art">
                {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <span className="tcg-pack-gfx"><Icon d={UI.pack} size={54} sw={1.5} /></span>}
                <span className="tcg-pack-n">{p.cardsPerPack} cartas</span>
              </div>
              <div className="tcg-pack-body">
                <h3 data-no-translate>{p.name}</h3>
                {p.description && <p>{p.description}</p>}
                <div className="tcg-odds" aria-label="Chances por carta">
                  {RARITY_ORDER.filter((r) => Number(p.weights[r]) > 0).map((r) => (
                    <span key={r} style={{ '--c': RARITIES[r].color }}><i />{RARITIES[r].label} {((Number(p.weights[r]) / total) * 100).toFixed(Number(p.weights[r]) / total < 0.01 ? 2 : 1)}%</span>
                  ))}
                </div>
                {p.guaranteed && <small className="tcg-dim">Garantia: pelo menos 1 carta {RARITIES[p.guaranteed]?.label} ou melhor.</small>}
                {limit !== null && <small className="tcg-dim">Hoje: {Math.max(0, limit)} de {p.dailyLimit} restantes.</small>}
                <div className="tcg-pack-buy">
                  {p.priceCoins !== null && p.priceCoins !== undefined && (
                    <button type="button" className="tcg-btn primary" disabled={!!busy || limit === 0 || (home.wallet?.coins ?? 0) < p.priceCoins} onClick={() => open(p, 'coins')}>
                      <Icon d={UI.coin} />{busy === p.id + 'coins' ? 'Abrindo…' : p.priceCoins.toLocaleString('pt-BR')}
                    </button>
                  )}
                  {p.priceGems !== null && p.priceGems !== undefined && (
                    <button type="button" className="tcg-btn gem" disabled={!!busy || limit === 0 || (home.wallet?.gems ?? 0) < p.priceGems} onClick={() => open(p, 'gems')}>
                      <Icon d={UI.gem} />{busy === p.id + 'gems' ? 'Abrindo…' : p.priceGems.toLocaleString('pt-BR')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="tcg-dim tcg-note">As chances são por carta. Cada pacote é sorteado no servidor no momento da compra.</p>
      {opening && (
        <PackOpening
          pack={opening.pack} cards={opening.cards}
          canAgain={(() => { const p = packs?.find((x) => x.id === opening.pack.id); const price = opening.currency === 'gems' ? p?.priceGems : p?.priceCoins; return p && (home.wallet?.[opening.currency] ?? 0) >= price && (!p.dailyLimit || p.openedToday < p.dailyLimit); })()}
          onAgain={() => { const p = packs.find((x) => x.id === opening.pack.id); setOpening(null); open(p, opening.currency); }}
          onClose={() => setOpening(null)}
        />
      )}
    </div>
  );
}
