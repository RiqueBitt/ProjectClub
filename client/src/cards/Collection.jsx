import { useEffect, useMemo, useRef, useState } from 'react';
import { CardView, ELEMENTS, RARITIES, RARITY_ORDER, ABILITIES, Icon, UI, abilityText } from './CardView.jsx';
import { cardsSell, cardsSellFoil, cardsLevelUp, cardsCreateListing, errMsg } from './api';
import { sfx } from './sfx';

// Coleção: álbum por coleção (com silhueta das que faltam) ou grade com
// filtros. A carta abre num detalhe 3D (inclina com o mouse) com evoluir,
// vender, anunciar no mercado e compartilhar.

function TiltCard({ card }) {
  const ref = useRef(null);
  const [t, setT] = useState({ x: 0, y: 0, gx: 50, gy: 50 });
  const onMove = (e) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    setT({ x: (0.5 - py) * 18, y: (px - 0.5) * 22, gx: px * 100, gy: py * 100 });
  };
  return (
    <div
      ref={ref} className="tcg-tilt" onMouseMove={onMove} onMouseLeave={() => setT({ x: 0, y: 0, gx: 50, gy: 50 })}
      style={{ '--rx': `${t.x}deg`, '--ry': `${t.y}deg`, '--gx': `${t.gx}%`, '--gy': `${t.gy}%` }}
    >
      <CardView card={card} size="lg" />
      <span className="tcg-tilt-glare" aria-hidden="true" />
    </div>
  );
}

