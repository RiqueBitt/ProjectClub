import { useEffect, useMemo, useState } from 'react';
import { CardView, CardArt, ELEMENTS, RARITIES, RARITY_ORDER, Icon, UI } from './CardView.jsx';
import { cardsDecks, cardsSaveDeck, cardsDeleteDeck, cardsActivateDeck, cardsSuggestDeck, errMsg } from './api';

// Baralhos: lista + editor. O servidor revalida tudo ao salvar e ao jogar.
export default function DeckBuilder({ collection, rules, onChanged }) {
  const [decks, setDecks] = useState(null);
  const [editing, setEditing] = useState(null); // { id?, name, cards: Map }
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [el, setEl] = useState('');

  const load = () => cardsDecks().then((d) => setDecks(d.decks)).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); }, []);

  const byId = useMemo(() => new Map(collection.map((c) => [c.id, c])), [collection]);
  const owned = useMemo(() => collection.filter((c) => c.quantity > 0), [collection]);
  const cap = (c) => Math.min(c.quantity, RARITY_ORDER.indexOf(c.rarity) >= RARITY_ORDER.indexOf('LENDARIA') ? rules.maxCopiesLegendary : rules.maxCopies);

  const startEdit = (d) => setEditing({ id: d?.id, name: d?.name || `Baralho ${(decks?.length || 0) + 1}`, cards: new Map((d?.cards || []).map((x) => [x.cardId, x.copies])) });
  const total = editing ? [...editing.cards.values()].reduce((s, n) => s + n, 0) : 0;
  const add = (c) => setEditing((e) => {
    const n = e.cards.get(c.id) || 0;
    if (n >= cap(c) || total >= rules.deckSize) return e;
    const m = new Map(e.cards); m.set(c.id, n + 1); return { ...e, cards: m };
  });
  const remove = (id) => setEditing((e) => {
    const m = new Map(e.cards); const n = (m.get(id) || 0) - 1;
    if (n <= 0) m.delete(id); else m.set(id, n);
    return { ...e, cards: m };
  });
  const suggest = async () => {
    try { const d = await cardsSuggestDeck(); setEditing((e) => ({ ...e, cards: new Map(d.cards.map((x) => [x.cardId, x.copies])) })); } catch (e) { setMsg(errMsg(e)); }
  };
  const save = async () => {
    setBusy(true); setMsg('');
    try {
      await cardsSaveDeck({ id: editing.id, name: editing.name, cards: [...editing.cards].map(([cardId, copies]) => ({ cardId, copies })) });
      setEditing(null); await load(); onChanged?.();
    } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  };

  const curve = useMemo(() => {
    const c = Array(8).fill(0);
    if (editing) for (const [id, n] of editing.cards) { const card = byId.get(id); if (card) c[Math.min(7, card.cost)] += n; }
    return c;
  }, [editing, byId]);

  if (editing) {
    const filtered = owned.filter((c) => (!el || c.element === el) && (!q || c.name.toLowerCase().includes(q.toLowerCase())));
    const deckList = [...editing.cards].map(([id, n]) => ({ card: byId.get(id), n })).filter((x) => x.card).sort((a, b) => a.card.cost - b.card.cost || a.card.name.localeCompare(b.card.name));
    const maxCurve = Math.max(1, ...curve);
    return (
      <div className="tcgd-editor">
        <div className="tcgd-pool">
          <div className="tcg-filters">
            <label className="tcg-search"><Icon d={UI.search} size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar carta" aria-label="Buscar carta" /></label>
            <div className="tcg-chips">
              <button type="button" className={!el ? 'on' : ''} onClick={() => setEl('')}>Todas</button>
              {Object.entries(ELEMENTS).map(([k, v]) => <button key={k} type="button" className={el === k ? 'on' : ''} style={{ '--el': v.color }} onClick={() => setEl(k)}>{v.label}</button>)}
            </div>
          </div>
          <div className="tcg-grid is-compact">
            {filtered.map((c) => {
              const used = editing.cards.get(c.id) || 0;
              return (
                <CardView key={c.id} card={c} size="sm" onClick={() => add(c)} dim={used >= cap(c)}
                  badge={<span className="tcgd-use">{used}/{cap(c)}</span>} aria-label={`Adicionar ${c.name}`} />
              );
            })}
            {!filtered.length && <p className="tcg-empty">Nenhuma carta sua com esse filtro.</p>}
          </div>
        </div>
        <aside className="tcgd-side">
          <input className="tcgd-name" value={editing.name} maxLength={40} onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value }))} aria-label="Nome do baralho" />
          <div className={`tcgd-count${total === rules.deckSize ? ' is-ok' : ''}`}>{total}/{rules.deckSize} cartas</div>
          <div className="tcgd-curve" aria-label="Curva de custo">
            {curve.map((n, i) => <span key={i} title={`Custo ${i === 7 ? '7+' : i}: ${n}`}><i style={{ height: `${(n / maxCurve) * 100}%` }} /><b>{i === 7 ? '7+' : i}</b></span>)}
          </div>
          <div className="tcgd-list">
            {deckList.map(({ card, n }) => (
              <button key={card.id} type="button" className="tcgd-row" onClick={() => remove(card.id)} title="Remover uma cópia" style={{ '--el': ELEMENTS[card.element]?.color, '--rar': RARITIES[card.rarity]?.color }}>
                <span className="tcgd-row-cost">{card.cost}</span>
                <span className="tcgd-row-art"><CardArt card={card} /></span>
                <span className="tcgd-row-name" data-no-translate>{card.name}</span>
                <span className="tcgd-row-n">x{n}</span>
              </button>
            ))}
            {!deckList.length && <p className="tcg-empty">Clique nas cartas para adicionar.</p>}
          </div>
          {msg && <p className="tcg-error">{msg}</p>}
          <div className="tcgd-actions">
            <button type="button" className="tcg-btn" onClick={suggest}><Icon d={UI.wand} />Montar automático</button>
            <button type="button" className="tcg-btn primary" disabled={busy || total !== rules.deckSize} onClick={save}>Salvar</button>
            <button type="button" className="tcg-btn ghost" onClick={() => setEditing(null)}>Cancelar</button>
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="tcgd">
      <div className="tcg-section-head">
        <p>Monte até 10 baralhos de <b>{rules.deckSize}</b> cartas (máx. {rules.maxCopies} cópias, {rules.maxCopiesLegendary} para Lendárias e Míticas). O baralho <b>ativo</b> é usado nas partidas; se ele ficar inválido, montamos um automático com suas melhores cartas.</p>
        <button type="button" className="tcg-btn primary" onClick={() => startEdit(null)} disabled={owned.length === 0}><Icon d={UI.plus} />Novo baralho</button>
      </div>
      {msg && <p className="tcg-error">{msg}</p>}
      <div className="tcgd-decks">
        {decks === null && <p className="tcg-empty">Carregando…</p>}
        {decks?.length === 0 && <p className="tcg-empty">Você ainda não montou nenhum baralho — as partidas usam um automático com suas melhores cartas.</p>}
        {decks?.map((d) => {
          const top = d.cards.map((x) => byId.get(x.cardId)).filter(Boolean).sort((a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity))[0];
          return (
            <div key={d.id} className={`tcgd-deck${d.active ? ' is-active' : ''}${d.valid ? '' : ' is-invalid'}`}>
              <span className="tcgd-deck-art">{top ? <CardArt card={top} /> : null}</span>
              <div className="tcgd-deck-info">
                <strong data-no-translate>{d.name}</strong>
                <span>{d.total} cartas{d.active ? ' · Ativo' : ''}</span>
                {!d.valid && <small>{d.errors[0]}</small>}
              </div>
              <div className="tcgd-deck-actions">
                {!d.active && d.valid && <button type="button" className="tcg-btn" onClick={() => cardsActivateDeck(d.id).then(load)}>Usar</button>}
                <button type="button" className="tcg-btn ghost" onClick={() => startEdit(d)}>Editar</button>
                <button type="button" className="tcg-btn ghost danger" onClick={() => { if (window.confirm(`Excluir "${d.name}"?`)) cardsDeleteDeck(d.id).then(load); }} aria-label="Excluir baralho"><Icon d={UI.close} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
