import { useEffect, useState } from 'react';
import UserAvatar from '../components/UserAvatar.jsx';
import { CardView, RARITIES, RARITY_ORDER, Icon, UI } from './CardView.jsx';
import { cardsMarket, cardsBuyListing, cardsCancelListing, errMsg } from './api';
import { sfx } from './sfx';

// Mercado: compre cartas que outros jogadores anunciaram. Para vender, abra a
// carta na Coleção e use "Anunciar no mercado". A carta fica guardada até
// vender ou você cancelar.
export default function Market({ me, wallet, onWallet, onChanged }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [rarity, setRarity] = useState('');
  const [sort, setSort] = useState('recent');
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState('');
  const load = () => cardsMarket({ q: q || undefined, rarity: rarity || undefined, sort }).then(setData).catch((e) => setMsg({ err: errMsg(e) }));
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q, rarity, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const buy = async (l) => {
    if (!window.confirm(`Comprar ${l.card.name}${l.foil ? ' (brilhante)' : ''} por ${l.price} moedas?`)) return;
    setBusy(l.id); setMsg({});
    try { const r = await cardsBuyListing(l.id); sfx('pack'); onWallet?.(r.wallet); onChanged?.(); setMsg({ ok: `Você comprou ${l.card.name}!` }); load(); } catch (e) { setMsg({ err: errMsg(e) }); load(); } finally { setBusy(''); }
  };
  const cancel = async (l) => {
    try { await cardsCancelListing(l.id); setMsg({ ok: 'Anúncio cancelado — a carta voltou para sua coleção.' }); onChanged?.(); load(); } catch (e) { setMsg({ err: errMsg(e) }); }
  };
  if (data && !data.enabled) return <p className="tcg-empty">O mercado está fechado no momento.</p>;
  const mineActive = (data?.mine || []).filter((l) => l.status === 'ACTIVE');
  return (
    <div className="tcg-market">
      <div className="tcg-section-head">
        <p>Compre cartas anunciadas por outros jogadores. Para vender, abra uma carta na <b>Coleção</b> e escolha <b>Anunciar no mercado</b>. Taxa de venda: {data?.tax ?? 10}%.</p>
        <span className="tcg-wallet"><span><Icon d={UI.coin} size={16} />{(wallet?.coins ?? 0).toLocaleString('pt-BR')}</span></span>
      </div>
      {msg.err && <p className="tcg-error">{msg.err}</p>}
      {msg.ok && <p className="tcg-ok">{msg.ok}</p>}
      {mineActive.length > 0 && (
        <>
          <h3 className="tcg-h3">Suas cartas à venda ({mineActive.length}/{data.maxListings})</h3>
          <div className="tcg-listings">
            {mineActive.map((l) => (
              <div key={l.id} className="tcg-listing is-mine">
                <CardView card={{ ...l.card, foil: l.foil }} size="sm" />
                <b className="tcg-listing-price"><Icon d={UI.coin} size={14} />{l.price}</b>
                <button type="button" className="tcg-btn ghost tcg-btn-sm" onClick={() => cancel(l)}>Cancelar</button>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="tcg-filters">
        <label className="tcg-search"><Icon d={UI.search} size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar carta" aria-label="Buscar carta" /></label>
        <div className="tcg-chips">
          <button type="button" className={!rarity ? 'on' : ''} onClick={() => setRarity('')}>Todas</button>
          {RARITY_ORDER.map((r) => <button key={r} type="button" className={rarity === r ? 'on' : ''} style={{ '--el': RARITIES[r].color }} onClick={() => setRarity(rarity === r ? '' : r)}>{RARITIES[r].label}</button>)}
        </div>
        <select className="tcg-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
          <option value="recent">Mais recentes</option><option value="cheap">Mais baratas</option><option value="expensive">Mais caras</option>
        </select>
      </div>
      <div className="tcg-listings">
        {data === null && <p className="tcg-empty">Carregando…</p>}
        {data?.listings.filter((l) => l.seller?.id !== me.id).map((l) => (
          <div key={l.id} className="tcg-listing">
            <CardView card={{ ...l.card, foil: l.foil }} size="sm" />
            <span className="tcg-listing-seller"><UserAvatar user={l.seller || {}} size={18} /><span data-no-translate>{l.seller?.displayName}</span></span>
            <button type="button" className="tcg-btn primary tcg-btn-sm" disabled={busy === l.id || (wallet?.coins ?? 0) < l.price} onClick={() => buy(l)}><Icon d={UI.coin} size={14} />{l.price.toLocaleString('pt-BR')}</button>
          </div>
        ))}
        {data && !data.listings.filter((l) => l.seller?.id !== me.id).length && <p className="tcg-empty">Nenhuma carta à venda agora.</p>}
      </div>
    </div>
  );
}
