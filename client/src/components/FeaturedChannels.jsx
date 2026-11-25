import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { isFeatureEnabled } from '../utils/features';
import { useContextMenu } from '../context/ContextMenuContext.jsx';
import { updateFeaturedChannels } from '../api/endpoints';
import { isDmPath } from '../utils/prettyLinks';
import { useCommunityEvents } from '../utils/useCommunityEvents';
import { useSectionBadges, sectionCount, badgeLabel } from '../utils/sectionBadges';
import { useAuth } from '../context/AuthContext.jsx';
import { useBadges } from '../utils/navBadges';
import '../styles/channels.css';
import '../styles/socialx.css';

// Canais em destaque, fixos no topo da lista de canais da comunidade:
// Novidades e Economia (pedido do dono, nov/2026) — e a Guerra das Cartas,
// que só aparece com o jogo ligado (utils/features.js → cardsWar). Parecem
// canais — mesma altura e alinhamento — mas com um fundo de cor suave e
// ícone próprio. A staff pode esconder cada um (Configurações da
// comunidade, ou clique direito aqui).
//
// Layout "Normal 2.0" (nov/2026, pedido do dono): o menu de botões que
// ficava acima dos canais (Normal2Sidebar.jsx) virou canais em destaque —
// Início, Amigos (antes "Social") e Progresso (Suporte foi pra barra do
// topo). Esses são
// `n2Only` (nos outros layouts eles já estão na barra de ícones, então não
// duplicam) e `fixed` (a staff não esconde: são a única entrada pra essas
// páginas nesse layout). O Fórum saiu do menu; a rota /comunidades continua.

const PATHS = {
  crown: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5L3 8ZM5 21h14',
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
  // Central: quatro quadradinhos
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  // Início: casinha
  home: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  // Amigos: duas pessoas
  friends: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM21 19v-1a4 4 0 0 0-3-3.87M15.5 4.13a3 3 0 0 1 0 5.74',
  // Progresso: troféu
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3',
  // Suporte: boia
  support: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6',
  // BLACKOUT: dado de 6 faces
  // Peça de quebra-cabeça: Mod Manager.
  puzzle: 'M10 4a2 2 0 1 1 4 0v1h3a1 1 0 0 1 1 1v3h1a2 2 0 1 1 0 4h-1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 1 0-4 0v1H7a1 1 0 0 1-1-1v-3h1a2 2 0 1 0 0-4H6V6a1 1 0 0 1 1-1h3z',
  gamepad: 'M6 9h12a4 4 0 0 1 3.9 4.9l-.9 3.6a2 2 0 0 1-3.4.9L15 16H9l-2.6 2.4a2 2 0 0 1-3.4-.9l-.9-3.6A4 4 0 0 1 6 9zM8 11v3M6.5 12.5h3M15 12h.01M17 13.5h.01',
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 8.5h.01M15.5 8.5h.01M8.5 15.5h.01M15.5 15.5h.01M12 12h.01',
  cards: 'M8 4h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM4 7.5 6 7M4 7.5v10.2a2 2 0 0 0 1.6 2L6 20M12.5 9l1.3 2.6 2.7.4-2 1.9.5 2.7-2.5-1.3-2.5 1.3.5-2.7-2-1.9 2.7-.4z',
};

