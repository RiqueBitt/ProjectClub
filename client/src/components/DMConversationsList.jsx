import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, isConversationUnread } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { leaveConversation } from '../api/endpoints';
import PresenceDot from './PresenceDot.jsx';
import NewDMModal from './modals/NewDMModal.jsx';
import ConversationIcon from './ConversationIcon.jsx';
import UserAvatar from './UserAvatar.jsx';
import cancelIcon from '../assets/icons/cancel.png';

// Lista de conversas diretas (DMs/grupos) — vive dentro da área "Amigos"
// (ver AmigosPage.jsx), na aba "Mensagens". É o mesmo conteúdo que antes
// vivia em DMSidebar.jsx (dropdown do antigo TopMenu), só que agora
// renderizado como conteúdo normal da página em vez de uma coluna lateral
// fixa — a barra lateral principal (MainSidebar.jsx) é a única que sobra.
export default function DMConversationsList() {
  const conversations = useStore((s) => s.conversations);
  const presence = useStore((s) => s.presence);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [newDMOpen, setNewDMOpen] = useState(false);

  const sorted = [...conversations].sort((a, b) => {
    const at = a.lastMessage?.createdAt || 0;
    const bt = b.lastMessage?.createdAt || 0;
    return new Date(bt) - new Date(at);
  });

  const doLeave = async (e, conversationId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Sair deste grupo?')) return;
    await leaveConversation(conversationId).catch(() => {});
    useStore.getState().setConversations(useStore.getState().conversations.filter((c) => c.id !== conversationId));
    navigate('/dms');
  };

  return (
    <div className="dm-conversations-list">
      <div className="dm-conversations-header">
        <button className="btn-secondary" onClick={() => setNewDMOpen(true)}>+ Nova conversa</button>
      </div>
      {sorted.length === 0 && (
        <div className="friends-empty-state">
          <div className="friends-empty-state-icon">✉️</div>
          <h3>Nenhuma conversa ainda.</h3>
          <p>Inicie uma conversa direta com um amigo usando o botão acima.</p>
        </div>
      )}
      <nav className="sidebar-list">
        {sorted.map((c) => {
          const other = !c.isGroup ? c.members.find((m) => m.id !== user.id) : null;
          const name = c.isGroup ? (c.name || c.members.map((m) => m.displayName).join(', ')) : other?.displayName;
          const status = other ? (presence[other.id]?.status || other.status) : null;
          const unread = isConversationUnread(c, user.id);
          return (
            <button
              type="button"
              key={c.id}
              onClick={() => navigate(`/conversations/${c.id}`)}
              className={`sidebar-item dm-item ${unread ? 'unread' : ''}`}
            >
              <div className="avatar-wrap small">
                {c.isGroup ? (
                  <ConversationIcon conversation={c} size="small" />
                ) : (
                  <div className="avatar small">
                    <UserAvatar user={other || { displayName: name }} size={32} />
                  </div>
                )}
                {status && <PresenceDot status={status} />}
              </div>
              <span className="truncate">{name}</span>
              {unread && <span className="unread-dot" />}
              {c.isGroup && (
                <button className="dm-item-leave" title="Sair do grupo" onClick={(e) => doLeave(e, c.id)}>
                  <img className="ui-icon-sm" src={cancelIcon} alt="x" />
                </button>
              )}
            </button>
          );
        })}
      </nav>
      {newDMOpen && <NewDMModal onClose={() => setNewDMOpen(false)} />}
    </div>
  );
}
