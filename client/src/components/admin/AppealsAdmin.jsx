import { useCallback, useEffect, useState } from 'react';
import UserAvatar from '../UserAvatar.jsx';
import { staffListAppeals, staffAcceptAppeal, staffDenyAppeal } from '../../api/endpoints';

// Painel da Equipe → Moderação → "Revisões de punição" (Fase 5).
// Fila dos pedidos de revisão de banimento/suspensão: aceitar tira a
// punição (mesmo caminho do desbanir/tirar suspensão); recusar exige uma
// resposta, que vai pra pessoa por e-mail. Tudo fica no registro de auditoria.
const FILTERS = [['PENDING', 'Pendentes'], ['ACCEPTED', 'Aceitos'], ['DENIED', 'Recusados'], ['ALL', 'Todos']];
const STATUS_LABEL = { PENDING: 'Pendente', ACCEPTED: 'Aceito', DENIED: 'Recusado' };
const MAX_REPLY = 2000;

function fmt(d) { return d ? new Date(d).toLocaleString('pt-BR') : ''; }

function AppealCard({ appeal, onDone }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const pending = appeal.status === 'PENDING';

  const act = async (accept) => {
    if (busy) return;
    if (!accept && !reply.trim()) { setError('Escreva uma resposta explicando a recusa.'); return; }
    if (accept && !window.confirm(`Aceitar e tirar ${appeal.kind === 'BAN' ? 'o banimento' : 'a suspensão'} de ${appeal.user?.displayName || 'esta conta'}?`)) return;
    setBusy(accept ? 'accept' : 'deny'); setError('');
    try {
      const fn = accept ? staffAcceptAppeal : staffDenyAppeal;
      const r = await fn(appeal.id, reply.trim());
      onDone?.(appeal.id, r.appeal);
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível concluir.');
    } finally { setBusy(null); }
  };

  return (
    <div className="settings-block appeal-card">
      <div className="appeal-card-head">
        <UserAvatar user={appeal.user} size={36} />
        <div className="appeal-card-who">
          <b>{appeal.user?.displayName || 'Conta removida'}</b> <span className="dim">@{appeal.user?.username}</span>
          <div className="dim appeal-card-meta">
            {appeal.kind === 'BAN' ? 'Banimento' : 'Suspensão'}
            {appeal.until ? ` até ${fmt(appeal.until)}` : ''} · pedido em {fmt(appeal.createdAt)}
          </div>
        </div>
        <span className={`ticket-status-chip ${pending ? 'open' : 'closed'}`}>{STATUS_LABEL[appeal.status] || appeal.status}</span>
      </div>
      <div className="dim appeal-card-label">Motivo da punição</div>
      <p className="appeal-card-text">{appeal.reason || <span className="dim">(sem motivo registrado)</span>}</p>
      <div className="dim appeal-card-label">O que a pessoa escreveu</div>
      <p className="appeal-card-text">{appeal.message || <span className="dim">(não escreveu nada)</span>}</p>
      {!pending && (
        <>
          <div className="dim appeal-card-label">Resposta da equipe{appeal.reviewedBy ? ` (${appeal.reviewedBy.displayName}, ${fmt(appeal.reviewedAt)})` : ''}</div>
          <p className="appeal-card-text">{appeal.staffReply || <span className="dim">(sem resposta)</span>}</p>
        </>
      )}
      {pending && (
        <div className="appeal-card-actions">
          <textarea
            value={reply} maxLength={MAX_REPLY} rows={3} placeholder="Resposta para a pessoa (obrigatória pra recusar)"
            aria-label="Resposta para a pessoa" onChange={(e) => setReply(e.target.value.slice(0, MAX_REPLY))}
          />
          <div className="appeal-card-buttons">
            <span className="dim appeal-card-count">{reply.length}/{MAX_REPLY}</span>
            <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => act(false)}>{busy === 'deny' ? '...' : 'Recusar'}</button>
            <button type="button" className="btn-primary" disabled={!!busy} onClick={() => act(true)}>{busy === 'accept' ? '...' : 'Aceitar e tirar a punição'}</button>
          </div>
          {error && <p className="appeal-card-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default function AppealsAdmin() {
  const [filter, setFilter] = useState('PENDING');
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (more = false) => {
    setLoading(true); setError('');
    try {
      const d = await staffListAppeals(filter, more ? cursor : null);
      setItems((list) => (more ? [...list, ...d.appeals] : d.appeals));
      setCursor(d.nextCursor);
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível carregar os pedidos.');
    } finally { setLoading(false); }
  }, [filter, cursor]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(false); }, [filter]);

  const onDone = (id, updated) => {
    setItems((list) => (filter === 'PENDING' ? list.filter((a) => a.id !== id) : list.map((a) => (a.id === id ? { ...a, ...updated } : a))));
  };

  return (
    <div className="appeals-admin">
      <p className="dim" style={{ marginBottom: 12 }}>
        Pedidos de quem foi banido ou suspenso. Cada punição aceita só um pedido. Aceitar tira a punição na hora;
        recusar exige uma resposta, que a pessoa recebe por e-mail.
      </p>
      <div className="theme-options" style={{ marginBottom: 12 }}>
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" className={`theme-swatch ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{label}</button>
        ))}
      </div>
      {error && <p className="appeal-card-error" role="alert">{error}</p>}
      {!loading && !error && items.length === 0 && <p className="dim">Nenhum pedido aqui.</p>}
      <div className="ticket-list">
        {items.map((a) => <AppealCard key={a.id} appeal={a} onDone={onDone} />)}
      </div>
      {loading && <p className="dim">Carregando…</p>}
      {!loading && cursor && <button type="button" className="btn-secondary" onClick={() => load(true)}>Carregar mais</button>}
    </div>
  );
}
