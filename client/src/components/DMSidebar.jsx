import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useStore, isConversationUnread, isMainInbox } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { leaveConversation } from '../api/endpoints';
import PresenceDot from './PresenceDot.jsx';
import NewDMModal from './modals/NewDMModal.jsx';
import ConversationIcon from './ConversationIcon.jsx';
import UserAvatar from './UserAvatar.jsx';
import TypingDots from './TypingDots.jsx';
import cancelIcon from '../assets/icons/cancel.png';
import ListSkeleton from './ListSkeleton.jsx';
import { useContextMenu } from '../context/ContextMenuContext.jsx';
import { sortConversations, conversationMenuItems } from '../utils/dmPins';
import PinGlyph from './PinGlyph.jsx';
import { conversationPath } from '../utils/prettyLinks';

export default function DMSidebar() {
  const conversations = useStore((s) => s.conversations);
  const conversationsLoaded = useStore((s) => s.conversationsLoaded);
  const presence = useStore((s) => s.presence);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [newDMOpen, setNewDMOpen] = useState(false);

  const { openMenu } = useContextMenu();

  // Fixadas no topo (até 10, sincronizadas na conta), depois as recentes.
  const sorted = sortConversations(conversations.filter(isMainInbox));
  const pinned = sorted.filter((c) => c.pinnedAt);
  const others = sorted.filter((c) => !c.pinnedAt);

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

  const renderItem = (c) => {
    const other = !c.isGroup ? c.members.find((m) => m.id !== user.id) : null;
    const name = c.isGroup ? (c.name || c.members.map((m) => m.displayName).join(', ')) : other?.displayName;
    const status = other ? (presence[other.id]?.status || other.status) : null;
    const unread = isConversationUnread(c, user.id);
    return (
      <NavLink
        key={c.id}
        to={conversationPath(c)}
        className={({ isActive }) => `sidebar-item dm-item ${isActive ? 'active' : ''} ${unread ? 'unread' : ''} ${c.pinnedAt ? 'pinned' : ''}`}
        onContextMenu={(e) => openMenu(e, conversationMenuItems(c))}
      >
        <div className="avatar-wrap small">
          {c.isGroup ? (
            <ConversationIcon conversation={c} size="small" />
          ) : (
            <div className="avatar small">
              <UserAvatar user={other || { displayName: name }} size={32} />
            </div>
          )}
          {status && <PresenceDot status={status} userId={other?.id} />}
        </div>
        <span className="truncate">{name}</span>
        {c.pinnedAt && <PinGlyph />}
        <TypingDots roomKey={`conversation:${c.id}`} myUserId={user.id} />
        {unread && <span className="unread-dot" />}
        {c.isGroup && (
          <button className="dm-item-leave" title="Sair do grupo" onClick={(e) => doLeave(e, c.id)}>
            <img className="ui-icon-sm" src={cancelIcon} alt="x" />
          </button>
        )}
      </NavLink>
    );
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
        {!conversationsLoaded && conversations.length === 0 && <ListSkeleton variant="dms" rows={6} label="Carregando conversas…" />}
        {pinned.length > 0 && (
          <>
            <div className="sidebar-section-label dm-pinned-label"><span>FIXADAS</span></div>
            {pinned.map(renderItem)}
            {others.length > 0 && <div className="sidebar-section-label dm-pinned-label"><span>RECENTES</span></div>}
          </>
        )}
        {others.map(renderItem)}
      </nav>
      {newDMOpen && <NewDMModal onClose={() => setNewDMOpen(false)} />}
    </aside>
  );
}
