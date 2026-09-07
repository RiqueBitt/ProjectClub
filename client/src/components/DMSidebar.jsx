import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useStore, isConversationUnread } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { leaveConversation } from '../api/endpoints';
import PresenceDot from './PresenceDot.jsx';
import NewDMModal from './modals/NewDMModal.jsx';
import ConversationIcon from './ConversationIcon.jsx';
import UserAvatar from './UserAvatar.jsx';
import cancelIcon from '../assets/icons/cancel.png';

export default function DMSidebar() {
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

  // Only group DMs can be left this way — see leaveConversation on the
  // server, a 1:1 DM never offers this (there'd be nobody left to talk to).
  const doLeave = async (e, conversationId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Sair deste grupo?')) return;
    await leaveConversation(conversationId).catch(() => {});
    useStore.getState().setConversations(useStore.getState().conversations.filter((c) => c.id !== conversationId));
    navigate('/');
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-search">
        <input placeholder="Encontrar ou iniciar uma conversa" readOnly onClick={() => setNewDMOpen(true)} />
        <kbd className="sidebar-search-kbd" title="Pular para um canal ou conversa">Ctrl+K</kbd>
      </div>
      <nav className="sidebar-list">
        <NavLink to="/" end className={({ isActive }) => `sidebar-item friends-link ${isActive ? 'active' : ''}`}>
          👥 Amigos
        </NavLink>
        <div className="sidebar-section-label">
          <span>MENSAGENS DIRETAS</span>
          <button className="icon-btn-small" onClick={() => setNewDMOpen(true)}>+</button>
        </div>
        {sorted.map((c) => {
          const other = !c.isGroup ? c.members.find((m) => m.id !== user.id) : null;
          const name = c.isGroup ? (c.name || c.members.map((m) => m.displayName).join(', ')) : other?.displayName;
          const status = other ? (presence[other.id]?.status || other.status) : null;
          const unread = isConversationUnread(c, user.id);
          return (
            <NavLink
              key={c.id}
              to={`/conversations/${c.id}`}
              className={({ isActive }) => `sidebar-item dm-item ${isActive ? 'active' : ''} ${unread ? 'unread' : ''}`}
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
            </NavLink>
          );
        })}
      </nav>
      {newDMOpen && <NewDMModal onClose={() => setNewDMOpen(false)} />}
    </aside>
  );
}