export function CardModal({ card, home, onClose, onChanged }) {
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState('');
  const [listFoil, setListFoil] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const lvIdx = (card.level || 1) - 1;
  const needCopies = home.economy.levelUpCopies[lvIdx] ?? home.economy.levelUpCopies.at(-1);
  const needCoins = home.economy.levelUpCoins[lvIdx] ?? home.economy.levelUpCoins.at(-1);
  const maxed = (card.level || 1) >= home.rules.levelCap;
  const sellValue = home.economy.sellValues[card.rarity] || 0;
  const run = async (fn, msg) => {
    setBusy(true); setErr(''); setOk('');
    try { const r = await fn(); if (msg) setOk(msg); sfx('click'); onChanged(r); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const share = async () => {
    const url = `${window.location.origin}/cartas?carta=${card.id}`;
    try { await navigator.clipboard.writeText(url); setOk('Link copiado! Cole no chat para mostrar a carta.'); } catch { setOk(url); }
  };
  const ab = ABILITIES[card.ability];
  return (
    <div className="tcg-modal" role="dialog" aria-label={card.name} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tcg-modal-box">
        <button type="button" className="tcg-icon-btn tcg-modal-x" onClick={onClose} aria-label="Fechar"><Icon d={UI.close} /></button>
        <TiltCard card={card} />
        <div className="tcg-modal-info">
          <h2 data-no-translate>{card.name}</h2>
          <p className="tcg-tags">
            <span style={{ '--c': RARITIES[card.rarity]?.color }}>{RARITIES[card.rarity]?.label}</span>
            <span style={{ '--c': ELEMENTS[card.element]?.color }}>{ELEMENTS[card.element]?.label}</span>
            <span>{card.kind === 'SPELL' ? 'Feitiço' : 'Unidade'}</span>
            <span>{card.collection}</span>
            <span>Força {card.power}</span>
            {card.foil > 0 && <span style={{ '--c': '#ff4fa3' }}>✦ {card.foil} brilhante(s)</span>}
          </p>
          {ab?.label && <p><b>{ab.label}:</b> {abilityText(card.ability, card.abilityValue)}</p>}
          {card.description && <p>{card.description}</p>}
          {card.flavor && <p className="tcg-flavor">“{card.flavor}”</p>}
          {card.kind !== 'SPELL' && <p className="tcg-dim">Forte contra: {(home.meta.elements.find((e) => e.key === card.element)?.beats || []).map((b) => ELEMENTS[b]?.label).join(', ') || '—'} (+{home.rules.elementBonus} de dano)</p>}
          {card.quantity > 0 ? (
            <div className="tcg-modal-actions">
              <div className="tcg-stat-row"><span>Você tem <b>{card.quantity}</b></span><span>Nível <b>{card.level}</b>/{home.rules.levelCap}</span></div>
              {!maxed && (
                <button type="button" className="tcg-btn primary" disabled={busy || card.quantity < needCopies + 1} onClick={() => run(() => cardsLevelUp(card.id), `Evoluiu para o nível ${card.level + 1}!`)}>
                  <Icon d={UI.up} />Evoluir para Nv {card.level + 1} · {needCopies} cópia(s) + {needCoins} moedas
                </button>
              )}
              {home.enabled.sell && (
                <div className="tcg-row-btns">
                  <button type="button" className="tcg-btn" disabled={busy || card.quantity < 2} onClick={() => run(() => cardsSell(card.id, 1), 'Vendida!')}><Icon d={UI.coin} />Vender 1 (+{sellValue})</button>
                  {card.foil > 0 && <button type="button" className="tcg-btn" disabled={busy || card.quantity < 2} onClick={() => run(() => cardsSellFoil(card.id), 'Brilhante vendida!')}>✦ Vender brilhante (+{sellValue * (home.economy.foilSellMultiplier || 3)})</button>}
                </div>
              )}
              {home.enabled.market !== false && (
                <div className="tcg-market-sell">
                  <input type="number" min="1" placeholder="Preço em moedas" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Preço" />
                  {card.foil > 0 && <label className="tcg-check"><input type="checkbox" checked={listFoil} onChange={(e) => setListFoil(e.target.checked)} />Brilhante</label>}
                  <button type="button" className="tcg-btn" disabled={busy || !(Number(price) > 0)} onClick={() => run(() => cardsCreateListing({ cardId: card.id, price: Number(price), foil: listFoil }), 'Anunciada no mercado!')}>Anunciar no mercado</button>
                </div>
              )}
              {card.quantity < 2 && <small className="tcg-dim">Evoluir e vender usam só cópias repetidas.</small>}
            </div>
          ) : <p className="tcg-dim">Você ainda não tem esta carta. Abra pacotes, compre no mercado ou troque com outros jogadores.</p>}
          <button type="button" className="tcg-btn ghost" onClick={share} style={{ marginTop: 8 }}><Icon d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13" />Compartilhar</button>
          {err && <p className="tcg-error">{err}</p>}
          {ok && <p className="tcg-ok">{ok}</p>}
        </div>
      </div>
    </div>
  );
}

function Silhouette({ card, onClick }) {
  return (
    <button type="button" className="tcg-sil tcg-md" style={{ '--rar': RARITIES[card.rarity]?.color }} onClick={onClick} aria-label={`${card.name} (você não tem)`}>
      <span className="tcg-sil-cost">{card.cost}</span>
      <span className="tcg-sil-q">?</span>
      <span className="tcg-sil-name">{card.name}</span>
      <span className="tcg-sil-rar">{RARITIES[card.rarity]?.label}</span>
    </button>
  );
}

export default function Collection({ cards, home, onChanged, openId, onOpenChange }) {
  const [view, setView] = useState(() => { try { return localStorage.getItem('pc-cards-view') || 'album'; } catch { return 'album'; } });
  const [q, setQ] = useState('');
  const [el, setEl] = useState('');
  const [rar, setRar] = useState('');
  const [kind, setKind] = useState('');
  const [onlyOwned, setOnlyOwned] = useState(false);
  const [sort, setSort] = useState('cost');
  const setV = (v) => { setView(v); try { localStorage.setItem('pc-cards-view', v); } catch { /* ignora */ } };
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = cards.filter((c) => (!el || c.element === el) && (!rar || c.rarity === rar) && (!kind || (c.kind || 'UNIT') === kind) && (!onlyOwned || c.quantity > 0) && (!t || c.name.toLowerCase().includes(t)));
    const s = {
      cost: (a, b) => a.cost - b.cost || a.name.localeCompare(b.name),
      rarity: (a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity) || a.cost - b.cost,
      power: (a, b) => b.power - a.power,
      owned: (a, b) => b.quantity - a.quantity,
    }[sort];
    return [...list].sort(s);
  }, [cards, q, el, rar, kind, onlyOwned, sort]);
  const groups = useMemo(() => {
    const m = new Map();
    for (const c of filtered) { if (!m.has(c.collection)) m.set(c.collection, []); m.get(c.collection).push(c); }
    return [...m];
  }, [filtered]);
  const owned = cards.filter((c) => c.quantity > 0).length;
  const current = openId ? cards.find((c) => c.id === openId) : null;
  return (
    <div>
      <div className="tcg-progress">
        <span>Coleção: <b>{owned}</b> de <b>{cards.length}</b></span>
        <span className="tcg-bar"><i style={{ width: `${cards.length ? (owned / cards.length) * 100 : 0}%` }} /></span>
        <span className="tcg-dim">✦ {cards.filter((c) => c.foil > 0).length} brilhantes</span>
        <span className="tcgb-spacer" />
        <div className="tcg-seg" role="group" aria-label="Modo de exibição">
          <button type="button" className={view === 'album' ? 'on' : ''} onClick={() => setV('album')}>Álbum</button>
          <button type="button" className={view === 'grid' ? 'on' : ''} onClick={() => setV('grid')}>Grade</button>
        </div>
      </div>
      <div className="tcg-filters">
        <label className="tcg-search"><Icon d={UI.search} size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar carta" aria-label="Buscar carta" /></label>
        <div className="tcg-chips">
          <button type="button" className={!el ? 'on' : ''} onClick={() => setEl('')}>Todos</button>
          {Object.entries(ELEMENTS).map(([k, v]) => <button key={k} type="button" className={el === k ? 'on' : ''} style={{ '--el': v.color }} onClick={() => setEl(el === k ? '' : k)}><Icon d={v.glyph} size={12} />{v.label}</button>)}
        </div>
        <div className="tcg-chips">
          {RARITY_ORDER.map((r) => <button key={r} type="button" className={rar === r ? 'on' : ''} style={{ '--el': RARITIES[r].color }} onClick={() => setRar(rar === r ? '' : r)}>{RARITIES[r].label}</button>)}
          <button type="button" className={kind === 'SPELL' ? 'on' : ''} onClick={() => setKind(kind === 'SPELL' ? '' : 'SPELL')}>Feitiços</button>
        </div>
        <label className="tcg-check"><input type="checkbox" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} />Só as que tenho</label>
        <select className="tcg-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
          <option value="cost">Custo</option><option value="rarity">Raridade</option><option value="power">Força</option><option value="owned">Quantidade</option>
        </select>
      </div>
      {view === 'album' ? groups.map(([name, list]) => {
        const all = cards.filter((c) => c.collection === name);
        const have = all.filter((c) => c.quantity > 0).length;
        return (
          <section key={name} className="tcg-album">
            <header className="tcg-album-head">
              <h3>{name}</h3>
              <span className="tcg-album-count">{have}/{all.length}</span>
              <span className="tcg-bar"><i style={{ width: `${(have / Math.max(1, all.length)) * 100}%` }} /></span>
              {have === all.length && <span className="tcg-album-done"><Icon d={UI.check} size={14} />Completa</span>}
            </header>
            <div className="tcg-grid">
              {list.map((c) => (c.quantity > 0
                ? <CardView key={c.id} card={c} size="md" showQty quantity={c.quantity} onClick={() => onOpenChange(c.id)} />
                : <Silhouette key={c.id} card={c} onClick={() => onOpenChange(c.id)} />))}
            </div>
          </section>
        );
      }) : (
        <div className="tcg-grid">
          {filtered.map((c) => <CardView key={c.id} card={c} size="md" showQty quantity={c.quantity} dim={!c.quantity} onClick={() => onOpenChange(c.id)} />)}
        </div>
      )}
      {!filtered.length && <p className="tcg-empty">Nenhuma carta com esse filtro.</p>}
      {current && <CardModal card={current} home={home} onClose={() => onOpenChange(null)} onChanged={onChanged} />}
    </div>
  );
}
