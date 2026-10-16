import { useCallback, useEffect, useMemo, useState } from 'react';
import UserAvatar from '../UserAvatar.jsx';
import { Ico } from '../PagesKit.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { searchUsers } from '../../api/endpoints';
import { getTrades, getLimiteds, createTrade, acceptTrade, declineTrade, cancelTrade } from '../../api/decorations';
import { proxyImage } from '../../utils/imageProxy';
import { nameStyleProps } from '../../utils/nameStyle';

// Trocas de itens limitados (igual aos "limiteds" do Roblox): você oferece
// itens limitados seus + moedas/gemas e pede itens limitados da outra
// pessoa + moedas/gemas. Ela aceita ou recusa; o servidor confere tudo de
// novo na hora de aceitar e troca de uma vez só.

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const errMsg = (e) => e?.response?.data?.error || 'Não deu certo, tente de novo.';
const KIND_LABEL = { deco: 'Moldura', effect: 'Efeito', font: 'Fonte', style: 'Estilo' };
const STATUS_LABEL = { PENDING: 'Esperando', ACCEPTED: 'Aceita', DECLINED: 'Recusada', CANCELLED: 'Cancelada', FAILED: 'Não deu certo' };
const key = (i) => `${i.kind}:${i.id}`;

function ItemArt({ item }) {
  if (item.kind === 'font' && item.data?.family) {
    return <span style={nameStyleProps({ profileFont: JSON.stringify({ id: item.id, family: item.data.family, url: item.data.url }) })}>Aa</span>;
  }
  if (item.kind === 'style') return <Ico name="palette" size={22} />;
  return item.imageUrl ? <img src={proxyImage(item.imageUrl)} alt="" loading="lazy" /> : <Ico name="star" size={20} />;
}

