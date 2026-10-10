import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { setStatus as setStatusApi } from '../api/endpoints';
import { STATUS_LABEL } from '../utils/status';
import { usePopoverCoordination } from '../utils/popoverCoordinator';
import UserAvatar from './UserAvatar.jsx';
import PresenceDot from './PresenceDot.jsx';
import StatusEmoji from './StatusEmoji.jsx';
import NavIcon from './NavIcons.jsx';
import CustomStatusModal from './modals/CustomStatusModal.jsx';
import '../styles/nav.css';

const ACTIVITY_VERB = { game: 'Jogando', spotify: 'Ouvindo', app: 'Usando' };

// Barra do usuário no pé da coluna de canais (estilo Discord): avatar com
// status, nome, status personalizado ou "Jogando X", microfone, fone e
// engrenagem. Mudo/ensurdecer usam os mesmos controles da chamada de voz
// (VoiceContext) — fora de uma chamada ficam valendo pra próxima.
export default function UserStatusBar() {
  const { user, setUser } = useAuth();
  const voice = useVoice();
  const presence = useStore((s) => (user ? s.presence[user.id] : null));
  const activity = useStore((s) => (user ? s.activities[user.id] : null));
  const [menuOpen, setMenuOpen] = useState(false);
  usePopoverCoordination(menuOpen, () => setMenuOpen(false));
  const [customOpen, setCustomOpen] = useState(false);
  const rootRef = useRef(null);
  // Fecha o menu de status ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  if (!user) return null;
  const status = presence?.status || user.status || 'ONLINE';
  const customStatus = presence?.customStatus ?? user.customStatus;
  const muted = !!voice?.muted;
  const deafened = !!voice?.deafened;
  const inCall = !!voice?.call;

  const changeStatus = async (s) => {
    setMenuOpen(false);
    try {
      const { user: updated } = await setStatusApi(s);
      setUser(updated);
    } catch { useStore.getState().pushNotice('Não foi possível mudar o status agora.'); }
  };

  let subline;
  if (activity?.name) {
    subline = <><NavIcon name="gamepad" size={12} className="usb-sub-icon" /><span className="truncate">{ACTIVITY_VERB[activity.type] || 'Jogando'} <b>{activity.name}</b></span></>;
  } else if (customStatus || user.customStatusEmoji) {
    subline = <><StatusEmoji emoji={user.customStatusEmoji} /><span className="truncate">{customStatus}</span></>;
  } else {
    subline = <span className="truncate">{STATUS_LABEL[status] || 'Online'}</span>;
  }

  return (
    <div className={`user-status-bar${inCall ? ' in-call' : ''}`} ref={rootRef}>
      <button
        type="button" className={`usb-identity${menuOpen ? ' open' : ''}`}
        onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen}
        title="Mudar status"
      >
        <span className="usb-avatar">
          <UserAvatar user={user} size={34} />
          <PresenceDot status={status} />
        </span>
        <span className="usb-text">
          <span className="usb-name truncate">{user.displayName}</span>
          <span className={`usb-sub${activity?.name ? ' is-activity' : ''}`}>{subline}</span>
        </span>
      </button>
      <div className="usb-actions">
        <button
          type="button" className={`usb-btn${muted ? ' is-off' : ''}`} onClick={() => voice?.toggleMute?.()}
          title={muted ? 'Ativar microfone' : 'Silenciar microfone'} aria-label={muted ? 'Ativar microfone' : 'Silenciar microfone'} aria-pressed={muted}
        >
          <NavIcon name={muted ? 'micOff' : 'mic'} size={18} />
        </button>
        <button
          type="button" className={`usb-btn${deafened ? ' is-off' : ''}`} onClick={() => voice?.toggleDeafen?.()}
          title={deafened ? 'Reativar áudio' : 'Ensurdecer'} aria-label={deafened ? 'Reativar áudio' : 'Ensurdecer'} aria-pressed={deafened}
        >
          <NavIcon name={deafened ? 'headphonesOff' : 'headphones'} size={18} />
        </button>
        <button type="button" className="usb-btn" onClick={() => useStore.getState().openSettings()} title="Configurações" aria-label="Configurações">
          <NavIcon name="gear" size={18} />
        </button>
      </div>

      {menuOpen && (
        <div className="usb-menu" role="menu" onClick={(e) => e.stopPropagation()}>
          <div className="usb-menu-head">
            <UserAvatar user={user} size={40} />
            <div className="usb-menu-head-text">
              <strong className="truncate">{user.displayName}</strong>
              {user.username && <span className="truncate">@{user.username}</span>}
            </div>
          </div>
          {Object.keys(STATUS_LABEL).filter((s) => s !== 'OFFLINE').map((s) => (
            <button key={s} type="button" role="menuitemradio" aria-checked={status === s} className={`usb-menu-item${status === s ? ' active' : ''}`} onClick={() => changeStatus(s)}>
              <PresenceDot status={s} /> <span>{STATUS_LABEL[s]}</span>
              {status === s && <NavIcon name="check" size={15} className="usb-menu-check" />}
            </button>
          ))}
          <div className="usb-menu-sep" />
          <button type="button" role="menuitem" className="usb-menu-item" onClick={() => { setMenuOpen(false); setCustomOpen(true); }}>
            <NavIcon name="chat" size={16} /> <span>Definir status personalizado</span>
          </button>
          <button type="button" role="menuitem" className="usb-menu-item" onClick={() => { setMenuOpen(false); useStore.getState().openProfile(user.id); }}>
            <NavIcon name="user" size={16} /> <span>Ver meu perfil</span>
          </button>
        </div>
      )}
      {customOpen && <CustomStatusModal user={user} onClose={() => setCustomOpen(false)} onSaved={setUser} />}
    </div>
  );
}
