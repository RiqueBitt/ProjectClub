import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Logo from './Logo.jsx';
import UserAvatar from './UserAvatar.jsx';
import searchIcon from '../assets/icons/search.png';

// Barra fixa no topo: logo à esquerda, busca ao centro, avatar do usuário à
// direita. Os ícones de navegação (Canais/Amigos/Economia/etc) viraram a
// barra lateral AppRail.jsx, no mesmo lugar do antigo server-rail do
// EmberCord. Some em telas de celular (a .mobile-topbar cobre esse espaço).
export default function NavBar({ onOpenSettings }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const openQuickSwitcher = () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
  };

  return (
    <div className="top-navbar">
      <button className="top-navbar-logo" onClick={() => navigate('/')} title="Início">
        <Logo size={40} />
        <span className="top-navbar-brand">Project Club</span>
      </button>

      <button className="top-navbar-search" onClick={openQuickSwitcher} title="Buscar (Ctrl+K)">
        <img className="ui-icon-sm" src={searchIcon} alt="" />
        <span>Buscar na comunidade...</span>
      </button>

      <div style={{ flex: 1 }} />

      <button className="top-navbar-profile" onClick={onOpenSettings} title="Configurações">
        <UserAvatar user={user} size={36} />
        <span className="top-navbar-profile-name truncate">{user.displayName}</span>
      </button>
    </div>
  );
}
