import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import IconGlyph from '../components/IconGlyph.jsx';
import emptyIcon from '../assets/icons/nav-empty.png';
import {
  listMyTickets, createTicket, getTicket, addTicketMessage,
  adminListTickets, claimTicket, closeTicket,
} from '../api/endpoints';
import { formatTimeOnly } from '../utils/formatTime';

// REPAGINADO: "Tickets de Suporte" virou "Suporte da Plataforma" — visual
// próprio de central de atendimento (cabeçalho com identidade, cartão de
// abertura em destaque, lista com ícones de status, conversa em bolhas)
// em vez de reaproveitar classes genéricas de outras páginas
// (.economy-page/.mod-tabs/.theme-swatch) como antes. Nenhuma chamada de
// API/comportamento mudou — só a apresentação.
export default function TicketsPage() {
  const { user } = useAuth();
  const isStaff = ['ADMIN', 'MODERATOR'].includes(user.platformRole);
  const [tab, setTab] = useState(isStaff ? 'STAFF' : 'MINE');
  const [selectedId, setSelectedId] = useState(null);

  return (
    <div className="support-page">
      <div className="support-header">
        <div className="support-header-icon">🎧</div>
        <div>
          <h1>Suporte da Plataforma</h1>
          <p className="dim">Precisa de ajuda? Abra um chamado e fale direto com a nossa equipe.</p>
        </div>
      </div>

      {isStaff && (
        <div className="support-tabs">
          <button className={`support-tab ${tab === 'MINE' ? 'active' : ''}`} onClick={() => { setTab('MINE'); setSelectedId(null); }}>
            Meus chamados
          </button>
          <button className={`support-tab ${tab === 'STAFF' ? 'active' : ''}`} onClick={() => { setTab('STAFF'); setSelectedId(null); }}>
            🛡️ Fila da equipe
          </button>
        </div>
      )}

      {selectedId
        ? <TicketDetail id={selectedId} onBack={() => setSelectedId(null)} isStaff={isStaff && tab === 'STAFF'} />
        : (tab === 'STAFF' ? <StaffTicketList onOpen={setSelectedId} /> : <MyTicketList onOpen={setSelectedId} />)}
    </div>
  );
}

function StatusChip({ status }) {
  return (
    <span className={`support-status-chip ${status === 'OPEN' ? 'open' : 'closed'}`}>
      <span className="support-status-dot" /> {status === 'OPEN' ? 'Aberto' : 'Fechado'}
    </span>
  );
}

