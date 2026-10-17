import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { listReminders, deleteReminder, markChannelRead, markConversationRead, listReplies } from '../api/endpoints';
import { useStore, isChannelUnread, isConversationUnread, roomKeyFor } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import UserAvatar from './UserAvatar.jsx';
import { Ico } from './PagesKit.jsx';
import { toggleSaved, useMsgExtras } from '../utils/messageExtras';
import '../styles/inbox.css';

// Caixa de Entrada (igual ao 📥 do Discord): Não lidas, Menções, Respostas
// (respostas a mensagens suas), Salvos ("Salvar para depois") e Lembretes,
// num painel que abre no topo sem sair da tela.
const TABS = [['unread', 'Não lidas'], ['mentions', 'Menções'], ['replies', 'Respostas'], ['saved', 'Salvos'], ['reminders', 'Lembretes']];
const when = (iso) => {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 60000;
  if (diff < 60) return `há ${Math.max(1, Math.round(diff))} min`;
  if (diff < 1440) return `há ${Math.round(diff / 60)} h`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

function MessageRow({ m, onOpen, action, showReplyTo = false }) {
  const preview = (m.content || '').slice(0, 220) || (m.attachments?.length ? `📎 ${m.attachments.length} anexo(s)` : '…');
  const original = showReplyTo && m.replyTo ? ((m.replyTo.content || '').slice(0, 90) || 'sua mensagem') : null;
  return (
    <li className="ibx-msg">
      <button type="button" className="ibx-msg-main" onClick={() => onOpen(m)}>
        <span className="ibx-where">{m.channelName ? `# ${m.channelName}` : 'Mensagem direta'} · {when(m.createdAt)}</span>
        {original && (
          <span className="ibx-reply-to"><Ico name="reply" size={13} /><span className="truncate">Respondendo a você: “{original}”</span></span>
        )}
        <span className="ibx-msg-head"><UserAvatar user={m.author} size={24} /><b>{m.author?.displayName || 'Alguém'}</b></span>
        <span className="ibx-msg-text">{preview}</span>
      </button>
      {action}
    </li>
  );
}

export default function InboxPopover({ onClose }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('pc-inbox-tab') || 'mentions'; } catch { return 'mentions'; } });
  const [data, setData] = useState({});
  const ref = useRef(null);
  const channels = useStore((s) => s.channels);
  const categories = useStore((s) => s.categories);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const conversations = useStore((s) => s.conversations);

  useEffect(() => { try { sessionStorage.setItem('pc-inbox-tab', tab); } catch { /* sem storage */ } }, [tab]);
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('.top-inbox-btn')) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const load = (t) => {
    if (t === 'mentions') api.get('/messages/mentions').then((r) => setData((d) => ({ ...d, mentions: r.data.messages || [] }))).catch(() => setData((d) => ({ ...d, mentions: [] })));
    if (t === 'replies') listReplies().then((r) => setData((d) => ({ ...d, replies: r.messages || [] }))).catch(() => setData((d) => ({ ...d, replies: [] })));
    if (t === 'saved') api.get('/messages/saved').then((r) => setData((d) => ({ ...d, saved: r.data.messages || [] }))).catch(() => setData((d) => ({ ...d, saved: [] })));
    if (t === 'reminders') listReminders().then((r) => setData((d) => ({ ...d, reminders: r?.active || [] }))).catch(() => setData((d) => ({ ...d, reminders: [] })));
  };
  useEffect(() => { load(tab); }, [tab]);

  const open = (m) => {
    const roomKey = roomKeyFor({ channelId: m.channelId, conversationId: m.conversationId });
    useStore.getState().setPendingJump({ roomKey, messageId: m.id, createdAt: m.createdAt });
    navigate(m.channelId ? `/channels/${m.channelId}` : `/conversations/${m.conversationId}`);
    onClose();
  };

  const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
  const unreadCh = allChannels.filter((ch) => isChannelUnread(ch, channelReadAt, user.id));
  const unreadCv = conversations.filter((c) => isConversationUnread(c, user.id));
  const readChannel = (ch) => { useStore.getState().markChannelReadLocal(ch.id); markChannelRead(ch.id).catch(() => {}); };
  const readConv = (c) => { useStore.getState().markConversationReadLocal(c.id); markConversationRead(c.id).catch(() => {}); };
  const readAll = () => { unreadCh.forEach(readChannel); unreadCv.forEach(readConv); };
  const convName = (c) => (c.isGroup ? c.name || c.members.map((m) => m.displayName).join(', ') : c.members.find((m) => m.id !== user.id)?.displayName || 'Conversa');

  return (
    <div className="ibx" ref={ref} role="dialog" aria-label="Caixa de Entrada">
      <header className="ibx-head">
        <Ico name="inbox" size={18} /><strong>Caixa de Entrada</strong>
        {tab === 'unread' && (unreadCh.length + unreadCv.length) > 0 && <button type="button" className="ibx-readall" onClick={readAll}><Ico name="checkAll" size={14} /> Marcar tudo como lido</button>}
      </header>
      <nav className="ibx-tabs" role="tablist">
        {TABS.map(([id, l]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {l}{id === 'unread' && unreadCh.length + unreadCv.length > 0 ? <em>{unreadCh.length + unreadCv.length}</em> : null}
          </button>
        ))}
      </nav>
      <div className="ibx-body">
        {tab === 'unread' && (
          unreadCh.length + unreadCv.length === 0 ? <Empty icon="checkAll" text="Tudo lido por aqui!" /> : (
            <ul className="ibx-list">
              {unreadCv.map((c) => (
                <li key={c.id} className="ibx-room">
                  <button type="button" onClick={() => { navigate(`/conversations/${c.id}`); onClose(); }}>
                    <Ico name="chat" size={16} /><b>{convName(c)}</b><span>{(c.lastMessage?.content || 'Nova mensagem').slice(0, 80)}</span>
                  </button>
                  <button type="button" className="ibx-mini" title="Marcar como lida" aria-label="Marcar como lida" onClick={() => readConv(c)}><Ico name="check" size={14} /></button>
                </li>
              ))}
              {unreadCh.map((ch) => (
                <li key={ch.id} className="ibx-room">
                  <button type="button" onClick={() => { navigate(`/channels/${ch.id}`); onClose(); }}>
                    <Ico name="hash" size={16} /><b>{ch.name}</b>{ch.unreadMentions > 0 && <em className="ibx-at">@{ch.unreadMentions}</em>}
                  </button>
                  <button type="button" className="ibx-mini" title="Marcar como lido" aria-label="Marcar como lido" onClick={() => readChannel(ch)}><Ico name="check" size={14} /></button>
                </li>
              ))}
            </ul>
          )
        )}
        {tab === 'mentions' && (!data.mentions ? <Loading /> : data.mentions.length === 0 ? <Empty icon="at" text="Ninguém te mencionou ainda." /> : (
          <ul className="ibx-list">{data.mentions.map((m) => <MessageRow key={m.id} m={m} onOpen={open} />)}</ul>
        ))}
        {tab === 'replies' && (!data.replies ? <Loading /> : data.replies.length === 0 ? <Empty icon="reply" text="Ninguém respondeu suas mensagens ainda." /> : (
          <ul className="ibx-list">{data.replies.map((m) => <MessageRow key={m.id} m={m} onOpen={open} showReplyTo />)}</ul>
        ))}
        {tab === 'saved' && (!data.saved ? <Loading /> : data.saved.length === 0 ? <Empty icon="star" text="Clique com o botão direito numa mensagem → Salvar para depois pra guardar aqui." /> : (
          <ul className="ibx-list">
            {data.saved.map((m) => (
              <MessageRow
                key={m.id} m={m} onOpen={open}
                action={<button type="button" className="ibx-mini" title="Remover dos salvos" aria-label="Remover dos salvos" onClick={() => { toggleSaved(m); setData((d) => ({ ...d, saved: d.saved.filter((x) => x.id !== m.id) })); }}><Ico name="close" size={13} /></button>}
              />
            ))}
          </ul>
        ))}
        {tab === 'reminders' && (!data.reminders ? <Loading /> : data.reminders.length === 0 ? <Empty icon="clock" text="Sem lembretes. Clique com o botão direito numa mensagem → Lembrar-me." /> : (
          <ul className="ibx-list">
            {data.reminders.map((r) => (
              <li key={r.id} className="ibx-room">
                <button type="button" onClick={() => { if (r.link) { navigate(r.link); onClose(); } }}>
                  <Ico name="clock" size={16} /><b>{r.text}</b><span>{new Date(r.dueAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </button>
                <button type="button" className="ibx-mini" title="Cancelar lembrete" aria-label="Cancelar lembrete" onClick={() => { deleteReminder(r.id).catch(() => {}); setData((d) => ({ ...d, reminders: d.reminders.filter((x) => x.id !== r.id) })); }}><Ico name="close" size={13} /></button>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

function Loading() { return <p className="ibx-empty">Carregando…</p>; }
function Empty({ icon, text }) { return <div className="ibx-empty"><Ico name={icon} size={26} /><span>{text}</span></div>; }

// Força o carregamento dos favoritos quando a caixa é usada.
export function useInboxPrefetch() { useEffect(() => { useMsgExtras.getState().load(); }, []); }
