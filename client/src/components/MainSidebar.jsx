import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useStore, isChannelUnread, isConversationUnread } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { setStatus as setStatusApi } from '../api/endpoints';
import UserAvatar from './UserAvatar.jsx';
import StatusEmoji from './StatusEmoji.jsx';
import CustomStatusModal from './modals/CustomStatusModal.jsx';
import { usePopoverCoordination } from '../utils/popoverCoordinator';
import chatIcon from '../assets/icons/chat.png';
import topicIcon from '../assets/icons/nav-topic.png';
import feedIcon from '../assets/icons/nav-feed.png';
import friendsIcon from '../assets/icons/nav-profile.png';
import profileIcon from '../assets/icons/nav-profile-icon.png';
import notificationsIcon from '../assets/icons/nav-notifications.png';
import ranksIcon from '../assets/icons/nav-ranks.png';
import supportIcon from '../assets/icons/nav-support.png';
import dashboardIcon from '../assets/icons/nav-dashboard.png';
import achievementsIcon from '../assets/icons/nav-achievements.png';
import updatesIcon from '../assets/icons/nav-updates.png';
import { STATUS_LABEL, STATUS_COLOR } from '../utils/status';

// Barra lateral principal única do app. A marca/logo agora mora na
// TopSearchBar.jsx (barra de topo estilo Reddit) — esta barra só tem a
// navegação + a lista de comunidades (igual .homesidebar do clone do
// Reddit: nav de cima, depois "COMUNIDADES" com as que você participa),
// e o perfil fixo no rodapé. Ícones novos (pasta Icons_Novos.zip do
// usuário) substituem os emojis antigos — "nav-profile.png" (o ícone
// "User Account" do pacote) vai em Amigos, não em Perfil; Perfil fica
// com o emoji padrão já que não veio um ícone específico pra ele.
const ITEMS = [
  { to: '/', icon: topicIcon, isImg: true, label: 'Comunidade', match: (p) => p === '/' || p.startsWith('/channels/') },
  { to: '/dms', icon: friendsIcon, isImg: true, label: 'Amigos', match: (p) => p === '/dms' || p.startsWith('/conversations/') },
  { to: '/comunidades', icon: feedIcon, isImg: true, label: 'Feeds', match: (p) => p === '/comunidades' || p.startsWith('/posts/') },
  { to: '/profile', icon: profileIcon, isImg: true, label: 'Perfil', match: (p) => p.startsWith('/profile') },
  { to: '/notifications', icon: notificationsIcon, isImg: true, label: 'Notificações', match: (p) => p.startsWith('/notifications') },
  { to: '/rank', icon: ranksIcon, isImg: true, label: 'Ranks', match: (p) => p.startsWith('/rank') },
  { to: '/conquistas', icon: achievementsIcon, isImg: true, label: 'Conquistas', match: (p) => p.startsWith('/conquistas') },
  { to: '/atualizacoes', icon: updatesIcon, isImg: true, label: 'Atualizações', match: (p) => p.startsWith('/atualizacoes') },
  { to: '/tickets', icon: supportIcon, isImg: true, label: 'Suporte', match: (p) => p.startsWith('/tickets') },
];
// BUG CORRIGIDO: o painel de staff (/admin) ficou órfão depois da troca
// pra essa barra lateral única — os componentes antigos que linkavam pra
// lá (ChannelSidebar.jsx, TopMenu.jsx) não são mais renderizados em
// lugar nenhum, então quem é staff não tinha mais nenhum jeito de chegar
// no painel a não ser digitando a URL /admin na mão. Item separado (não
// dentro de ITEMS) porque só aparece pra ADMIN/MODERATOR — ver o filtro
// no componente abaixo.
const STAFF_ITEM = { to: '/admin', icon: dashboardIcon, isImg: true, label: 'Painel', match: (p) => p.startsWith('/admin') };