function TradeItem({ item, on, onClick }) {
  const body = (
    <>
      <span className="trade-art"><ItemArt item={item} /></span>
      <span title={item.name}>{item.name}</span>
      <em>{KIND_LABEL[item.kind]}{item.serial ? ` · #${fmt(item.serial)}` : ''}</em>
      {on && <span className="trade-check"><Ico name="check" size={11} strokeWidth={3} /></span>}
    </>
  );
  return onClick
    ? <button type="button" className={`trade-item${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick}>{body}</button>
    : <div className="trade-item">{body}</div>;
}

function Money({ side }) {
  if (!side?.coins && !side?.gems) return null;
  return (
    <div className="trade-money">
      {side.coins > 0 && <span><Ico name="coin" size={15} /> {fmt(side.coins)}</span>}
      {side.gems > 0 && <span><Ico name="gem" size={15} /> {fmt(side.gems)}</span>}
    </div>
  );
}

function Side({ title, side }) {
  return (
    <div className="trade-side">
      <small>{title}</small>
      <div className="trade-items">{(side?.items || []).map((i) => <TradeItem key={key(i)} item={i} />)}</div>
      <Money side={side} />
      {!side?.items?.length && !side?.coins && !side?.gems && <span className="room-muted">Nada</span>}
    </div>
  );
}

function TradeCard({ t, me, busy, act }) {
  const mine = t.from?.id === me;
  const other = mine ? t.to : t.from;
  return (
    <article className="trade-card">
      <div className="trade-head">
        <UserAvatar user={other} size={36} />
        <div>
          <strong>{mine ? `Para ${other?.displayName || '…'}` : `De ${other?.displayName || '…'}`}</strong><br />
          <small>{new Date(t.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small>
        </div>
        <span className={`trade-status s-${t.status}`}>{STATUS_LABEL[t.status] || t.status}</span>
      </div>
      {t.message && <p className="trade-msg">“{t.message}”</p>}
      <div className="trade-sides">
        <Side title={mine ? 'Você dá' : `${t.from?.displayName || 'Ela'} dá`} side={t.offer} />
        <span className="trade-arrow"><Ico name="swap" size={20} /></span>
        <Side title={mine ? 'Você recebe' : 'Você dá'} side={t.request} />
      </div>
      {t.status === 'PENDING' && (
        <div className="trade-actions">
          {mine ? (
            <button type="button" className="room-btn ghost" disabled={busy} onClick={() => act('cancel', t)}>Cancelar proposta</button>
          ) : (
            <>
              <button type="button" className="room-btn ghost" disabled={busy} onClick={() => act('decline', t)}>Recusar</button>
              <button type="button" className="room-btn primary" disabled={busy} onClick={() => act('accept', t)}><Ico name="check" size={15} /> Aceitar troca</button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

// Monta uma proposta nova.
function NewTrade({ onSent, flash }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [target, setTarget] = useState(null);
  const [mine, setMine] = useState(null);
  const [theirs, setTheirs] = useState(null);
  const [give, setGive] = useState(() => new Set());
  const [want, setWant] = useState(() => new Set());
  const [cur, setCur] = useState({ giveCoins: '', giveGems: '', wantCoins: '', wantGems: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { getLimiteds('me').then((d) => setMine(d.items)).catch(() => setMine([])); }, []);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return undefined; }
    const t = setTimeout(() => { searchUsers(term).then((d) => setResults((d.users || []).slice(0, 8))).catch(() => {}); }, 280);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    setTheirs(null); setWant(new Set());
    if (target) getLimiteds(target.id).then((d) => setTheirs(d.items)).catch(() => setTheirs([]));
  }, [target]);

  const toggle = (set, setter, k) => setter(() => { const n = new Set(set); if (n.has(k)) n.delete(k); else if (n.size < 8) n.add(k); return n; });
  const num = (v) => Math.max(0, parseInt(v, 10) || 0);
  const pick = (list, set) => (list || []).filter((i) => set.has(key(i))).map((i) => ({ kind: i.kind, id: i.id }));
  const offer = { items: pick(mine, give), coins: num(cur.giveCoins), gems: num(cur.giveGems) };
  const request = { items: pick(theirs, want), coins: num(cur.wantCoins), gems: num(cur.wantGems) };
  const empty = (s) => !s.items.length && !s.coins && !s.gems;
  const valid = target && !empty(offer) && !empty(request) && (offer.items.length + request.items.length) > 0;

  const send = async () => {
    setBusy(true); setError('');
    try {
      await createTrade({ toUserId: target.id, offer, request, message });
      flash(`Proposta enviada para ${target.displayName}.`);
      onSent();
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  // Função (não componente): assim o campo não perde o foco a cada tecla.
  const curInputs = (prefix) => (
    <div className="trade-cur-row">
      <label><span><Ico name="coin" size={13} /> Moedas</span><input type="number" min="0" inputMode="numeric" value={cur[`${prefix}Coins`]} onChange={(e) => setCur((c) => ({ ...c, [`${prefix}Coins`]: e.target.value }))} placeholder="0" /></label>
      <label><span><Ico name="gem" size={13} /> Gemas</span><input type="number" min="0" inputMode="numeric" value={cur[`${prefix}Gems`]} onChange={(e) => setCur((c) => ({ ...c, [`${prefix}Gems`]: e.target.value }))} placeholder="0" /></label>
    </div>
  );

  return (
    <div className="trade-builder">
      <div className="trade-pick-user">
        <label className="room-search">
          <Ico name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Com quem você quer trocar? (nome ou @)" aria-label="Buscar pessoa" />
        </label>
        {results.length > 0 && (
          <div className="trade-results">
            {results.map((u) => (
              <button key={u.id} type="button" className={target?.id === u.id ? 'on' : ''} onClick={() => setTarget(u)}>
                <UserAvatar user={u} size={28} /> {u.displayName}
              </button>
            ))}
          </div>
        )}
      </div>
      {target && (
        <>
          <div className="trade-sides">
            <div className="trade-side">
              <small>Você dá</small>
              {mine === null ? <span className="room-muted">Carregando…</span> : mine.length === 0 ? <span className="room-muted">Você não tem itens limitados.</span> : (
                <div className="trade-items">{mine.map((i) => <TradeItem key={key(i)} item={i} on={give.has(key(i))} onClick={() => toggle(give, setGive, key(i))} />)}</div>
              )}
              {curInputs('give')}
            </div>
            <span className="trade-arrow"><Ico name="swap" size={20} /></span>
            <div className="trade-side">
              <small>Você pede de {target.displayName}</small>
              {theirs === null ? <span className="room-muted">Carregando…</span> : theirs.length === 0 ? <span className="room-muted">{target.displayName} não tem itens limitados.</span> : (
                <div className="trade-items">{theirs.map((i) => <TradeItem key={key(i)} item={i} on={want.has(key(i))} onClick={() => toggle(want, setWant, key(i))} />)}</div>
              )}
              {curInputs('want')}
            </div>
          </div>
          <label className="room-field">
            <span>Mensagem (opcional)</span>
            <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} placeholder="Ex.: troco minha moldura #12 pela sua fonte" />
          </label>
          <small className="room-muted">Só itens limitados podem ser trocados. Os dois lados precisam ter alguma coisa, e pelo menos um item limitado tem que estar na troca.</small>
          {error && <p className="room-warn">{error}</p>}
          <button type="button" className="room-btn primary lg" disabled={!valid || busy} onClick={send}><Ico name="swap" size={16} /> {busy ? 'Enviando…' : 'Enviar proposta'}</button>
        </>
      )}
    </div>
  );
}

export default function ShopTrades({ flash, onWallet, reload }) {
  const { user } = useAuth();
  const { socket } = useSocket() || {};
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('incoming');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => getTrades().then(setData).catch(() => setData({ incoming: [], outgoing: [], history: [] })), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!socket) return undefined;
    const on = () => load();
    socket.on('trade:update', on);
    return () => socket.off('trade:update', on);
  }, [socket, load]);

  const act = async (what, t) => {
    setBusy(true);
    try {
      if (what === 'accept') {
        const r = await acceptTrade(t.id);
        onWallet?.(r);
        flash('Troca feita! Os itens já estão no seu inventário.');
        reload?.();
      } else if (what === 'decline') { await declineTrade(t.id); flash('Proposta recusada.', 'info'); } else { await cancelTrade(t.id); flash('Proposta cancelada.', 'info'); }
    } catch (e) { flash(errMsg(e), 'bad'); }
    await load();
    setBusy(false);
  };

  const tabs = useMemo(() => [
    ['incoming', 'Recebidas', data?.incoming?.length],
    ['outgoing', 'Enviadas', data?.outgoing?.length],
    ['history', 'Histórico'],
    ['new', 'Nova troca'],
  ], [data]);
  const list = tab === 'new' ? null : data?.[tab];

  return (
    <div className="room-stack">
      <div className="room-page-head">
        <h1>Trocas</h1>
        <p>Troque seus itens limitados por itens limitados de outras pessoas, moedas ou gemas. Tudo é conferido na hora de aceitar.</p>
      </div>
      <div className="room-seg" role="tablist" aria-label="Trocas">
        {tabs.map(([id, label, n]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {id === 'new' && <Ico name="plus" size={14} />} {label}{n ? ` (${n})` : ''}
          </button>
        ))}
      </div>
      {tab === 'new' ? <NewTrade flash={flash} onSent={() => { setTab('outgoing'); load(); }} /> : !data ? <p className="room-muted">Carregando…</p> : list.length === 0 ? (
        <p className="room-muted">{tab === 'incoming' ? 'Nenhuma proposta esperando você.' : tab === 'outgoing' ? 'Você não tem propostas abertas.' : 'Nenhuma troca ainda.'}</p>
      ) : (
        <div className="trade-list">{list.map((t) => <TradeCard key={t.id} t={t} me={user?.id} busy={busy} act={act} />)}</div>
      )}
    </div>
  );
}
