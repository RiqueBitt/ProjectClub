import { useEffect, useState } from 'react';
import Modal from '../Modal.jsx';
import { listMessages, sendMessage, toggleArchiveTopic } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext.jsx';
import { useStore } from '../../store/useStore';
import { getMyCommunityPermissions, hasPermission } from '../../utils/permissions';
import Message from '../Message.jsx';

// A "topic" is a titled reply to some message in a regular text channel —
// see Message.jsx's "Criar tópico" context-menu action. This reuses the
// exact same threadId query param and root+replies shape that
// ForumChannelView.jsx's own thread view uses for forum posts; the only
// difference is this one opens as a floating modal (since a regular text
// channel, unlike a forum channel, doesn't have a dedicated full-pane
// layout to switch into) instead of taking over the whole pane.
export default function TopicThreadModal({ channel, rootMessage, onClose }) {
  const { user } = useAuth();
  const [replies, setReplies] = useState([]);
  const [content, setContent] = useState('');
  const roles = useStore((s) => s.roles);
  const members = useStore((s) => s.members);
  const myPerms = getMyCommunityPermissions(roles, members, user.id, user.platformRole);
  const canManage = hasPermission(myPerms, 'MANAGE_MESSAGES');
  const archived = !!rootMessage.archived;

  const toggleArchive = () => { toggleArchiveTopic(rootMessage.id).catch(() => {}); };

  const load = () => {
    listMessages({ channelId: channel.id, threadId: rootMessage.id }).then((d) =>
      setReplies(d.messages.filter((m) => m.id !== rootMessage.id)),
    );
  };

  useEffect(() => { load(); }, [rootMessage.id]);

  const submit = async (e) => {
    e.preventDefault();
    if (!content.trim()) return;
    const fd = new FormData();
    fd.append('channelId', channel.id);
    fd.append('content', content.trim());
    fd.append('replyToId', rootMessage.id);
    await sendMessage(fd);
    setContent('');
    load();
  };

  return (
    <Modal title={`🧵 ${rootMessage.title}${archived ? ' (arquivado)' : ''}`} onClose={onClose} width="480px">
      <div className="topic-thread-body">
        <div className="forum-post-card static">
          <div className="forum-post-meta">
            iniciado por {rootMessage.author.displayName} · {new Date(rootMessage.createdAt).toLocaleString('pt-BR')}
          </div>
          {canManage && (
            <button type="button" className="btn-link" onClick={toggleArchive}>
              {archived ? 'Reabrir tópico' : 'Arquivar tópico'}
            </button>
          )}
        </div>
        <div className="message-list topic-thread-list">
          {replies.length === 0 && <div className="empty-hint">Nenhuma resposta ainda.</div>}
          {replies.map((m) => <Message key={m.id} message={m} showAuthor onReply={() => {}} />)}
        </div>
        {archived ? (
          <div className="empty-hint">Este tópico foi arquivado — não é mais possível responder.</div>
        ) : (
          <form className="message-input-bar topic-thread-input" onSubmit={submit}>
            <div className="message-input-row">
              <input
                className="message-input"
                placeholder="Responder no tópico..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              <button type="submit" className="icon-btn send-btn">➤</button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
