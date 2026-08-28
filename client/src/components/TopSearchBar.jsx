import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, isChannelUnread, isConversationUnread } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import UserAvatar from './UserAvatar.jsx';
import logoIcon from '../assets/icons/logo-project-club.png';
import searchIcon from '../assets/icons/nav-search.png';
import notificationsIcon from '../assets/icons/nav-notifications.png';
import createPostIcon from '../assets/icons/nav-create-post.png';

// NOVO — barra de topo estilo Reddit (o clone que o usuário mandou tem
// uma .navBar fixa no topo com logo + campo de busca em pílula + sino de
// notificações + avatar, sempre visível independente da página aberta).
// Fica na linha 1 do grid do .app-shell (ver MainApp.jsx), ocupando as 3
// colunas — a MainSidebar/conteúdo/lista de membros continuam exatamente
// como eram, só empurrados uma linha pra baixo.
export default function TopSearchBar() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const conversations = useStore((s) => s.conversations);
  const friends = useStore((s) => s.friends);

  const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
  const unreadChannels = allChannels.filter((ch) => isChannelUnread(ch, channelReadAt, user.id)).length;
  const unreadConversations = conversations.filter((c) => isConversationUnread(c, user.id)).length;
  const pendingIncoming = friends.filter((f) => f.status === 'PENDING' && f.isIncoming).length;
  const notifBadge = unreadChannels + unreadConversations + pendingIncoming;

  const submitSearch = (e) => {
    e.preventDefault();
    navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search');
  };

  return (
    <div className="top-search-bar">
      <button type="button" className="top-search-bar-brand" onClick={() => navigate('/')}>
        <img className="top-search-bar-logo" src={logoIcon} alt="" />
        <span className="top-search-bar-brand-name">Project Club</span>
      </button>

      <form className="top-search-bar-form" onSubmit={submitSearch}>
        <div className="top-search-bar-input-wrap">
          <span className="top-search-bar-input-icon top-search-bar-icon-mask" style={{ WebkitMaskImage: `url(${searchIcon})`, maskImage: `url(${searchIcon})` }} />
          <input
            className="top-search-bar-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar em Project Club"
          />
        </div>
      </form>

      <div className="top-search-bar-actions">
        <button type="button" className="top-search-bar-icon-btn" title="Criar post" onClick={() => navigate('/comunidades')}>
          <span className="top-search-bar-icon-mask" style={{ WebkitMaskImage: `url(${createPostIcon})`, maskImage: `url(${createPostIcon})`, width: 18, height: 18 }} />
        </button>
        <button type="button" className="top-search-bar-icon-btn" title="Notificações" onClick={() => navigate('/notifications')}>
          <span className="top-search-bar-icon-mask top-search-bar-notif-icon" style={{ WebkitMaskImage: `url(${notificationsIcon})`, maskImage: `url(${notificationsIcon})` }} />
          {notifBadge > 0 && <span className="top-search-bar-badge">{notifBadge > 99 ? '99+' : notifBadge}</span>}
        </button>
        <button type="button" className="top-search-bar-avatar" onClick={() => navigate('/profile')}>
          <UserAvatar user={user} size={30} />
        </button>
      </div>
    </div>
  );
}
