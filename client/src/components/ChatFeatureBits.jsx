// Peças pequenas dos recursos de chat usadas dentro da lista de mensagens:
//   - SystemMessageRow: "📌 Fulano fixou uma mensagem." (aviso do sistema)
//   - ThreadStarterRow: a raiz de um tópico na lista do canal ("Fulano
//     criou um tópico") com o cartão do tópico
//   - ThreadCard: nome + contador de respostas + prévia da última resposta
//   - FeatureIcon: ícones de traço destes recursos (sem mexer em ChatIcons)
import { useStore, roomKeyFor } from '../store/useStore';
import { formatMessageTime } from '../utils/formatTime';
import { isThreadArchived, threadReplyLabel } from '../utils/chatFeatures';
import UserAvatar from './UserAvatar.jsx';
import '../styles/chat-features.css';

const ICONS = {
  thread: <><path d="M5 5h10a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H10l-4 3v-3H5" /><path d="M8 9h6M8 12h3" /></>,
  pin: <><path d="M12 17v5" /><path d="M9 10.76V6a1 1 0 0 0-1-1 2 2 0 0 1 0-4h8a2 2 0 0 1 0 4 1 1 0 0 0-1 1v4.76a2 2 0 0 0 1.11 1.79l1.78.9A2 2 0 0 1 19 15.24V16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-.76a2 2 0 0 1 1.11-1.79l1.78-.9A2 2 0 0 0 9 10.76" /></>,
  archive: <><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></>,
  unarchive: <><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="m9 15 3-3 3 3M12 12v6" /></>,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  attach: <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
  send: <><path d="M3.7 3.05a.5.5 0 0 0-.68.63l2.84 7.62a2 2 0 0 1 0 1.4l-2.84 7.62a.5.5 0 0 0 .68.63l18-8.5a.5.5 0 0 0 0-.9z" /><path d="M6 12h16" /></>,
  arrowUp: <path d="m5 12 7-7 7 7M12 19V5" />,
  bookmark: <path d="M6 4h12v17l-6-4-6 4z" />,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  reply: <><path d="M9 17 4 12l5-5" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></>,
};

export function FeatureIcon({ name, size = 18, className = '' }) {
  return (
    <svg
      className={`chat-icon ${className}`} width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

function openPins() {
  window.dispatchEvent(new CustomEvent('pc:open-pins'));
}

// Aviso do sistema (hoje: só "fixou uma mensagem").
export function SystemMessageRow({ message, system }) {
  if (system.system !== 'pin') return null;
  const goTo = () => {
    if (!system.targetId) return;
    useStore.getState().setPendingJump({
      roomKey: roomKeyFor({ channelId: message.channelId, conversationId: message.conversationId }),
      messageId: system.targetId,
    });
  };
  return (
    <div className="message chat-system-row" data-message-id={message.id} role="note">
      <span className="chat-system-icon"><FeatureIcon name="pin" size={16} /></span>
      <span className="chat-system-text">
        <b>{message.author?.displayName || 'Alguém'}</b> fixou{' '}
        <button type="button" className="chat-system-link" onClick={goTo}>uma mensagem</button>{' '}
        neste canal. <button type="button" className="chat-system-link" onClick={openPins}>Ver todas as fixadas</button>.
      </span>
      <time className="chat-system-time" dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
    </div>
  );
}

// Cartão do tópico: aparece sob a mensagem-mãe e na linha da raiz.
export function ThreadCard({ thread, onOpen, compact = false }) {
  const archived = isThreadArchived(thread);
  const last = thread.threadLastReply;
  const count = thread.threadReplyCount || 0;
  return (
    <button
      type="button"
      className={`thread-card ${archived ? 'is-archived' : ''} ${compact ? 'is-compact' : ''}`}
      onClick={() => onOpen?.(thread)}
      aria-label={`Abrir tópico ${thread.title}`}
    >
      <span className="thread-card-head">
        <FeatureIcon name={thread.archived ? 'lock' : archived ? 'archive' : 'thread'} size={15} />
        <b className="truncate">{thread.title}</b>
        <span className="thread-card-count">{threadReplyLabel(count)}</span>
        {archived && <span className="thread-card-badge">{thread.archived ? 'Trancado' : 'Arquivado'}</span>}
      </span>
      {!compact && last && (
        <span className="thread-card-last">
          <UserAvatar user={last.author} size={18} />
          <b className="truncate">{last.author?.displayName}</b>
          <span className="truncate">{last.preview || '…'}</span>
          <time dateTime={last.createdAt}>{formatMessageTime(last.createdAt)}</time>
        </span>
      )}
      {!compact && !last && count === 0 && <span className="thread-card-last is-empty">Seja a primeira pessoa a responder</span>}
    </button>
  );
}

// Raiz do tópico na lista principal do canal.
export function ThreadStarterRow({ message, onOpenTopic }) {
  return (
    <div className="message chat-system-row thread-starter-row" data-message-id={message.id}>
      <span className="chat-system-icon"><FeatureIcon name="thread" size={16} /></span>
      <div className="thread-starter-body">
        <span className="chat-system-text">
          <b>{message.author?.displayName || 'Alguém'}</b> criou um tópico.
          <time className="chat-system-time" dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
        </span>
        <ThreadCard thread={message} onOpen={onOpenTopic} />
      </div>
    </div>
  );
}
