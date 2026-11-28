import { NavLink } from 'react-router-dom';
import { Ico } from './shared.jsx';
import '../../styles/game-hub.css';

// Game Hub: a central de jogos do Project Club. Uma barra fixa em cima com
// as abas; cada aba rola por baixo dela (as páginas antigas — Mod Manager e
// Biblioteca — continuam com a rolagem própria delas).
export const HUB_TABS = [
  { to: '/jogos', label: 'Início', icon: 'home', end: true },
  { to: '/jogos/promocoes', label: 'Promoções', icon: 'tag' },
  { to: '/jogos/partidas', label: 'Partidas', icon: 'users' },
  { to: '/jogos/clipes', label: 'Clipes', icon: 'film' },
  { to: '/jogos/builds', label: 'Builds', icon: 'hammer' },
  { to: '/jogos/mods', label: 'Mods', icon: 'puzzle' },
  { to: '/jogos/biblioteca', label: 'Biblioteca', icon: 'library' },
];

export default function GameHubShell({ children }) {
  return (
    <div className="gh-shell">
      <header className="gh-bar">
        <div className="gh-brand">
          <span className="gh-brand-mark" aria-hidden="true"><Ico name="gamepad" size={18} /></span>
          <span className="gh-brand-name">Game Hub</span>
        </div>
        <nav className="gh-tabs" aria-label="Seções do Game Hub">
          {HUB_TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `gh-tab${isActive ? ' on' : ''}`}>
              <Ico name={t.icon} size={16} /><span>{t.label}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="gh-body">{children}</div>
    </div>
  );
}

// Página comum de uma aba do hub (rolagem própria, largura máxima).
export function HubPage({ children, className = '' }) {
  return <div className={`gh-page ${className}`}><div className="gh-inner">{children}</div></div>;
}
