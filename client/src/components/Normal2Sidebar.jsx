import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore, isChannelUnread, isConversationUnread, useMyRoleIds } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import ChannelSidebar from './ChannelSidebar.jsx';
import { ITEMS, STAFF_ITEM } from './MainSidebar.jsx';

// Layout "Normal 2.0": uma coluna só à esquerda, no estilo Discord —
// banner da comunidade no topo, o menu principal em botões logo abaixo
// e os canais/categorias embaixo. A lista de canais é o MESMO
// ChannelSidebar dos outros layouts (permissões, arrastar, menus de
// contexto, salas de voz), só embutido aqui.
//
// O item "Comunidade" sai do menu: os canais já estão sempre à vista.
// Usa a classe .main-sidebar, então no celular vira a mesma gaveta
// lateral dos outros layouts, sem regra nova de toque/abrir/fechar.
const N2_ITEMS = ITEMS.filter((i) => i.to !== '/');

function useBadges(user) {
  const myRoleIds = useMyRoleIds(user.id);
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const conversations = useStore((s) => s.conversations);
  const friends = useStore((s) => s.friends);
  const unreadConversations = conversations.filter((c) => isConversationUnread(c, user.id)).length;
  const pendingIncoming = friends.filter((f) => f.status === 'PENDING' && f.isIncoming).length;
  const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
  const unreadChannels = allChannels.filter((ch) => isChannelUnread(ch, channelReadAt, user.id, myRoleIds)).length;
  return (to) => {
    if (to === '/dms') return unreadConversations + pendingIncoming;
    if (to === '/notifications') return unreadChannels + unreadConversations + pendingIncoming;
    return 0;
  };
}

function N2Nav() {
  const { t } = useTranslation();
  const location = useLocation();
  const { user } = useAuth();
  // Menu compacto (só ícones, numa fileira) — preferência deste navegador.
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem('n2NavCompact') === '1'; } catch { return false; }
  });
  const toggle = () => setCompact((v) => {
    try { localStorage.setItem('n2NavCompact', v ? '0' : '1'); } catch { /* sem localStorage */ }
    return !v;
  });
  const badgeFor = useBadges(user);
  const isStaff = user?.platformRole === 'ADMIN' || user?.platformRole === 'MODERATOR';
  const items = isStaff ? [...N2_ITEMS, STAFF_ITEM] : N2_ITEMS;

  return (
    <div className={`n2-nav${compact ? ' is-compact' : ''}`}>
      <button
        type="button" className="n2-nav-toggle" onClick={toggle}
        aria-label={compact ? 'Mostrar nomes do menu' : 'Menu compacto'} title={compact ? 'Mostrar nomes do menu' : 'Menu compacto'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path d={compact ? 'm6 9 6 6 6-6' : 'm18 15-6-6-6 6'} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <nav className="n2-nav-list" aria-label="Menu principal">
        {items.map((item) => {
          const active = item.match(location.pathname);
          const badge = badgeFor(item.to);
          const label = t(item.labelKey);
          return (
            <NavLink
              key={item.to} to={item.to} title={compact ? label : undefined}
              className={`n2-nav-item${active ? ' active' : ''}`}
              onClick={() => useStore.getState().closeMobileChannelList()}
            >
              <span className="n2-nav-icon" style={{ WebkitMaskImage: `url(${item.icon})`, maskImage: `url(${item.icon})` }} aria-hidden="true" />
              <span className="n2-nav-label">{label}</span>
              {badge > 0 && <span className="n2-nav-badge">{badge > 99 ? '99+' : badge}</span>}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

export default function Normal2Sidebar({ activeChannelId }) {
  return (
    <aside className="main-sidebar n2-sidebar">
      <ChannelSidebar activeChannelId={activeChannelId} embedded sentenceCase topSlot={<N2Nav />} />
    </aside>
  );
}
