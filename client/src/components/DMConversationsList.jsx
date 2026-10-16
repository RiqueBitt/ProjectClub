import { useState } from 'react';
import { convName, lastPreview, timeAgo } from './DMQuick.jsx';
import { useNavigate } from 'react-router-dom';
import { useStore, isConversationUnread, isMainInbox } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { leaveConversation, setConversationInbox } from '../api/endpoints';
import PresenceDot from './PresenceDot.jsx';
import NewDMModal from './modals/NewDMModal.jsx';
import ConversationIcon from './ConversationIcon.jsx';
import UserAvatar from './UserAvatar.jsx';
import TypingDots from './TypingDots.jsx';
import SocialIcon from './SocialIcons.jsx';
import cancelIcon from '../assets/icons/cancel.png';
import PinGlyph from './PinGlyph.jsx';
import { useContextMenu } from '../context/ContextMenuContext.jsx';
import { sortConversations, conversationMenuItems } from '../utils/dmPins';

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
  const [filter, setFilter] = useState('');
  // Caixas: Mensagens (normal), Solicitações e Spam (igual ao Discord).
  const [box, setBox] = useState('main');
  const requests = conversations.filter((c) => c.inbox === 'request');
  const spam = conversations.filter((c) => c.inbox === 'spam');
  const inBox = (c) => (box === 'main' ? isMainInbox(c) : c.inbox === box);
  const act = async (e, c, action) => {
    e.preventDefault(); e.stopPropagation();
    const inbox = { accept: 'main', ignore: 'ignored', spam: 'spam' }[action];
    useStore.getState().setConversations(useStore.getState().conversations.map((x) => (x.id === c.id ? { ...x, inbox } : x)));
    setConversationInbox(c.id, action).catch(() => {});
  };

  const { openMenu } = useContextMenu();

  // Na caixa normal, as fixadas (até 10, sincronizadas na conta) vêm
  // primeiro, numa seção própria; Solicitações/Spam ficam só por data.
  const sorted = sortConversations(conversations.filter(inBox).map((c) => (box === 'main' ? c : { ...c, pinnedAt: null })))
    .filter((c) => !filter.trim() || convName(c, user.id).toLowerCase().includes(filter.trim().toLowerCase()));
  const pinned = box === 'main' ? sorted.filter((c) => c.pinnedAt) : [];
  const others = box === 'main' ? sorted.filter((c) => !c.pinnedAt) : sorted;

  const doLeave = async (e, conversationId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Sair deste grupo?')) return;
    await leaveConversation(conversationId).catch(() => {});
    useStore.getState().setConversations(useStore.getState().conversations.filter((c) => c.id !== conversationId));
    navigate('/dms');
  };

  const renderItem = (c) => {
    const other = !c.isGroup ? c.members.find((m) => m.id !== user.id) : null;
    const name = c.isGroup ? (c.name || c.members.map((m) => m.displayName).join(', ')) : other?.displayName;
    const status = other ? (presence[other.id]?.status || other.status) : null;
    const unread = isConversationUnread(c, user.id);
    return (
      <button
        type="button"
        key={c.id}
        onClick={() => navigate(`/conversations/${c.id}`)}
        className={`sidebar-item dm-item ${unread ? 'unread' : ''} ${c.pinnedAt ? 'pinned' : ''}`}
        onContextMenu={box === 'main' ? (e) => openMenu(e, conversationMenuItems(c)) : undefined}
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
        <span className="dm-item-text">
          <span className="dm-item-name-row"><span className="truncate" data-no-translate>{name}</span>{c.pinnedAt && <PinGlyph />}</span>
          <span className="dm-item-preview" data-no-translate>{lastPreview(c, user.id)}</span>
        </span>
        <span className="dm-item-time">{timeAgo(c.lastMessage?.createdAt)}</span>
        <TypingDots roomKey={`conversation:${c.id}`} myUserId={user.id} />
        {unread && <span className="unread-dot" />}
        {box !== 'main' && (
          <span className="dm-box-actions">
            <span role="button" tabIndex={0} className="ok" onClick={(e) => act(e, c, 'accept')} onKeyDown={(e) => { if (e.key === 'Enter') act(e, c, 'accept'); }}>{box === 'spam' ? 'Não é spam' : 'Aceitar'}</span>
            {box === 'request' && <span role="button" tabIndex={0} onClick={(e) => act(e, c, 'spam')} onKeyDown={(e) => { if (e.key === 'Enter') act(e, c, 'spam'); }}>Spam</span>}
            <span role="button" tabIndex={0} onClick={(e) => act(e, c, 'ignore')} onKeyDown={(e) => { if (e.key === 'Enter') act(e, c, 'ignore'); }}>Ignorar</span>
          </span>
        )}
        {c.isGroup && (
          <button className="dm-item-leave" title="Sair do grupo" onClick={(e) => doLeave(e, c.id)}>
            <img className="ui-icon-sm" src={cancelIcon} alt="x" />
          </button>
        )}
      </button>
    );
  };

  return (
    <div className="dm-conversations-list">
      <div className="dm-conversations-header">
        <input className="dm-conv-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar conversas…" aria-label="Filtrar conversas" />
        <button className="btn-secondary" onClick={() => setNewDMOpen(true)}>+ Nova conversa</button>
      </div>
      {(requests.length > 0 || spam.length > 0 || box !== 'main') && (
        <div className="dm-boxes" role="tablist" aria-label="Caixas de mensagens">
          <button type="button" role="tab" aria-selected={box === 'main'} className={box === 'main' ? 'on' : ''} onClick={() => setBox('main')}>Mensagens</button>
          <button type="button" role="tab" aria-selected={box === 'request'} className={box === 'request' ? 'on' : ''} onClick={() => setBox('request')}>Solicitações{requests.length ? <em>{requests.length}</em> : null}</button>
          <button type="button" role="tab" aria-selected={box === 'spam'} className={box === 'spam' ? 'on' : ''} onClick={() => setBox('spam')}>Spam{spam.length ? <em>{spam.length}</em> : null}</button>
        </div>
      )}
      {box !== 'main' && (
        <p className="dm-box-hint">
          {box === 'request'
            ? 'Mensagens de quem não é seu amigo. Elas não fazem barulho nem acendem notificação até você aceitar.'
            : 'Mensagens que pareceram spam. Confira antes de responder — nunca clique em links estranhos.'}
        </p>
      )}
      {box !== 'main' && sorted.length === 0 && <div className="friends-empty-state"><h3>{box === 'request' ? 'Nenhuma solicitação.' : 'Nada no spam.'}</h3></div>}
      {box === 'main' && sorted.length === 0 && !filter && (
        <div className="friends-empty-state">
          <div className="friends-empty-state-icon"><SocialIcon name="chat" size={30} /></div>
          <h3>Nenhuma conversa ainda.</h3>
          <p>Comece uma conversa direta com um amigo pelo botão acima.</p>
        </div>
      )}
      <nav className="sidebar-list">
        {pinned.length > 0 && (
          <>
            <div className="sidebar-section-label dm-pinned-label"><span>Fixadas</span></div>
            {pinned.map(renderItem)}
            {others.length > 0 && <div className="sidebar-section-label dm-pinned-label"><span>Recentes</span></div>}
          </>
        )}
        {others.map(renderItem)}
      </nav>
      {newDMOpen && <NewDMModal onClose={() => setNewDMOpen(false)} />}
    </div>
  );
}
