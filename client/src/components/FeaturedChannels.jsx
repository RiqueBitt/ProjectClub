import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useContextMenu } from '../context/ContextMenuContext.jsx';
import { updateFeaturedChannels } from '../api/endpoints';
import { useCommunityEvents } from '../utils/useCommunityEvents';
import '../styles/channels.css';
import '../styles/socialx.css';

// Canais em destaque, fixos no topo da lista de canais da comunidade
// (Eventos, Fórum, Galeria e Loja — "Em breve"):
// Eventos (eventos da comunidade), Feed (o Feed de posts, que antes era só
// um botão do menu) e Galeria (fotos, vídeos e GIFs já postados). Parecem
// canais — mesma altura e alinhamento — mas com um fundo de cor suave e
// ícone próprio. A staff pode esconder cada um (Configurações da
// comunidade, ou clique direito aqui).

const PATHS = {
  calendar: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 12h3v3H8z',
  feed: 'M4 5h16v14H4zM8 9h8M8 13h8M8 17h4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01',
  // Fórum: dois balões de conversa
  forum: 'M3 5h12v9H8l-4 3v-3H3zM18 9h3v9h-1v3l-4-3h-5v-2',
  // Loja: sacola
  store: 'M5 8h14l-1 12H6L5 8zM9 8V6a3 3 0 0 1 6 0v2M9 12h.01M15 12h.01',
};

export function FeaturedGlyph({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const FEATURED = [
  {
    key: 'eventos', label: 'Eventos', icon: 'calendar', to: '/comunidade/eventos',
    hint: 'Eventos da comunidade', match: (p) => p.startsWith('/comunidade/eventos'),
  },
  {
    // Chave 'feed' mantida (banco/rotas); na tela o nome é "Fórum".
    key: 'feed', label: 'Fórum', icon: 'forum', to: '/comunidades',
    hint: 'Posts e Temas da comunidade', match: (p) => p === '/comunidades' || p.startsWith('/comunidades/') || p.startsWith('/posts/'),
  },
  {
    key: 'galeria', label: 'Galeria', icon: 'image', to: '/comunidade/galeria',
    hint: 'Fotos, vídeos e GIFs postados na comunidade', match: (p) => p.startsWith('/comunidade/galeria'),
  },
  {
    key: 'loja', label: 'Loja', icon: 'store', to: '/loja',
    hint: 'Loja da comunidade (em breve)', match: (p) => p.startsWith('/loja'),
  },
];

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
  const items = FEATURED.filter((f) => isVisible(f.key));
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

  return (
    <div className="featured-channels" role="group" aria-label="Canais em destaque">
      {items.map((item) => {
        const active = item.match(location.pathname);
        let badge = null;
        if (item.key === 'eventos' && live > 0) badge = <span className="featured-channel-live" title={`${live} evento${live === 1 ? '' : 's'} acontecendo agora`}>Ao vivo</span>;
        else if (item.key === 'eventos' && upcoming > 0) badge = <span className="featured-channel-count" title={`${upcoming} evento${upcoming === 1 ? '' : 's'} em breve`}>{upcoming}</span>;
        else if (item.soon) badge = <span className="featured-channel-soon">Em breve</span>;
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
      })}
    </div>
  );
}
