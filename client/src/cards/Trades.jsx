import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { searchUsers } from '../api/endpoints';
import UserAvatar from '../components/UserAvatar.jsx';
import { CardView, CardArt, RARITIES, Icon, UI } from './CardView.jsx';
import { cardsTrades, cardsCreateTrade, cardsTradeAction, cardsUserCollection, errMsg } from './api';

// Escolher uma pessoa: amigos primeiro, busca por nome para o resto.
export function UserPicker({ onPick, meId, actionLabel = 'Escolher' }) {
  const friends = useStore((s) => s.friends);
  const presence = useStore((s) => s.presence);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(() => searchUsers(q.trim()).then((d) => setFound((d.users || []).filter((u) => u.id !== meId))).catch(() => setFound([])), 250);
    return () => clearTimeout(t);
  }, [q, meId]);
  const list = useMemo(() => {
    const fr = friends.filter((f) => f.status === 'ACCEPTED').map((f) => f.user)
      .sort((a, b) => Number((presence[b.id]?.status || b.status) !== 'OFFLINE') - Number((presence[a.id]?.status || a.status) !== 'OFFLINE'));
    if (!q.trim()) return fr;
    const t = q.trim().toLowerCase();
    const seen = new Set();
    return [...fr.filter((u) => `${u.displayName} ${u.username}`.toLowerCase().includes(t)), ...found]
      .filter((u) => (seen.has(u.id) ? false : seen.add(u.id)));
  }, [friends, presence, q, found]);
  return (
    <div className="tcg-picker">
      <label className="tcg-search"><Icon d={UI.search} size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar amigo ou pessoa" aria-label="Buscar pessoa" /></label>
      <div className="tcg-picker-list">
        {list.slice(0, 30).map((u) => (
          <div key={u.id} className="tcg-picker-row">
            <UserAvatar user={u} size={32} />
            <span className="tcg-picker-name"><b data-no-translate>{u.displayName}</b><small>@{u.username}</small></span>
            <button type="button" className="tcg-btn" onClick={() => onPick(u)}>{actionLabel}</button>
          </div>
        ))}
        {!list.length && <p className="tcg-empty">{q.trim() ? 'Ninguém encontrado.' : 'Adicione amigos ou busque pelo nome.'}</p>}
      </div>
    </div>
  );
}

function ItemList({ items, coins }) {
  return (
    <div className="tcgt-items">
      {items.map((it) => it.card && (
        <span key={it.cardId} className="tcgt-item" style={{ '--rar': RARITIES[it.card.rarity]?.color }} title={`${it.card.name} (${RARITIES[it.card.rarity]?.label})`}>
          <span className="tcgt-item-art"><CardArt card={it.card} /></span>
          <span data-no-translate>{it.card.name}</span><b>x{it.qty}</b>
        </span>
      ))}
      {coins > 0 && <span className="tcgt-item is-coins"><Icon d={UI.coin} size={14} />{coins} moedas</span>}
      {!items.length && !coins && <span className="tcg-empty">Nada</span>}
    </div>
  );
}

