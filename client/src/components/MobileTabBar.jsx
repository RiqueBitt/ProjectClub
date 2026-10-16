import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useStore } from '../store/useStore';
import UserAvatar from './UserAvatar.jsx';
import { useBadges } from './Normal2Sidebar.jsx';

// Barra de navegação de baixo no celular (estilo apps de comunidade):
// Início, Comunidade, Social, Avisos e Você a um toque. Some dentro de
// um chat/conversa pra deixar espaço pra caixa de mensagem e o teclado.
const PATHS = {
  // Início: panela (ícone de cozinha, pedido do dono).
  home: 'M2 12h20M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8m0-4 16-4m-11.14 2.78-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8',
  chat: 'M4 5h16v11H8l-4 4V5Z',
  friends: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 19v-1a4 4 0 0 0-3-3.87M15.5 4.13a3 3 0 0 1 0 5.74',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.6l1.3 2.65 2.9.42-2.1 2.05.5 2.9L12 14.25l-2.6 1.37.5-2.9-2.1-2.05 2.9-.42z',
};
const ITEMS = [
  { to: '/inicio', label: 'Início', icon: 'home', match: (p) => p === '/inicio' },
  { to: '/', label: 'Comunidade', icon: 'chat', match: (p) => p === '/' },
  { to: '/dms', label: 'Social', icon: 'friends', match: (p) => p === '/dms' || p.startsWith('/clans') },
  { to: '/economia', label: 'Economia', icon: 'coin', system: 'economia', match: (p) => p.startsWith('/economia') || p.startsWith('/missoes') || p === '/loja' },
  { to: '/notifications', label: 'Avisos', icon: 'bell', match: (p) => p === '/notifications' },
];
const HIDDEN = [/^\/channels\//, /^\/conversations\//, /^\/clans\/mine/, /^\/$/];

export default function MobileTabBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const badgeFor = useBadges(user);
  const viewingProfile = useStore((s) => s.viewingProfileUserId);
  const disabledSystems = useStore((s) => s.disabledSystems);
  if (HIDDEN.some((re) => re.test(pathname)) || viewingProfile) return null;
  // Economia some pra membros quando a staff desliga o sistema (admin sempre vê).
  const items = ITEMS.filter((it) => !it.system || user?.platformRole === 'ADMIN' || !disabledSystems.includes(it.system));

  const go = (to) => { useStore.getState().closeMobileSidebar?.(); navigate(to); };
  return (
    <nav className={`mtb${items.length >= 5 ? ' mtb-dense' : ''}`} aria-label="Navegação principal">
      {items.map((it) => {
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