export function FeaturedGlyph({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Ordem (nov/2026): o jogo em cartão (a Guerra das Cartas, quando ligada) no topo; depois a lista "minimalista" — só o ícone
// colorido, fundo só na página aberta: Central, Amigos, Economia e
// Progresso. (Suporte foi pro topo: TopSearchBar.jsx; Novidades entrou na
// Central.)
export const FEATURED = [
  // Assinatura (nov/2026): sempre no topo, em dourado. Era uma aba da Loja.
  {
    key: 'assinatura', label: 'Assinatura', icon: 'crown', to: '/assinatura', banner: true, sub: 'Planos e vantagens',
    hint: 'Planos de assinatura e vantagens', match: (p) => p.startsWith('/assinatura'), fixed: true,
  },
  {
    key: 'arena', label: 'Guerra das Cartas', icon: 'cards', to: '/cartas',
    hint: 'Jogo de cartas: colecione, monte seu baralho e batalhe', match: (p) => p.startsWith('/cartas'),
    feature: 'cardsWar', game: true, // interruptor em utils/features.js
  },
  // Central (nov/2026): o antigo Início + Novidades (Anúncios e Eventos),
  // com abas (pages/AnunciosEventosPage.jsx). A bolinha soma as novidades
  // de Anúncios e Eventos e mostra "Ao vivo" quando há evento.
  {
    key: 'inicio', label: 'Central', icon: 'home', to: '/inicio',
    hint: 'Visão geral, anúncios da equipe e eventos da comunidade',
    match: (p) => p === '/inicio' || p.startsWith('/anuncios') || p.startsWith('/comunidade/eventos') || p.startsWith('/evento/') || p.startsWith('/eventos'),
    merges: ['anuncios', 'eventos'],
    n2Only: true, fixed: true,
  },
  {
    key: 'amigos', label: 'Amigos', icon: 'friends', to: '/dms',
    hint: 'Amigos, mensagens diretas e clubes',
    match: (p) => p === '/dms' || isDmPath(p) || p.startsWith('/clans'),
    count: ['mensagem ou pedido novo', 'mensagens ou pedidos novos'],
    n2Only: true, fixed: true,
  },
  // Economia: mesma área da Loja (abas Visão geral · Missões · Loja · Passe
  // — ver components/HubTabs.jsx). Chave 'loja' mantida: é a
  // que a visibilidade salva por comunidade e o CSS (.featured-loja) usam.
  {
    key: 'loja', label: 'Economia', icon: 'coin', to: '/economia',
    hint: 'Moedas, gemas, Loja e Passe do clube',
    match: (p) => p.startsWith('/economia') || p.startsWith('/loja'),
  },
  {
    key: 'progresso', label: 'Progresso', icon: 'trophy', to: '/progresso',
    count: ['missão pronta pra resgatar', 'missões prontas pra resgatar'],
    hint: 'Missões, ranking, conquistas e recompensas',
    match: (p) => p.startsWith('/progresso') || p.startsWith('/missoes') || p.startsWith('/rank') || p.startsWith('/conquistas'),
    n2Only: true, fixed: true,
  },
  {
    // Jogos (nov/2026): BLACKOUT (agora público), Mod Manager, biblioteca e
    // apps do clube numa página só (pages/JogosPage.jsx).
    key: 'jogos', label: 'Jogos', icon: 'gamepad', to: '/jogos',
    hint: 'BLACKOUT, Mod Manager, seus jogos e apps do clube',
    match: (p) => p.startsWith('/jogos') || p.startsWith('/mod/') || p.startsWith('/modpack/') || p.startsWith('/compendio-blackout'),
    fixed: true,
  },
].filter((f) => !f.feature || isFeatureEnabled(f.feature));

// Visibilidade salva por comunidade (padrão: todos visíveis).
export function useFeaturedVisibility() {
  const featured = useStore((s) => s.community?.featuredChannels);
  return (key) => FIXED_KEYS.has(key) || featured?.[key] !== false;
}
const FIXED_KEYS = new Set(FEATURED.filter((f) => f.fixed).map((f) => f.key));
// Os que a staff pode esconder (Configurações da comunidade).
export const HIDEABLE_FEATURED = FEATURED.filter((f) => !f.fixed);

export default function FeaturedChannels({ canManage }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { openMenu } = useContextMenu();
  const isVisible = useFeaturedVisibility();
  const { events } = useCommunityEvents();
  const sectionBadges = useSectionBadges();
  const disabledSystems = useStore((st) => st.disabledSystems) || [];
  const isNormal2 = useStore((st) => st.layoutStyle) === 'normal2';
  const { user } = useAuth();
  const countFor = useBadges(user);
  const instanceId = useStore((st) => st.community?.instance) || 'publica';
  const items = FEATURED.filter((f) => (!f.instance || f.instance === instanceId) && (!f.n2Only || isNormal2) && isVisible(f.key) && !(f.key === 'arena' && disabledSystems.includes('cartas') && !canManage));
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
    if (!canManage || item.fixed) return;
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
    const what = { inicio: ['novidade', 'novidades'], loja: ['coleção nova na Loja', 'coleções novas na Loja'] }[item.key] || ['novidade', 'novidades'];
    const newBadge = fresh > 0 ? <span className="section-new-badge" title={`${fresh} ${fresh === 1 ? what[0] : what[1]}`} aria-label={`${fresh} ${fresh === 1 ? what[0] : what[1]}`}>{badgeLabel(fresh)}</span> : null;
    const hasEvents = (item.merges || []).includes('eventos');
    // Contagem (Amigos: DMs não lidas + pedidos; Economia: missões prontas).
    const count = item.count ? countFor(item.to) : 0;
    // Novidade não vista primeiro (some ao abrir); depois "Ao vivo"; depois
    // a contagem de eventos em breve.
    if (newBadge) badge = newBadge;
    else if (count > 0) badge = <span className="featured-channel-count" title={`${count} ${count === 1 ? item.count[0] : item.count[1]}`}>{count > 99 ? '99+' : count}</span>;
    else if (hasEvents && live > 0) badge = <span className="featured-channel-live" title={`${live} evento${live === 1 ? '' : 's'} acontecendo agora`}>Ao vivo</span>;
    else if (hasEvents && upcoming > 0) badge = <span className="featured-channel-count" title={`${upcoming} evento${upcoming === 1 ? '' : 's'} em breve`}>{upcoming}</span>;
    else if (item.soon) badge = <span className="featured-channel-soon">Em breve</span>;
    else if (item.tag && !active) badge = <span className="featured-channel-tag">{item.tag}</span>;
    return (
      <button
        key={item.key} type="button"
        className={`sidebar-item featured-channel featured-${item.key}${item.game ? ' featured-game' : ' featured-plain'}${active ? ' active' : ''}`}
        onClick={() => go(item)} onContextMenu={(e) => onContextMenu(e, item)}
        title={item.hint} aria-current={active ? 'page' : undefined}
      >
        <span className="featured-channel-icon"><FeaturedGlyph name={item.icon} /></span>
        <span className="featured-channel-text">
          <span className="featured-channel-name truncate">{item.label}</span>
          {item.sub && <span className="featured-channel-sub truncate">{item.sub}</span>}
        </span>
        {badge}
      </button>
    );
  };
  // Lista limpa (modelo 1, nov/2026): Assinatura em cima, uma linha
  // separando, e o resto (jogos/BLACKOUT primeiro) em lista.
  const top = items.filter((i) => i.banner);
  const rest = [...items.filter((i) => !i.banner && i.game), ...items.filter((i) => !i.banner && !i.game)];
  return (
    <div className="featured-channels fc-list" role="group" aria-label="Canais em destaque">
      {top.map(renderItem)}
      {top.length > 0 && rest.length > 0 && <div className="fc-sep" role="separator" />}
      {rest.map(renderItem)}
    </div>
  );
}
