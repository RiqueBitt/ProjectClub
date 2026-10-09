import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useStore } from '../store/useStore';
import UserAvatar from './UserAvatar.jsx';
import { useBadges } from './Normal2Sidebar.jsx';

// Barra de navegação de baixo no celular (estilo apps de comunidade):
// Início, Comunidade, Social, Avisos e Você a um toque. Some dentro de
// um chat/conversa pra deixar espaço pra caixa de mensagem e o teclado.
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5Z',
  chat: 'M4 5h16v11H8l-4 4V5Z',
  friends: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 19v-1a4 4 0 0 0-3-3.87M15.5 4.13a3 3 0 0 1 0 5.74',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
};
const ITEMS = [
  { to: '/inicio', label: 'Início', icon: 'home', match: (p) => p === '/inicio' },
  { to: '/', label: 'Comunidade', icon: 'chat', match: (p) => p === '/' },
  { to: '/dms', label: 'Social', icon: 'friends', match: (p) => p === '/dms' || p.startsWith('/clans') },
  { to: '/notifications', label: 'Avisos', icon: 'bell', match: (p) => p === '/notifications' },
];
const HIDDEN = [/^\/channels\//, /^\/conversations\//, /^\/clans\/mine/, /^\/$/];

export default function MobileTabBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const badgeFor = useBadges(user);
  const viewingProfile = useStore((s) => s.viewingProfileUserId);
  if (HIDDEN.some((re) => re.test(pathname)) || viewingProfile) return null;

  const go = (to) => { useStore.getState().closeMobileSidebar?.(); navigate(to); };
  return (
    <nav className="mtb" aria-label="Navegação principal">
      {ITEMS.map((it) => {
        const active = it.match(pathname);
        const badge = badgeFor(it.to);
        return (
          <button key={it.to} type="button" className={`mtb-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => go(it.to)}>
            <span className="mtb-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[it.icon]} /></svg>
              {badge > 0 && <span className="mtb-badge">{badge > 99 ? '99+' : badge}</span>}
            </span>
            <span className="mtb-label">{it.label}</span>
          </button>
        );
      })}
      <button type="button" className={`mtb-item${pathname === '/profile' ? ' active' : ''}`} onClick={() => go('/profile')}>
        <span className="mtb-icon mtb-avatar"><UserAvatar user={user} size={24} /></span>
        <span className="mtb-label">Você</span>
      </button>
    </nav>
  );
}