// Seleção de cartas com quantidade.
function PickCards({ cards, picked, setPicked, title }) {
  const [q, setQ] = useState('');
  const shown = cards.filter((c) => c.quantity > 0 && (!q || c.name.toLowerCase().includes(q.toLowerCase())));
  const change = (c, d) => setPicked((p) => {
    const m = new Map(p); const n = Math.max(0, Math.min(c.quantity, (m.get(c.id) || 0) + d));
    if (n) m.set(c.id, n); else m.delete(c.id);
    return m;
  });
  return (
    <div className="tcgt-pick">
      <div className="tcgt-pick-head"><h4>{title}</h4><label className="tcg-search"><Icon d={UI.search} size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar" aria-label={`Filtrar ${title}`} /></label></div>
      <div className="tcgt-pick-list">
        {shown.map((c) => {
          const n = picked.get(c.id) || 0;
          return (
            <div key={c.id} className={`tcgt-pick-row${n ? ' is-on' : ''}`} style={{ '--rar': RARITIES[c.rarity]?.color }}>
              <span className="tcgt-item-art"><CardArt card={c} /></span>
              <span className="tcgt-pick-name"><b data-no-translate>{c.name}</b><small>{RARITIES[c.rarity]?.label} · tem {c.quantity}</small></span>
              <button type="button" className="tcg-icon-btn" onClick={() => change(c, -1)} disabled={!n} aria-label="Menos"><Icon d={UI.minus} size={14} /></button>
              <b className="tcgt-pick-n">{n}</b>
              <button type="button" className="tcg-icon-btn" onClick={() => change(c, 1)} disabled={n >= c.quantity} aria-label="Mais"><Icon d={UI.plus} size={14} /></button>
            </div>
          );
        })}
        {!shown.length && <p className="tcg-empty">Sem cartas.</p>}
      </div>
    </div>
  );
}

export function TradeComposer({ me, target, myCollection, maxCoins, onDone, onCancel }) {
  const [theirs, setTheirs] = useState(null);
  const [offer, setOffer] = useState(new Map());
  const [request, setRequest] = useState(new Map());
  const [offerCoins, setOfferCoins] = useState(0);
  const [requestCoins, setRequestCoins] = useState(0);
  const [message, setMessage] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { cardsUserCollection(target.id).then((d) => setTheirs(d.cards)).catch((e) => setErr(errMsg(e))); }, [target.id]);
  const send = async () => {
    setBusy(true); setErr('');
    try {
      await cardsCreateTrade({
        toId: target.id, message, offerCoins, requestCoins,
        offer: [...offer].map(([cardId, qty]) => ({ cardId, qty })), request: [...request].map(([cardId, qty]) => ({ cardId, qty })),
      });
      onDone();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="tcgt-composer">
      <div className="tcgt-composer-head">
        <UserAvatar user={target} size={36} />
        <div><strong>Troca com <span data-no-translate>{target.displayName}</span></strong><small>Escolha o que você oferece e o que pede em troca. A troca só acontece se a pessoa aceitar — e o servidor confere se os dois ainda têm tudo.</small></div>
      </div>
      <div className="tcgt-cols">
        <div>
          <PickCards cards={myCollection} picked={offer} setPicked={setOffer} title={`Você oferece (${me.coins ?? 0} moedas)`} />
          <label className="tcgt-coins"><Icon d={UI.coin} size={15} />Moedas: <input type="number" min="0" max={Math.min(maxCoins, me.coins ?? 0)} value={offerCoins} onChange={(e) => setOfferCoins(Math.max(0, Math.min(maxCoins, Number(e.target.value) || 0)))} /></label>
        </div>
        <div>
          {theirs ? <PickCards cards={theirs} picked={request} setPicked={setRequest} title="Você pede" /> : <p className="tcg-empty">Carregando cartas…</p>}
          <label className="tcgt-coins"><Icon d={UI.coin} size={15} />Moedas: <input type="number" min="0" max={maxCoins} value={requestCoins} onChange={(e) => setRequestCoins(Math.max(0, Math.min(maxCoins, Number(e.target.value) || 0)))} /></label>
        </div>
      </div>
      <input className="tcgt-msg" value={message} maxLength={180} onChange={(e) => setMessage(e.target.value)} placeholder="Mensagem (opcional)" aria-label="Mensagem" />
      {err && <p className="tcg-error">{err}</p>}
      <div className="tcgt-actions">
        <button type="button" className="tcg-btn ghost" onClick={onCancel}>Cancelar</button>
        <button type="button" className="tcg-btn primary" disabled={busy || ((!offer.size && !offerCoins) || (!request.size && !requestCoins))} onClick={send}><Icon d={UI.swap} />Enviar proposta</button>
      </div>
    </div>
  );
}

