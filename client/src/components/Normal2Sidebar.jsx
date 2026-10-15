import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore, isChannelUnread, isConversationUnread, useMyRoleIds } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import ChannelSidebar from './ChannelSidebar.jsx';
import { ITEMS, STAFF_ITEM, visibleNavItems } from './MainSidebar.jsx';
import { useFeaturedVisibility } from './FeaturedChannels.jsx';
import { useClaimableMissions } from '../utils/missionBadge';
import { isFeatureEnabled } from '../utils/features';

// Layout "Normal 2.0": uma coluna só à esquerda, no estilo Discord —
// banner da comunidade no topo, o menu principal em botões logo abaixo
// e os canais/categorias embaixo. A lista de canais é o MESMO
// ChannelSidebar dos outros layouts (permissões, arrastar, menus de
// contexto, salas de voz), só embutido aqui.
//
// O item "Comunidade" sai do menu: os canais já estão sempre à vista.
// Usa a classe .main-sidebar, então no celular vira a mesma gaveta
// lateral dos outros layouts, sem regra nova de toque/abrir/fechar.
// O Navegador vira o botão de globo ao lado da setinha (não ocupa lugar na fileira).
const N2_ITEMS = ITEMS.filter((i) => i.to !== '/' && i.to !== '/navegador');

export function useBadges(user) {
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
  const claimableMissions = useClaimableMissions(); // missões prontas pra resgatar
  return (to) => {
    if (to === '/economia') return claimableMissions;
    if (to === '/dms') return unreadConversations + pendingIncoming;
    if (to === '/notifications') return unreadChannels + unreadConversations + pendingIncoming;
    return 0;
  };
}

function N2Nav() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const browserOn = isFeatureEnabled('browser');
  const inBrowser = location.pathname.startsWith('/navegador');
  // Menu compacto (só ícones, numa fileira) — preferência deste navegador.
  const [compact, setCompact] = useState(() => {
    // Padrão agora é a fileira de ícones (pedido do dono); '0' = com nomes.
    try { return localStorage.getItem('n2NavCompact') !== '0'; } catch { return true; }
  });
  const toggle = () => setCompact((v) => {
    try { localStorage.setItem('n2NavCompact', v ? '0' : '1'); } catch { /* sem localStorage */ }
    return !v;
  });
  const badgeFor = useBadges(user);
  const isStaff = user?.platformRole === 'ADMIN' || user?.platformRole === 'MODERATOR';
  // O Feed agora é um canal em destaque no topo da lista de canais; o
  // botão do menu só volta se a staff esconder esse canal.
  const isFeaturedVisible = useFeaturedVisibility();
  const disabledSystems = useStore((s) => s.disabledSystems);
  const shownItems = visibleNavItems(N2_ITEMS, disabledSystems, user);
  const baseItems = isFeaturedVisible('feed') ? shownItems.filter((i) => i.to !== '/comunidades') : shownItems;
  const items = isStaff ? [...baseItems, STAFF_ITEM] : baseItems;

  return (
    <div className={`n2-nav${compact ? ' is-compact' : ''}`}>
      <div className="n2-nav-tools">
        <button
          type="button" className="n2-nav-toggle" onClick={toggle}
          aria-label={compact ? 'Mostrar nomes do menu' : 'Menu compacto'} title={compact ? 'Mostrar nomes do menu' : 'Menu compacto'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path d={compact ? 'm6 9 6 6 6-6' : 'm18 15-6-6-6 6'} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {/* Globo: abre o Navegador do Project Club (internet dentro do app). */}
        {browserOn && (
          <button
            type="button" className={`n2-nav-web${inBrowser ? ' active' : ''}`}
            onClick={() => { useStore.getState().closeMobileChannelList?.(); navigate('/navegador'); }}
            aria-label="Internet: abrir o navegador" title="Internet"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
              <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.6 2.6 3.8 5.7 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.7-3.8-9S9.4 5.6 12 3z" />
              </g>
            </svg>
            <span>Internet</span>
          </button>
        )}
      </div>
      <nav className="n2-nav-list" aria-label="Menu principal">
        {items.map((item) => {
          const active = item.match(location.pathname);
          const badge = badgeFor(item.to);
          const label = t(item.labelKey, item.label);
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