function MyTicketList({ onOpen }) {
  const [tickets, setTickets] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  const refresh = () => listMyTickets().then((d) => setTickets(d.tickets));
  useEffect(() => { refresh(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { ticket } = await createTicket(subject, content);
      setShowNew(false); setSubject(''); setContent('');
      refresh();
      onOpen(ticket.id);
    } catch (err) { setError(err.response?.data?.error || 'Não foi possível abrir o chamado.'); }
  };

  if (!tickets) return <p className="dim">Carregando...</p>;

  return (
    <div>
      {!showNew && (
        <button type="button" className="support-new-ticket-cta" onClick={() => setShowNew(true)}>
          <span className="support-new-ticket-cta-icon">✍️</span>
          <span>
            <strong>Abrir um novo chamado</strong>
            <span className="dim">Conte o que está acontecendo — a equipe responde por aqui mesmo.</span>
          </span>
        </button>
      )}
      {showNew && (
        <form onSubmit={submit} className="settings-block support-new-ticket-form">
          <h4>Novo chamado</h4>
          <label>ASSUNTO<input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="Resuma o problema em poucas palavras" required /></label>
          <label>MENSAGEM<textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} maxLength={2000} placeholder="Descreva com detalhes o que você precisa" required /></label>
          {error && <div className="auth-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn-link" onClick={() => setShowNew(false)}>Cancelar</button>
            <button type="submit" className="btn-primary">Enviar chamado</button>
          </div>
        </form>
      )}

      <div className="support-ticket-list">
        {tickets.length === 0 && !showNew && (
          <div className="support-empty-state">
            <div className="support-empty-state-icon"><IconGlyph src={emptyIcon} size={40} /></div>
            <h3>Nenhum chamado por aqui</h3>
            <p className="dim">Quando você abrir um chamado, ele aparece nesta lista.</p>
          </div>
        )}
        {tickets.map((t) => (
          <button key={t.id} className="support-ticket-card" onClick={() => onOpen(t.id)}>
            <span className="support-ticket-card-icon">{t.status === 'OPEN' ? '🟢' : '⚪'}</span>
            <span className="support-ticket-card-body">
              <span className="support-ticket-card-subject">{t.subject}</span>
              <span className="dim support-ticket-card-meta">{new Date(t.updatedAt).toLocaleString('pt-BR')}</span>
            </span>
            <StatusChip status={t.status} />
          </button>
        ))}
      </div>
    </div>
  );
}

function StaffTicketList({ onOpen }) {
  const [filter, setFilter] = useState('OPEN');
  const [tickets, setTickets] = useState(null);

  const refresh = () => adminListTickets(filter === 'ALL' ? undefined : filter).then((d) => setTickets(d.tickets));
  useEffect(() => { refresh(); }, [filter]);

  if (!tickets) return <p className="dim">Carregando...</p>;

  return (
    <div>
      <div className="support-filter-row">
        {['OPEN', 'CLOSED', 'ALL'].map((f) => (
          <button key={f} className={`support-filter-chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'OPEN' ? 'Abertos' : f === 'CLOSED' ? 'Fechados' : 'Todos'}
          </button>
        ))}
      </div>
      <div className="support-ticket-list">
        {tickets.length === 0 && (
          <div className="support-empty-state">
            <div className="support-empty-state-icon">✅</div>
            <h3>Fila em dia</h3>
            <p className="dim">Nenhum chamado nesse filtro no momento.</p>
          </div>
        )}
        {tickets.map((t) => (
          <button key={t.id} className="support-ticket-card">
            <span className="support-ticket-card-avatar" onClick={() => onOpen(t.id)}>
              <UserAvatar user={t.author} size={32} />
            </span>
            <span className="support-ticket-card-body" onClick={() => onOpen(t.id)}>
              <span className="support-ticket-card-subject">{t.subject}</span>
              <span className="dim support-ticket-card-meta">
                {t.author.displayName} · {new Date(t.updatedAt).toLocaleString('pt-BR')}
                {t.claimedBy && ` · assumido por ${t.claimedBy.displayName}`}
              </span>
            </span>
            <StatusChip status={t.status} />
          </button>
        ))}
      </div>
    </div>
  );
}

function TicketDetail({ id, onBack, isStaff }) {
  const { user } = useAuth();
  const { socket } = useSocket() || {};
  const [ticket, setTicket] = useState(null);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const refresh = () => getTicket(id).then((d) => setTicket(d.ticket));
  useEffect(() => { refresh(); }, [id]);

  useEffect(() => {
    if (!socket) return;
    socket.emit('ticket:join', id);
    const onMessage = (data) => { if (data.ticketId === id) refresh(); };
    const onUpdate = (data) => { if (data.ticketId === id) refresh(); };
    socket.on('ticket:message', onMessage);
    socket.on('ticket:update', onUpdate);
    return () => { socket.off('ticket:message', onMessage); socket.off('ticket:update', onUpdate); };
  }, [socket, id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [ticket?.messages?.length]);

  const send = async (e) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    try { await addTicketMessage(id, content); setContent(''); refresh(); }
    finally { setSending(false); }
  };

  const claim = async () => { await claimTicket(id); refresh(); };
  const close = async () => { if (confirm('Fechar este chamado?')) { await closeTicket(id); refresh(); } };

  if (!ticket) return <p className="dim">Carregando...</p>;

  return (
    <div className="support-detail">
      <div className="support-detail-header">
        <button type="button" className="btn-link support-detail-back" onClick={onBack}>‹ Voltar</button>
        <div className="support-detail-heading">
          <h3>{ticket.subject}</h3>
          <span className="dim">Aberto por {ticket.author.displayName}</span>
        </div>
        <StatusChip status={ticket.status} />
        {isStaff && ticket.status === 'OPEN' && (
          <div className="support-detail-actions">
            {!ticket.claimedBy && <button className="btn-secondary" onClick={claim}>Assumir</button>}
            <button className="btn-secondary" onClick={close}>Fechar</button>
          </div>
        )}
      </div>

      <div className="support-messages">
        {ticket.messages.map((m) => (
          <div key={m.id} className={`support-message ${m.authorId === user.id ? 'mine' : ''}`}>
            <UserAvatar user={m.author} size={28} />
            <div className="support-message-bubble">
              <div className="support-message-meta">{m.author.displayName} · {formatTimeOnly(m.createdAt)}</div>
              <div>{m.content}</div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {ticket.status === 'OPEN' ? (
        <form onSubmit={send} className="support-reply-form">
          <input value={content} onChange={(e) => setContent(e.target.value)} placeholder="Escreva uma resposta..." maxLength={2000} />
          <button type="submit" className="btn-primary" disabled={sending}>Enviar</button>
        </form>
      ) : (
        <p className="dim support-closed-notice">Este chamado está fechado.</p>
      )}
    </div>
  );
}