export default function MainSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const conversations = useStore((s) => s.conversations);
  const friends = useStore((s) => s.friends);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  usePopoverCoordination(statusMenuOpen, () => setStatusMenuOpen(false));
  const [customStatusOpen, setCustomStatusOpen] = useState(false);

  // Lista de Clubes — igual a seção "COMUNIDADES" da HomeSideBar do
  // clone do Reddit (subredditList: cada uma com ícone + nome), só que
  // agora vem do estado global (useStore) em vez de um fetch próprio —
  // é a mesma lista que a página de Feeds usa, e as duas atualizam
  // sozinhas em tempo real via socket quando a staff cria/edita/exclui
  // um Clube (ver SocketContext.jsx). Clubes não têm mais conceito de
  // "entrar" — são categorias oficiais, mostradas pra todo mundo.
  const clubs = useStore((s) => s.clubs);
  const sortedClubs = [...clubs].sort((a, b) => a.name.localeCompare(b.name));

  // Badges simples por item — não são um sistema de notificações à parte,
  // só reaproveitam o que o store já sabe (menções não lidas / conversas
  // não lidas / pedidos de amizade pendentes) pra dar um sinal visual
  // rápido em cada ícone, igual o sininho de "Notificações" já mostra
  // em detalhe.
  const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
  const unreadChannels = allChannels.filter((ch) => isChannelUnread(ch, channelReadAt, user.id)).length;
  const unreadConversations = conversations.filter((c) => isConversationUnread(c, user.id)).length;
  const pendingIncoming = friends.filter((f) => f.status === 'PENDING' && f.isIncoming).length;

  // Presença do próprio usuário — mesma fonte que o resto do app já usa
  // pra badges de presença, aqui alimentando o pontinho de status do
  // perfil no rodapé da barra.
  const presence = useStore((s) => (user ? s.presence[user.id] : null));
  const status = presence?.status || user?.status || 'ONLINE';

  const badgeFor = (to) => {
    if (to === '/') return unreadChannels;
    if (to === '/dms') return unreadConversations + pendingIncoming;
    if (to === '/notifications') return unreadChannels + unreadConversations + pendingIncoming;
    return 0;
  };

  const isStaff = user?.platformRole === 'ADMIN' || user?.platformRole === 'MODERATOR';
  const navItems = isStaff ? [...ITEMS, STAFF_ITEM] : ITEMS;

  const changeStatus = async (newStatus) => {
    const { user: updated } = await setStatusApi(newStatus);
    setUser(updated);
    setStatusMenuOpen(false);
  };

  return (
    <aside className="main-sidebar">
      <div className="main-sidebar-scroll">
        <nav className="main-sidebar-nav">
          {navItems.map((item) => {
            const active = item.match(location.pathname);
            const badge = badgeFor(item.to);
            return (
              <NavLink key={item.to} to={item.to} className={`main-sidebar-item ${active ? 'active' : ''}`}>
                <span className="main-sidebar-item-icon">
                  {item.isImg
                    ? <span className="main-sidebar-item-icon-img" style={{ WebkitMaskImage: `url(${item.icon})`, maskImage: `url(${item.icon})` }} />
                    : item.icon}
                  {badge > 0 && <span className="main-sidebar-item-badge">{badge > 99 ? '99+' : badge}</span>}
                </span>
                <span className="main-sidebar-item-label">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="main-sidebar-section">
          <div className="main-sidebar-section-label">Clubes</div>
          <div className="main-sidebar-community-list">
            {sortedClubs.map((c) => (
              <button
                key={c.id}
                className={`main-sidebar-community-item ${location.pathname === `/comunidades/${c.slug}` ? 'active' : ''}`}
                onClick={() => navigate(`/comunidades/${c.slug}`)}
                title={c.name}
              >
                <span className="main-sidebar-community-icon">{c.iconUrl ? <img src={c.iconUrl} alt="" /> : '📌'}</span>
                <span className="main-sidebar-community-name truncate">{c.name}</span>
              </button>
            ))}
            {sortedClubs.length === 0 && (
              <div className="dim main-sidebar-community-empty">Nenhum Clube criado ainda.</div>
            )}
            {isStaff && (
              <button className="main-sidebar-community-item main-sidebar-community-create" onClick={() => navigate('/comunidades')}>
                <span className="main-sidebar-community-icon">➕</span>
                <span className="main-sidebar-community-name">Criar Clube</span>
              </button>
            )}          </div>
        </div>
      </div>

      {/* Perfil do usuário — fixo no rodapé da barra, fora da área que rola
          junto com os itens de navegação acima. É o ÚNICO perfil do app
          agora (o antigo UserPanel.jsx, que ficava embaixo do campo de
          digitação do chat, foi removido) — por isso reúne aqui banner,
          avatar, nome e status, tudo compacto pra não empurrar a largura
          da barra. Clicar no banner/nome abre o perfil completo; clicar no
          pontinho de status abre o menu rápido de status (mesmo menu que o
          antigo UserPanel tinha). */}
      <div className="main-sidebar-footer">
        <div className="main-sidebar-profile">
          <div
            className="main-sidebar-profile-banner"
            style={{ background: user.bannerUrl ? `url(${user.bannerUrl}) center/cover` : (user.profileColor || 'rgba(255,255,255,0.16)') }}
          />
          {/* BUG CORRIGIDO: o pontinho de status era um <span> clicável
              DENTRO de um <button> maior (o que abre o perfil) — aninhar
              um elemento interativo dentro de um <button> é inválido em
              HTML, e com o pontinho tendo só 11px, era fácil o clique
              "vazar" pro botão de baixo e abrir o perfil em vez do menu
              de status. Trocado o <button> externo por uma <div
              role="button"> (continua clicável e acessível por teclado,
              só não é mais um <button> nativo) — um <span> clicável
              dentro de uma <div> é perfeitamente válido, então o clique
              no pontinho nunca mais tem ambiguidade sobre qual dos dois
              deveria disparar. Todo o CSS de posição continua o mesmo
              (nada mudou visualmente, só a tag e a semântica). */}
          <div
            role="button"
            tabIndex={0}
            className="main-sidebar-profile-main"
            title={user.displayName}
            onClick={() => useStore.getState().openProfile(user.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); useStore.getState().openProfile(user.id); } }}
          >
            <span className="main-sidebar-profile-avatar">
              <UserAvatar user={user} size={34} />
              <button
                type="button"
                className="status-dot clickable"
                style={{ background: STATUS_COLOR[status] }}
                title="Mudar status online"
                onClick={(e) => { e.stopPropagation(); setStatusMenuOpen((v) => !v); }}
              />
            </span>
            <span className="main-sidebar-profile-text">
              <span className="main-sidebar-profile-name">{user.displayName}</span>
              <span className="main-sidebar-profile-status">
                <StatusEmoji emoji={user.customStatusEmoji} /> {user.customStatus || STATUS_LABEL[status]}
              </span>
            </span>
          </div>

          {statusMenuOpen && (
            <div className="status-menu main-sidebar-status-menu" onClick={(e) => e.stopPropagation()}>
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
        {customStatusOpen && (
          <CustomStatusModal user={user} onClose={() => setCustomStatusOpen(false)} onSaved={setUser} />
        )}
      </div>
    </aside>
  );
}
