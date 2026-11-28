import { useLocation, useNavigate } from 'react-router-dom';
import { useStore, isChannelUnread, useMyRoleIds } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { FEATURED, FeaturedGlyph, useFeaturedVisibility } from './FeaturedChannels.jsx';
import { useCommunityEvents } from '../utils/useCommunityEvents';
import { useSectionBadges, sectionCount, badgeLabel } from '../utils/sectionBadges';
import { useBadges } from '../utils/navBadges';
import { isChannelPath } from '../utils/prettyLinks';

// Barra de ícones do visual novo (nov/2026, styles/club.css): as seções do
// app numa coluna fina à esquerda, e a coluna do lado fica só com os canais.
// Mostra as MESMAS entradas dos canais em destaque (FeaturedChannels.jsx) —
// mesma visibilidade, mesmas bolinhas — mais Comunidade e Mod Manager.
// Só no PC: no celular continua a lista de destaques dentro da gaveta.

const EXTRA = {
  chat: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z',
  cog: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
};

function Glyph({ name }) {
  if (!EXTRA[name]) return <FeaturedGlyph name={name} size={20} />;
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d={EXTRA[name]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const COMUNIDADE = {
  key: 'comunidade', label: 'Comunidade', icon: 'chat', to: '/',
  match: (p) => p === '/' || isChannelPath(p) || p.startsWith('/comunidade/galeria'),
};
const MODS = {
  key: 'mods', label: 'Mod Manager', icon: 'puzzle', to: '/jogos/mods',
  match: (p) => p.startsWith('/jogos/mods') || p.startsWith('/mod/') || p.startsWith('/modpack/'),
};

export default function ClubRail() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const myRoleIds = useMyRoleIds(user?.id);
  const isVisible = useFeaturedVisibility();
  const { events } = useCommunityEvents();
  const sectionBadges = useSectionBadges();
  const countFor = useBadges(user);
  const disabledSystems = useStore((s) => s.disabledSystems) || [];
  const instanceId = useStore((s) => s.community?.instance) || 'publica';
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const path = location.pathname;

  const featured = FEATURED.filter((f) => (!f.instance || f.instance === instanceId) && isVisible(f.key)
    && !(f.key === 'arena' && disabledSystems.includes('cartas') && user?.platformRole !== 'ADMIN'));
  const byKey = Object.fromEntries(featured.map((f) => [f.key, f]));
  const main = [COMUNIDADE, byKey.inicio, byKey.amigos, byKey.jogos, MODS].filter(Boolean);
  const more = [byKey.loja, byKey.progresso, byKey.arena].filter(Boolean);
  const live = (events || []).filter((e) => e.status === 'ACTIVE').length;
  const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
  const unreadChannels = allChannels.some((ch) => isChannelUnread(ch, channelReadAt, user?.id, myRoleIds));

  const isActive = (item) => {
    if (item.key === 'jogos') return item.match(path) && !MODS.match(path);
    return item.match(path);
  };

  // Mesma ordem de prioridade dos destaques: novidade não vista, contagem, "Ao vivo".
  const badgeFor = (item, active) => {
    if (item.key === 'comunidade') return !active && unreadChannels ? { dot: true, title: 'Mensagens novas nos canais' } : null;
    const newKeys = item.merges || [{ loja: 'colecoes' }[item.key] || item.key];
    const fresh = active ? 0 : newKeys.reduce((n, k) => n + sectionCount(sectionBadges, k), 0);
    if (fresh > 0) return { text: badgeLabel(fresh), title: `${fresh} ${fresh === 1 ? 'novidade' : 'novidades'}` };
    const count = item.count ? countFor(item.to) : 0;
    if (count > 0) return { text: count > 99 ? '99+' : String(count), title: `${count} ${count === 1 ? item.count[0] : item.count[1]}` };
    if ((item.merges || []).includes('eventos') && live > 0) return { live: true, title: `${live} evento${live === 1 ? '' : 's'} acontecendo agora` };
    return null;
  };

  const go = (to) => {
    if (path !== to) navigate(to);
  };

  const button = (item) => {
    const active = isActive(item);
    const badge = badgeFor(item, active);
    const label = badge?.title ? `${item.label} — ${badge.title}` : item.label;
    return (
      <button
        key={item.key} type="button"
        className={`club-rail-btn${active ? ' is-active' : ''}${item.key === 'assinatura' ? ' is-gold' : ''}`}
        onClick={() => go(item.to)} aria-label={label} aria-current={active ? 'page' : undefined}
        data-tip={item.label} data-tip-side="right"
      >
        <Glyph name={item.icon} />
        {badge?.dot && <i className="club-rail-dot" aria-hidden="true" />}
        {badge?.live && <i className="club-rail-dot is-live" aria-hidden="true" />}
        {badge?.text && <span className="club-rail-count" aria-hidden="true">{badge.text}</span>}
      </button>
    );
  };

  return (
    <nav className="club-rail" aria-label="Seções do Project Club">
      <div className="club-rail-group">{main.map(button)}</div>
      {more.length > 0 && <span className="club-rail-sep" role="separator" />}
      <div className="club-rail-group">{more.map(button)}</div>
      <div className="club-rail-grow" />
      <div className="club-rail-group">
        {byKey.assinatura && button(byKey.assinatura)}
        <button
          type="button" className="club-rail-btn" onClick={() => useStore.getState().openSettings()}
          aria-label="Configurações" data-tip="Configurações" data-tip-side="right"
        >
          <Glyph name="cog" />
        </button>
      </div>
    </nav>
  );
}
