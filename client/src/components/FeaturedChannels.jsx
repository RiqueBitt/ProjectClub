import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { isFeatureEnabled } from '../utils/features';
import { useContextMenu } from '../context/ContextMenuContext.jsx';
import { updateFeaturedChannels } from '../api/endpoints';
import { useCommunityEvents } from '../utils/useCommunityEvents';
import { useSectionBadges, sectionCount, badgeLabel } from '../utils/sectionBadges';
import '../styles/channels.css';
import '../styles/socialx.css';

// Canais em destaque, fixos no topo da lista de canais da comunidade:
// Guerra das Cartas e Economia (pedido do dono, out/2026). Parecem canais
// — mesma altura e alinhamento — mas com um fundo de cor suave e ícone
// próprio. A staff pode esconder cada um (Configurações da comunidade, ou
// clique direito aqui). Anúncios e Eventos virou "Novidades" e foi pro
// menu principal (MainSidebar.jsx); o Fórum já está lá também.

const PATHS = {
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12',
  calendar: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 12h3v3H8z',
  feed: 'M4 5h16v14H4zM8 9h8M8 13h8M8 17h4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01',
  // Fórum: dois balões de conversa
  forum: 'M3 5h12v9H8l-4 3v-3H3zM18 9h3v9h-1v3l-4-3h-5v-2',
  // Loja: sacola
  store: 'M5 8h14l-1 12H6L5 8zM9 8V6a3 3 0 0 1 6 0v2M9 12h.01M15 12h.01',
  // Economia: moeda com estrela
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.6l1.3 2.65 2.9.42-2.1 2.05.5 2.9L12 14.25l-2.6 1.37.5-2.9-2.1-2.05 2.9-.42z',
  // Guerra das Cartas: duas cartas em leque
  cards: 'M8 4h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM4 7.5 6 7M4 7.5v10.2a2 2 0 0 0 1.6 2L6 20M12.5 9l1.3 2.6 2.7.4-2 1.9.5 2.7-2.5-1.3-2.5 1.3.5-2.7-2-1.9 2.7-.4z',
};

export function FeaturedGlyph({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Guerra das Cartas em primeiro, Economia logo abaixo (pedido).
export const FEATURED = [
  {
    key: 'arena', label: 'Guerra das Cartas', icon: 'cards', to: '/cartas',
    hint: 'Jogo de cartas: colecione, monte seu baralho e batalhe', match: (p) => p.startsWith('/cartas'), tag: 'Jogar',
    feature: 'cardsWar', // interruptor em utils/features.js
  },
  // Economia: mesma área da Loja (abas Visão geral · Missões · Loja · Passe
  // · Histórico — ver components/HubTabs.jsx). Chave 'loja' mantida: é a
  // que a visibilidade salva por comunidade e o CSS (.featured-loja) usam.
  {
    key: 'loja', label: 'Economia', icon: 'coin', to: '/economia',
    hint: 'Moedas, gemas, missões, Loja e Passe do clube',
    match: (p) => p.startsWith('/economia') || p.startsWith('/missoes') || p.startsWith('/loja'),
  },
].filter((f) => !f.feature || isFeatureEnabled(f.feature));

// Visibilidade salva por comunidade (padrão: todos visíveis).
export function useFeaturedVisibility() {
  const featured = useStore((s) => s.community?.featuredChannels);
  return (key) => featured?.[key] !== false;
}

export default function FeaturedChannels({ canManage }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { openMenu } = useContextMenu();
  const isVisible = useFeaturedVisibility();
  const { events } = useCommunityEvents();
  const sectionBadges = useSectionBadges();
  const disabledSystems = useStore((st) => st.disabledSystems) || [];
  const items = FEATURED.filter((f) => isVisible(f.key) && !(f.key === 'arena' && disabledSystems.includes('cartas') && !canManage));
  if (items.length === 0) return null;

  const live = (events || []).filter((e) => e.status === 'ACTIVE').length;
  const upcoming = (events || []).filter((e) => e.status === 'UPCOMING').length;

  const go = (item) => {
    if (location.pathname !== item.to) navigate(item.to);
    useStore.getState().closeMobileChannelList?.();
  };

  const hide = async (key) => {
    try {
      const { featuredChannels } = await updateFeaturedChannels({ [key]: false });
      const st = useStore.getState();
      st.setCommunityStructure({ community: { ...st.community, featuredChannels } });
    } catch (err) { alert(err.response?.data?.error || 'Não foi possível esconder.'); }
  };

  const onContextMenu = (e, item) => {
    if (!canManage) return;
    e.preventDefault();
    openMenu(e, [
      { label: `Esconder "${item.label}" da lista`, icon: '—', onClick: () => hide(item.key) },
    ]);
  };

  const renderItem = (item) => {
    const active = item.match(location.pathname);
    let badge = null;
    // Bolinha vermelha "novo": anúncio/evento/coleção que saiu depois da
    // última vez que a pessoa abriu a seção (some ao abrir).
    const newKeys = item.merges || [{ loja: 'colecoes' }[item.key] || item.key];
    const fresh = active ? 0 : newKeys.reduce((n, k) => n + sectionCount(sectionBadges, k), 0);
    const what = { anuncios: ['novidade', 'novidades'], loja: ['coleção nova na Loja', 'coleções novas na Loja'] }[item.key] || ['novidade', 'novidades'];
    const newBadge = fresh > 0 ? <span className="section-new-badge" title={`${fresh} ${fresh === 1 ? what[0] : what[1]}`} aria-label={`${fresh} ${fresh === 1 ? what[0] : what[1]}`}>{badgeLabel(fresh)}</span> : null;
    const hasEvents = (item.merges || []).includes('eventos');
    // Novidade não vista primeiro (some ao abrir); depois "Ao vivo"; depois
    // a contagem de eventos em breve.
    if (newBadge) badge = newBadge;
    else if (hasEvents && live > 0) badge = <span className="featured-channel-live" title={`${live} evento${live === 1 ? '' : 's'} acontecendo agora`}>Ao vivo</span>;
    else if (hasEvents && upcoming > 0) badge = <span className="featured-channel-count" title={`${upcoming} evento${upcoming === 1 ? '' : 's'} em breve`}>{upcoming}</span>;
    else if (item.soon) badge = <span className="featured-channel-soon">Em breve</span>;
    else if (item.tag && !active) badge = <span className="featured-channel-tag">{item.tag}</span>;
    return (
      <button
        key={item.key} type="button"
        className={`sidebar-item featured-channel featured-${item.key}${active ? ' active' : ''}`}
        onClick={() => go(item)} onContextMenu={(e) => onContextMenu(e, item)}
        title={item.hint} aria-current={active ? 'page' : undefined}
      >
        <span className="featured-channel-icon"><FeaturedGlyph name={item.icon} /></span>
        <span className="featured-channel-name truncate">{item.label}</span>
        {badge}
      </button>
    );
  };
  return (
    <div className="featured-channels" role="group" aria-label="Canais em destaque">
      {items.map(renderItem)}
    </div>
  );
}