const STATUS = { PENDING: 'Pendente', ACCEPTED: 'Aceita', DECLINED: 'Recusada', CANCELLED: 'Cancelada', FAILED: 'Falhou' };

export default function Trades({ me, myCollection, maxCoins, onChanged, startWith }) {
  const [trades, setTrades] = useState(null);
  const [target, setTarget] = useState(startWith || null);
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState('');
  const load = () => cardsTrades().then((d) => setTrades(d.trades)).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (startWith) setTarget(startWith); }, [startWith]);
  const act = async (id, kind) => {
    setErr('');
    try { await cardsTradeAction(id, kind); await load(); onChanged?.(); } catch (e) { setErr(errMsg(e)); load(); }
  };
  if (target) return <TradeComposer me={me} target={target} myCollection={myCollection} maxCoins={maxCoins} onCancel={() => setTarget(null)} onDone={() => { setTarget(null); load(); }} />;
  if (picking) {
    return (
      <div>
        <div className="tcg-section-head"><p>Com quem você quer trocar?</p><button type="button" className="tcg-btn ghost" onClick={() => setPicking(false)}>Voltar</button></div>
        <UserPicker meId={me.id} actionLabel="Trocar" onPick={(u) => { setPicking(false); setTarget(u); }} />
      </div>
    );
  }
  const pending = (trades || []).filter((t) => t.status === 'PENDING');
  const done = (trades || []).filter((t) => t.status !== 'PENDING');
  const Row = ({ t }) => {
    const other = t.incoming ? t.from : t.to;
    return (
      <div className={`tcgt-trade is-${t.status.toLowerCase()}`}>
        <div className="tcgt-trade-head">
          <UserAvatar user={other || {}} size={28} />
          <span>{t.incoming ? <>Proposta de <b data-no-translate>{other?.displayName}</b></> : <>Sua proposta para <b data-no-translate>{other?.displayName}</b></>}</span>
          <em className="tcgt-status">{STATUS[t.status]}</em>
        </div>
        {t.message && <p className="tcgt-trade-msg">“{t.message}”</p>}
        <div className="tcgt-trade-body">
          <div><small>{t.incoming ? 'Você recebe' : 'Você dá'}</small><ItemList items={t.offer} coins={t.offerCoins} /></div>
          <Icon d={UI.swap} size={20} />
          <div><small>{t.incoming ? 'Você dá' : 'Você recebe'}</small><ItemList items={t.request} coins={t.requestCoins} /></div>
        </div>
        {t.status === 'PENDING' && (
          <div className="tcgt-actions">
            {t.incoming ? (
              <>
                <button type="button" className="tcg-btn ghost" onClick={() => act(t.id, 'decline')}>Recusar</button>
                <button type="button" className="tcg-btn primary" onClick={() => act(t.id, 'accept')}><Icon d={UI.check} />Aceitar troca</button>
              </>
            ) : <button type="button" className="tcg-btn ghost" onClick={() => act(t.id, 'cancel')}>Cancelar proposta</button>}
          </div>
        )}
      </div>
    );
  };
  return (
    <div className="tcgt">
      <div className="tcg-section-head">
        <p>Troque cartas (e moedas) com outros jogadores. Tudo é conferido pelo servidor na hora de aceitar.</p>
        <button type="button" className="tcg-btn primary" onClick={() => setPicking(true)}><Icon d={UI.plus} />Nova troca</button>
      </div>
      {err && <p className="tcg-error">{err}</p>}
      {trades === null && <p className="tcg-empty">Carregando…</p>}
      {pending.length > 0 && <h3 className="tcg-h3">Pendentes</h3>}
      {pending.map((t) => <Row key={t.id} t={t} />)}
      {done.length > 0 && <h3 className="tcg-h3">Histórico</h3>}
      {done.map((t) => <Row key={t.id} t={t} />)}
      {trades?.length === 0 && <p className="tcg-empty">Nenhuma troca ainda.</p>}
    </div>
  );
}

export { CardView };
