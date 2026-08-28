import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useStore } from '../store/useStore';
import { usePopoverCoordination } from '../utils/popoverCoordinator';
import ChannelSidebar from './ChannelSidebar.jsx';
import DMSidebar from './DMSidebar.jsx';

const ITEMS = [
  { to: '/', icon: '💬', label: 'Canais', dropdown: 'channels' },
  { to: '/dms', icon: '👥', label: 'Amigos', dropdown: 'friends' },
  { to: '/economia', icon: '💰', label: 'Economia' },
  { to: '/rank', icon: '🏆', label: 'Rank' },
  { to: '/casas', icon: '🧊', label: 'Casas' },
  { to: '/figurinhas', icon: '🧷', label: 'Figurinhas' },
  { to: '/tickets', icon: '🎫', label: 'Tickets' },
];

// Menu único no topo do app — substitui a antiga AppRail (coluna vertical
// fixa) + a antiga barra lateral fixa de canais/amigos. As seções que só
// navegavam pra uma página (Economia/Rank/Casas/Figurinhas/Tickets/Painel)
// continuam simples links. "Canais" e "Amigos" agora abrem um dropdown
// com a estrutura de sempre (ChannelSidebar.jsx / DMSidebar.jsx) sem
// precisar de uma coluna inteira reservada na tela.
//
// No mobile (≤600px) isso vira a gaveta lateral aberta pelo botão
// hambúrguer (.mobile-topbar) — lá "Canais"/"Amigos" voltam a ser links
// normais (sem dropdown), porque a própria gaveta de canais/DMs
// (ChannelSidebar/DMSidebar renderizada via rota, ver MainApp.jsx) já
// abre do lado, exatamente como funcionava antes.
function isItemActive(item, pathname) {
  if (item.to === '/') return pathname === '/' || pathname.startsWith('/channels/');
  if (item.to === '/dms') return pathname === '/dms' || pathname.startsWith('/conversations/');
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export default function TopMenu() {
  const { user } = useAuth();
  const isStaff = ['ADMIN', 'MODERATOR'].includes(user.platformRole);
  const uiLayout = useStore((s) => s.uiLayout);
  const disabledSystems = useStore((s) => s.disabledSystems);
  const location = useLocation();
  const navigate = useNavigate();

  const [openDropdown, setOpenDropdown] = useState(null); // 'channels' | 'friends' | null
  const [dropdownAlign, setDropdownAlign] = useState('left'); // 'left' | 'right' — evita o dropdown saindo da tela
  usePopoverCoordination(!!openDropdown, () => setOpenDropdown(null));
  const wrapRef = useRef(null);
  const dropdownRef = useRef(null);

  // A ordem/posição dos itens do menu é customizável (Editor de
  // Interface, railOrder) — "Canais"/"Amigos" podem acabar perto da borda
  // direita da tela, e o dropdown teria largura suficiente (280-400px)
  // pra sair da viewport se sempre abrisse alinhado à esquerda do item.
  // Depois de renderizar aberto, mede a posição real e alinha pela
  // direita em vez da esquerda quando não houver espaço sobrando.
  useLayoutEffect(() => {
    if (!openDropdown || !dropdownRef.current) { setDropdownAlign('left'); return; }
    const rect = dropdownRef.current.getBoundingClientRect();
    const overflowRight = rect.right > window.innerWidth - 8;
    setDropdownAlign(overflowRight ? 'right' : 'left');
  }, [openDropdown]);

  useEffect(() => {
    const onDocDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpenDropdown(null);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  // Fecha o dropdown assim que a rota muda (ex.: escolheu um canal/DM lá
  // dentro) — sem isso o painel continuava aberto por cima da tela nova.
  useEffect(() => { setOpenDropdown(null); }, [location.pathname]);

  const railOrder = uiLayout?.railOrder;
  const railHidden = new Set(uiLayout?.railHidden || []);
  const items = (railOrder?.length ? railOrder.map((to) => ITEMS.find((i) => i.to === to)).filter(Boolean) : ITEMS)
    .filter((i) => !railHidden.has(i.to))
    .filter((i) => !disabledSystems.includes(i.to.replace('/', '')));

  const onItemClick = (item, e) => {
    if (!item.dropdown) return;
    // No celular a navegação normal é o que abre a seção certa dentro da
    // gaveta lateral já existente — não interceptamos o clique lá.
    if (window.matchMedia('(max-width: 600px)').matches) return;
    e.preventDefault();
    if (!isItemActive(item, location.pathname)) navigate(item.to);
    setOpenDropdown((cur) => (cur === item.dropdown ? null : item.dropdown));
  };

  return (
    <nav className="top-menu" ref={wrapRef}>
      {items.map((item) => {
        const active = isItemActive(item, location.pathname);
        const open = !!item.dropdown && openDropdown === item.dropdown;
        return (
          <div key={item.to} className="top-menu-item-wrap">
            <NavLink
              to={item.to}
              onClick={(e) => onItemClick(item, e)}
              className={`top-menu-item ${active ? 'active' : ''} ${open ? 'open' : ''}`}
            >
              <span className="top-menu-item-icon">{item.icon}</span>
              <span className="top-menu-item-label">{item.label}</span>
              {item.dropdown && <span className="top-menu-item-caret">▾</span>}
            </NavLink>
            {item.dropdown === 'channels' && open && (
              <div ref={dropdownRef} className={`top-menu-dropdown channels-dropdown align-${dropdownAlign}`}>
                <ChannelSidebar />
              </div>
            )}
            {item.dropdown === 'friends' && open && (
              <div ref={dropdownRef} className={`top-menu-dropdown friends-dropdown align-${dropdownAlign}`}>
                <DMSidebar />
              </div>
            )}
          </div>
        );
      })}
      {isStaff && (
        <div className="top-menu-item-wrap">
          <NavLink to="/admin" className={`top-menu-item ${location.pathname.startsWith('/admin') ? 'active' : ''}`}>
            <span className="top-menu-item-icon">🛡️</span>
            <span className="top-menu-item-label">Painel</span>
          </NavLink>
        </div>
      )}
    </nav>
  );
}

export { ITEMS as TOP_MENU_ITEMS };
