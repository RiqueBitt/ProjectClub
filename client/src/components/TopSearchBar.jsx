import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, isChannelUnread, isConversationUnread, useMyRoleIds } from '../store/useStore';
import gameActivityIcon from '../assets/icons/activity-game.png';
import spotifyActivityIcon from '../assets/icons/activity-spotify.png';
import appActivityIcon from '../assets/icons/activity-app.png';

const ACTIVITY_ICON_BY_TYPE = { game: gameActivityIcon, spotify: spotifyActivityIcon, app: appActivityIcon };
import { useAuth } from '../context/AuthContext.jsx';
import { setStatus as setStatusApi } from '../api/endpoints';
import { STATUS_LABEL, STATUS_COLOR } from '../utils/status';
import PresenceDot from './PresenceDot.jsx';
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
  const myRoleIds = useMyRoleIds(user?.id);
  const [q, setQ] = useState('');
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const conversations = useStore((s) => s.conversations);
  const friends = useStore((s) => s.friends);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  usePopoverCoordination(statusMenuOpen, () => setStatusMenuOpen(false));
  const [customStatusOpen, setCustomStatusOpen] = useState(false);
  const myActivity = useStore((s) => s.activities[user?.id]);

  const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
  const unreadChannels = allChannels.filter((ch) => isChannelUnread(ch, channelReadAt, user.id, myRoleIds)).length;
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
            {/* Item pedido: ícone verde de "jogando/ouvindo" bem onde
                fica o indicador de status — 🎮 jogo, 🎵 Spotify. Só
                aparece quando o app de desktop detectou alguma coisa
                (myActivity vem undefined caso contrário). */}
            {myActivity && (
              <span className="top-search-bar-activity-dot" title={{ game: 'Jogando ', spotify: 'Ouvindo ', app: 'Usando ' }[myActivity.type] + myActivity.name}>
                <img src={ACTIVITY_ICON_BY_TYPE[myActivity.type]} alt="" className="top-search-bar-activity-icon-img" />
              </span>
            )}
            {/* Item pedido: a bolinha verde (status online) saiu daqui —
                agora que tem o ícone de atividade no mesmo canto, os
                dois competiam visualmente. Continua clicável pra abrir
                o menu de "mudar status", só sem o círculo colorido
                sempre visível — aparece suavemente só ao passar o
                mouse em cima do avatar (ver .top-search-bar-status-
                trigger no CSS). */}
            <button
              type="button"
              className="top-search-bar-status-trigger"
              style={{ '--status-trigger-color': STATUS_COLOR[status] }}
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
                  <span className="dim">
                    {/* Item pedido: ícone compacto de "jogando"/"ouvindo"
                        bem aqui, perto do status — 🎮 pra jogo, 🎵 pra
                        Spotify, só um ícone rápido antes do texto do
                        status em si (não é o card grande do perfil, é
                        um resuminho). */}
                    {myActivity && (
                      <span className="top-search-bar-activity-icon" title={{ game: 'Jogando ', spotify: 'Ouvindo ', app: 'Usando ' }[myActivity.type] + myActivity.name}>
                        <img src={ACTIVITY_ICON_BY_TYPE[myActivity.type]} alt="" className="top-search-bar-activity-icon-img" />
                      </span>
                    )}
                    <StatusEmoji emoji={user.customStatusEmoji} /> {user.customStatus || STATUS_LABEL[status]}
                  </span>
                </div>
              </div>
              <div className="dropdown-divider" />
              <button onClick={() => { setCustomStatusOpen(true); setStatusMenuOpen(false); }}>
                <img className="ui-icon-sm" src={chatIcon} alt="" /> Definir status personalizado
              </button>
              <div className="dropdown-divider" />
              {Object.keys(STATUS_LABEL).map((s) => (
                <button key={s} onClick={() => changeStatus(s)}>
                  <PresenceDot status={s} /> {STATUS_LABEL[s]}
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
