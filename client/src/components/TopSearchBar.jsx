import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, isChannelUnread, isConversationUnread } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { setStatus as setStatusApi } from '../api/endpoints';
import { STATUS_LABEL, STATUS_COLOR } from '../utils/status';
import { usePopoverCoordination } from '../utils/popoverCoordinator';
import UserAvatar from './UserAvatar.jsx';
import StatusEmoji from './StatusEmoji.jsx';
import CustomStatusModal from './modals/CustomStatusModal.jsx';
import logoIcon from '../assets/icons/logo-project-club.png';
import searchIcon from '../assets/icons/nav-search.png';
import notificationsIcon from '../assets/icons/nav-notifications.png';
import createPostIcon from '../assets/icons/nav-create-post.png';
import settingsIcon from '../assets/icons/settings.png';
import chatIcon from '../assets/icons/chat.png';

// Barra de topo estilo Reddit — logo + busca + criar post + notificações +
// engrenagem de Configurações (item pedido) + perfil/status (item pedido:
// movido pra cá, saiu do rodapé da barra lateral — ver MainSidebar.jsx).
export default function TopSearchBar() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const [q, setQ] = useState('');
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const conversations = useStore((s) => s.conversations);
  const friends = useStore((s) => s.friends);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  usePopoverCoordination(statusMenuOpen, () => setStatusMenuOpen(false));
  const [customStatusOpen, setCustomStatusOpen] = useState(false);

  const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
  const unreadChannels = allChannels.filter((ch) => isChannelUnread(ch, channelReadAt, user.id)).length;
  const unreadConversations = conversations.filter((c) => isConversationUnread(c, user.id)).length;
  const pendingIncoming = friends.filter((f) => f.status === 'PENDING' && f.isIncoming).length;
  const notifBadge = unreadChannels + unreadConversations + pendingIncoming;

  const presence = useStore((s) => (user ? s.presence[user.id] : null));
  const status = presence?.status || user?.status || 'ONLINE';

  const changeStatus = async (newStatus) => {
    const { user: updated } = await setStatusApi(newStatus);
    setUser(updated);
    setStatusMenuOpen(false);
  };

  const submitSearch = (e) => {
    e.preventDefault();
    navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search');
  };

  return (
    <div className="top-search-bar">
      {/* Item pedido: menu principal virando gaveta de verdade no
          celular — esse botão só aparece em telas estreitas (≤600px,
          ver .mobile-nav-toggle no CSS) e abre/fecha a barra de
          navegação como uma gaveta lateral, em vez dela ficar sempre
          ocupando espaço fixo na tela. */}
      <button type="button" className="mobile-nav-toggle" onClick={() => useStore.getState().toggleMobileSidebar()} aria-label="Abrir menu">
        ☰
      </button>
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
        {/* Item pedido: engrenagem de Configurações, do lado do sino de
            notificações, no cabeçalho. */}
        <button type="button" className="top-search-bar-icon-btn" title="Configurações" onClick={() => useStore.getState().openSettings()}>
          <span className="top-search-bar-icon-mask" style={{ WebkitMaskImage: `url(${settingsIcon})`, maskImage: `url(${settingsIcon})`, width: 18, height: 18 }} />
        </button>

        {/* Item pedido: acesso ao Perfil (e status) saiu do rodapé da
            barra lateral e agora mora aqui no cabeçalho — clicar no
            avatar abre o perfil completo; clicar no pontinho de status
            abre o menu rápido de status, igual já funcionava antes. */}
        <div className="top-search-bar-profile">
          <button type="button" className="top-search-bar-avatar" onClick={() => useStore.getState().openProfile(user.id)} title={user.displayName}>
            <UserAvatar user={user} size={30} />
            <button
              type="button"
              className="status-dot clickable top-search-bar-status-dot"
              style={{ background: STATUS_COLOR[status] }}
              title="Mudar status online"
              onClick={(e) => { e.stopPropagation(); setStatusMenuOpen((v) => !v); }}
            />
          </button>
          {statusMenuOpen && (
            <div className="status-menu top-search-bar-status-menu" onClick={(e) => e.stopPropagation()}>
              <div className="top-search-bar-status-menu-header">
                <UserAvatar user={user} size={28} />
                <div className="top-search-bar-status-menu-name">
                  <span>{user.displayName}</span>
                  <span className="dim"><StatusEmoji emoji={user.customStatusEmoji} /> {user.customStatus || STATUS_LABEL[status]}</span>
                </div>
              </div>
              <div className="dropdown-divider" />
              <button onClick={() => { setCustomStatusOpen(true); setStatusMenuOpen(false); }}>
                <img className="ui-icon-sm" src={chatIcon} alt="" /> Definir status personalizado
              </button>
              <div className="dropdown-divider" />
              {Object.keys(STATUS_LABEL).map((s) => (
                <button key={s} onClick={() => changeStatus(s)}>
                  <span className="status-dot" style={{ background: STATUS_COLOR[s] }} /> {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {customStatusOpen && (
        <CustomStatusModal user={user} onClose={() => setCustomStatusOpen(false)} onSaved={setUser} />
      )}
    </div>
  );
}
