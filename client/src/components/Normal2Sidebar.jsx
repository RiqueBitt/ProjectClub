import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import ChannelSidebar from './ChannelSidebar.jsx';
import DonationGoalBar from './DonationGoalBar.jsx';
import { ITEMS, visibleNavItems } from './MainSidebar.jsx';
import { FEATURED, useFeaturedVisibility } from './FeaturedChannels.jsx';
import { useNavBadges } from '../utils/navBadges';

// Layout "Normal 2.0": uma coluna só à esquerda, no estilo Discord —
// banner da comunidade no topo e os canais embaixo. A lista de canais é o
// MESMO ChannelSidebar dos outros layouts (permissões, arrastar, menus de
// contexto, salas de voz), só embutido aqui.
//
// Menu principal (nov/2026, pedido do dono): a fileira de ícones que ficava
// acima dos canais SAIU — os destinos dela viraram canais em destaque
// (FeaturedChannels.jsx: Início, Amigos, Novidades, Economia, Progresso, Club
// Penguin), no mesmo visual de Novidades, logo abaixo do banner. Suporte foi
// pra barra superior (TopSearchBar.jsx). O componente N2Nav continua aqui,
// desligado (SHOW_N2_MENU) — é só religar se a fileira voltar.
// Usa a classe .main-sidebar, então no celular vira a mesma gaveta
// lateral dos outros layouts, sem regra nova de toque/abrir/fechar.
// O Navegador fica só no globo da barra de título (app de Windows/Linux).
const SHOW_N2_MENU = false;
const N2_ITEMS = ITEMS.filter((i) => i.to !== '/' && i.to !== '/navegador');

// Bolinhas por destino — ver utils/navBadges.js (também usado pelos destaques).
export const useBadges = useNavBadges;

function N2Nav() {
  const { t } = useTranslation();
  const location = useLocation();
  const { user } = useAuth();
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
  // Destino que já é um canal em destaque visível não repete no menu.
  const isFeaturedVisible = useFeaturedVisibility();
  const disabledSystems = useStore((s) => s.disabledSystems);
  const shownItems = visibleNavItems(N2_ITEMS, disabledSystems, user);
  const featuredTo = new Set(FEATURED.filter((f) => isFeaturedVisible(f.key)).map((f) => f.to));
  const items = shownItems.filter((i) => !featuredTo.has(i.to)); // Painel: botão na barra superior (TopSearchBar.jsx)

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
      </div>
      <nav className="n2-nav-list" aria-label="Menu principal">
        {items.map((item) => {
          const active = item.match(location.pathname);
          const badge = badgeFor(item.to);
          const label = t(item.labelKey, item.label);
          return (
            <NavLink
              key={item.to} to={item.to} aria-label={compact ? label : undefined} data-tip={compact ? label : undefined}
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
      <ChannelSidebar activeChannelId={activeChannelId} embedded sentenceCase topSlot={<><DonationGoalBar />{SHOW_N2_MENU && <N2Nav />}</>} />
    </aside>
  );
}
