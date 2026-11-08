import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import PageIcon from '../components/PageIcons.jsx';
import {
  listMyTickets, createTicket, getTicket, addTicketMessage,
  adminListTickets, claimTicket, closeTicket,
} from '../api/endpoints';
import { formatMessageTime } from '../utils/formatTime';
import '../styles/support.css';
import { useLiveRefresh } from '../utils/liveRefresh';

// Central de suporte: lista de chamados à esquerda e a conversa à direita
// (no celular, uma coisa de cada vez). A equipe ganha a aba "Fila" com
// todos os chamados, e pode assumir e fechar. Mesmas rotas de API de antes.
const isStaffRole = (u) => ['ADMIN', 'MODERATOR'].includes(u?.platformRole);

const TOPICS = [
  { icon: 'key', title: 'Conta e login', hint: 'Senha, e-mail, verificação', subject: 'Problema com minha conta' },
  { icon: 'flag', title: 'Denunciar alguém', hint: 'Assédio, spam, golpe', subject: 'Denúncia de usuário' },
  { icon: 'bolt', title: 'Algo não funciona', hint: 'Erro, travamento, bug', subject: 'Encontrei um problema' },
  { icon: 'bulb', title: 'Sugestão', hint: 'Ideias para o Project Club', subject: 'Sugestão' },
];

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export default function TicketsPage() {
  const { user } = useAuth();
  const { socket } = useSocket() || {};
  const isStaff = isStaffRole(user);
  const [mode, setMode] = useState(isStaff ? 'STAFF' : 'MINE');
  const [filter, setFilter] = useState('OPEN');
  const [query, setQuery] = useState('');
  const [tickets, setTickets] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [composing, setComposing] = useState(null); // null | { subject }

  const refresh = () => {
    const req = mode === 'STAFF' ? adminListTickets(undefined) : listMyTickets();
    return req.then((d) => setTickets(d.tickets)).catch(() => setTickets([]));
  };
  useEffect(() => { setTickets(null); refresh(); }, [mode]);

  // Mensagem nova / mudança de status em qualquer chamado: atualiza a lista.
  useEffect(() => {
    if (!socket) return;
    const onAny = () => refresh();
    socket.on('ticket:message', onAny);
    socket.on('ticket:update', onAny);
    return () => { socket.off('ticket:message', onAny); socket.off('ticket:update', onAny); };
  }, [socket, mode]);

  // Tempo real (11s): ressincroniza a lista (mensagens/status já chegam
  // por socket; isso cobre o que o socket perder).
  useLiveRefresh(({ put }) => (mode === 'STAFF' ? adminListTickets(undefined) : listMyTickets()).then((d) => put(setTickets)(d.tickets)), { enabled: tickets !== null, key: mode });

  const counts = useMemo(() => ({
    OPEN: tickets?.filter((t) => t.status === 'OPEN').length ?? 0,
    CLOSED: tickets?.filter((t) => t.status !== 'OPEN').length ?? 0,
    ALL: tickets?.length ?? 0,
  }), [tickets]);

  const visible = useMemo(() => {
    if (!tickets) return [];
    const q = query.trim().toLowerCase();
    return tickets.filter((t) => {
      if (filter === 'OPEN' && t.status !== 'OPEN') return false;
      if (filter === 'CLOSED' && t.status === 'OPEN') return false;
      if (!q) return true;
      return t.subject.toLowerCase().includes(q) || t.author?.displayName?.toLowerCase().includes(q);
    });
  }, [tickets, filter, query]);

  const switchMode = (m) => { setMode(m); setSelectedId(null); setComposing(null); setFilter('OPEN'); };
  const openTicket = (id) => { setComposing(null); setSelectedId(id); };
  const startNew = (subject = '') => { setSelectedId(null); setComposing({ subject }); };
  const paneOpen = !!selectedId || !!composing;

  return (
    <div className="sp">
      <header className="sp-hero">
        <span className="sp-hero-icon"><PageIcon name="headset" size={28} /></span>
        <div className="sp-hero-text">
          <h1>Central de suporte</h1>
          <p>Fale direto com a equipe do Project Club. A resposta chega aqui e nas suas notificações.</p>
        </div>
        <button type="button" className="sp-primary" onClick={() => startNew()}>
          <PageIcon name="plus" size={17} strokeWidth={2.2} /> Novo chamado
        </button>
      </header>

      {isStaff && (
        <div className="sp-modes" role="tablist" aria-label="Tipo de lista">
          <button type="button" role="tab" aria-selected={mode === 'STAFF'} className={`sp-mode${mode === 'STAFF' ? ' active' : ''}`} onClick={() => switchMode('STAFF')}>
            <PageIcon name="shield" size={16} /> Fila da equipe
          </button>
          <button type="button" role="tab" aria-selected={mode === 'MINE'} className={`sp-mode${mode === 'MINE' ? ' active' : ''}`} onClick={() => switchMode('MINE')}>
            <PageIcon name="user" size={16} /> Meus chamados
          </button>
        </div>
      )}

      <div className={`sp-layout${paneOpen ? ' pane-open' : ''}`}>
        <aside className="sp-list-panel">
          <div className="sp-list-tools">
            <label className="sp-search">
              <PageIcon name="search" size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={mode === 'STAFF' ? 'Buscar por assunto ou pessoa' : 'Buscar chamados'} />
            </label>
            <div className="sp-filters">
              {[['OPEN', 'Abertos'], ['CLOSED', 'Fechados'], ['ALL', 'Todos']].map(([k, label]) => (
                <button key={k} type="button" className={`sp-filter${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>
                  {label} <span>{counts[k]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="sp-list">
            {tickets === null && <div className="sp-skeleton"><span /><span /><span /></div>}
            {tickets && visible.length === 0 && (
              <div className="sp-list-empty">
                <PageIcon name={mode === 'STAFF' ? 'check' : 'inbox'} size={22} />
                <span>{query ? 'Nada encontrado.' : mode === 'STAFF' && filter === 'OPEN' ? 'Fila em dia! Nenhum chamado aberto.' : 'Nenhum chamado aqui.'}</span>
              </div>
            )}
            {visible.map((t) => {
              const last = t.messages?.[0];
              const waitingStaff = t.status === 'OPEN' && last && last.authorId === t.authorId;
              return (
                <button
                  key={t.id} type="button"
                  className={`sp-item${selectedId === t.id ? ' active' : ''}${t.status !== 'OPEN' ? ' closed' : ''}`}
                  onClick={() => openTicket(t.id)}
                >
                  {mode === 'STAFF'
                    ? <UserAvatar user={t.author} size={36} />
                    : <span className={`sp-item-status ${t.status === 'OPEN' ? 'open' : 'closed'}`}><PageIcon name={t.status === 'OPEN' ? 'chat' : 'check'} size={16} /></span>}
                  <span className="sp-item-body">
                    <span className="sp-item-top">
                      <strong className="truncate">{t.subject}</strong>
                      <time dateTime={t.updatedAt}>{timeAgo(t.updatedAt)}</time>
                    </span>
                    <span className="sp-item-preview truncate">
                      {mode === 'STAFF' && <b>{t.author?.displayName}: </b>}
                      {last?.content || 'Sem mensagens'}
                    </span>
                    <span className="sp-item-tags">
                      {t.status !== 'OPEN' && <span className="sp-tag">Fechado</span>}
                      {t.status === 'OPEN' && (waitingStaff
                        ? <span className="sp-tag warn">{mode === 'STAFF' ? 'Aguardando resposta' : 'Aguardando equipe'}</span>
                        : <span className="sp-tag ok">{mode === 'STAFF' ? 'Respondido' : 'Equipe respondeu'}</span>)}
                      {t.claimedBy && <span className="sp-tag">com {t.claimedBy.displayName}</span>}
                      {t._count?.messages > 0 && <span className="sp-tag muted"><PageIcon name="chat" size={12} /> {t._count.messages}</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="sp-pane">
          {composing ? (
            <NewTicket
              key={composing.subject}
              initialSubject={composing.subject}
              onCancel={() => setComposing(null)}
              onCreated={(id) => { setComposing(null); if (mode === 'STAFF') switchMode('MINE'); refresh(); setSelectedId(id); }}
            />
          ) : selectedId ? (
            <TicketDetail key={selectedId} id={selectedId} canModerate={isStaff} onBack={() => setSelectedId(null)} onChanged={refresh} />
          ) : (
            <Welcome isStaff={isStaff && mode === 'STAFF'} openCount={counts.OPEN} onTopic={startNew} />
          )}
        </section>
      </div>
    </div>
  );
}

function Welcome({ isStaff, openCount, onTopic }) {
  if (isStaff) {
    return (
      <div className="sp-welcome">
        <span className="sp-welcome-icon"><PageIcon name="shield" size={30} /></span>
        <h2>{openCount > 0 ? `${openCount} ${openCount === 1 ? 'chamado aberto' : 'chamados abertos'}` : 'Tudo respondido'}</h2>
        <p>Escolha um chamado na lista para ler a conversa, assumir o atendimento ou fechar.</p>
      </div>
    );
  }
  return (
    <div className="sp-welcome">
      <span className="sp-welcome-icon"><PageIcon name="headset" size={30} /></span>
      <h2>Como podemos ajudar?</h2>
      <p>Escolha um assunto para começar ou abra um chamado livre.</p>
      <div className="sp-topics">
        {TOPICS.map((t) => (
          <button key={t.title} type="button" className="sp-topic" onClick={() => onTopic(t.subject)}>
            <span className="sp-topic-icon"><PageIcon name={t.icon} size={20} /></span>
            <span><strong>{t.title}</strong><small>{t.hint}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}

function NewTicket({ initialSubject, onCancel, onCreated }) {
  const [subject, setSubject] = useState(initialSubject);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!subject.trim() || !content.trim()) return;
    setError(''); setSending(true);
    try {
      const { ticket } = await createTicket(subject.trim(), content.trim());
      onCreated(ticket.id);
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível abrir o chamado.');
    } finally { setSending(false); }
  };

  return (
    <form className="sp-new" onSubmit={submit}>
      <div className="sp-pane-head">
        <button type="button" className="sp-back" onClick={onCancel} aria-label="Voltar"><PageIcon name="back" size={20} /></button>
        <div className="sp-pane-title"><h2>Novo chamado</h2><span>A equipe costuma responder no mesmo dia.</span></div>
      </div>
      <div className="sp-new-body">
        <label className="sp-field">
          <span>Assunto</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="Resuma em poucas palavras" required autoFocus={!initialSubject} />
        </label>
        <label className="sp-field">
          <span>Descreva o que aconteceu</span>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={7} maxLength={2000} placeholder="Quanto mais detalhes (o que você fez, o que apareceu, links), mais rápido resolvemos." required autoFocus={!!initialSubject} />
          <small>{content.length}/2000</small>
        </label>
        <p className="sp-tip"><PageIcon name="lock" size={14} /> Nunca envie sua senha. A equipe não precisa dela para ajudar.</p>
        {error && <p className="sp-error" role="alert">{error}</p>}
      </div>
      <div className="sp-new-actions">
        <button type="button" className="sp-ghost" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="sp-primary" disabled={sending || !subject.trim() || !content.trim()}>
          <PageIcon name="send" size={16} /> {sending ? 'Enviando…' : 'Enviar chamado'}
        </button>
      </div>
    </form>
  );
}

function TicketDetail({ id, canModerate, onBack, onChanged }) {
  const { user } = useAuth();
  const { socket } = useSocket() || {};
  const [ticket, setTicket] = useState(null);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const refresh = () => getTicket(id).then((d) => setTicket(d.ticket)).catch(() => setTicket(false));
  useEffect(() => { refresh(); }, [id]);

  useEffect(() => {
    if (!socket) return;
    socket.emit('ticket:join', id);
    const onEvt = (data) => { if (data.ticketId === id) refresh(); };
    socket.on('ticket:message', onEvt);
    socket.on('ticket:update', onEvt);
    return () => { socket.off('ticket:message', onEvt); socket.off('ticket:update', onEvt); };
  }, [socket, id]);

  // Ressincronização leve do chamado aberto (as mensagens já chegam por
  // socket) — não mexe no texto sendo digitado.
  useLiveRefresh(({ put }) => getTicket(id).then((d) => put(setTicket)(d.ticket)), { enabled: !!ticket, key: id, interval: 33000 });

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [ticket?.messages?.length]);

  // Caixa de resposta cresce com o texto (até um limite).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [content]);

  const send = async (e) => {
    e?.preventDefault();
    if (!content.trim() || sending) return;
    setSending(true); setError('');
    try { await addTicketMessage(id, content.trim()); setContent(''); await refresh(); onChanged?.(); }
    catch (err) { setError(err.response?.data?.error || 'Não foi possível enviar.'); }
    finally { setSending(false); }
  };
  const onKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  const claim = async () => { await claimTicket(id); refresh(); onChanged?.(); };
  const close = async () => {
    if (!confirm('Fechar este chamado? A pessoa não poderá mais responder nele.')) return;
    await closeTicket(id); refresh(); onChanged?.();
  };

  if (ticket === false) return <div className="sp-welcome"><h2>Não foi possível abrir</h2><p>Esse chamado não existe ou você não tem acesso.</p></div>;
  if (!ticket) return <div className="sp-skeleton pane"><span /><span /><span /></div>;

  const open = ticket.status === 'OPEN';
  const staffView = canModerate && ticket.author.id !== user.id;

  return (
    <div className="sp-detail">
      <div className="sp-pane-head">
        <button type="button" className="sp-back" onClick={onBack} aria-label="Voltar"><PageIcon name="back" size={20} /></button>
        <div className="sp-pane-title">
          <h2 className="truncate">{ticket.subject}</h2>
          <span>
            <span className={`sp-state ${open ? 'open' : 'closed'}`}>{open ? 'Aberto' : 'Fechado'}</span>
            {staffView && <> · {ticket.author.displayName}</>}
            {ticket.claimedBy && <> · com {ticket.claimedBy.displayName}</>}
          </span>
        </div>
        {canModerate && open && (
          <div className="sp-actions">
            {!ticket.claimedBy && <button type="button" className="sp-ghost" onClick={claim}><PageIcon name="user" size={15} /> Assumir</button>}
            <button type="button" className="sp-ghost danger" onClick={close}><PageIcon name="check" size={15} /> Fechar</button>
          </div>
        )}
      </div>

      <div className="sp-messages">
        <div className="sp-opened">Chamado aberto em {new Date(ticket.createdAt || ticket.messages[0]?.createdAt || Date.now()).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
        {ticket.messages.map((m, i) => {
          const mine = m.authorId === user.id;
          const prev = ticket.messages[i - 1];
          const grouped = prev && prev.authorId === m.authorId && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60000;
          const fromStaff = isStaffRole(m.author) && m.authorId !== ticket.author.id;
          return (
            <div key={m.id} className={`sp-msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`}>
              {!grouped ? <UserAvatar user={m.author} size={32} /> : <span className="sp-msg-spacer" />}
              <div className="sp-msg-col">
                {!grouped && (
                  <div className="sp-msg-meta">
                    <strong>{mine ? 'Você' : m.author.displayName}</strong>
                    {fromStaff && <span className="sp-staff-tag"><PageIcon name="shield" size={11} strokeWidth={2.2} /> Equipe</span>}
                    <time dateTime={m.createdAt}>{formatMessageTime(m.createdAt)}</time>
                  </div>
                )}
                <div className="sp-bubble">{m.content}</div>
              </div>
            </div>
          );
        })}
        {!open && <div className="sp-closed-note"><PageIcon name="check" size={16} /> Este chamado foi fechado. Se precisar de mais ajuda, abra um novo.</div>}
        <div ref={bottomRef} />
      </div>

      {open && (
        <form className="sp-composer" onSubmit={send}>
          <textarea
            ref={inputRef} rows={1} value={content} maxLength={2000}
            onChange={(e) => setContent(e.target.value)} onKeyDown={onKeyDown}
            placeholder={staffView ? `Responder ${ticket.author.displayName}…` : 'Escreva uma mensagem…'}
          />
          <button type="submit" className="sp-send" disabled={sending || !content.trim()} aria-label="Enviar"><PageIcon name="send" size={18} /></button>
          {error && <p className="sp-error" role="alert">{error}</p>}
        </form>
      )}
    </div>
  );
}
