import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext.jsx';
import { celebrateActivity, toggleActivityCheer } from '../api/social';
import { RARITY_COLOR, RARITY_LABEL } from '../utils/achievementRarity';
import { proxyImage } from '../utils/imageProxy';
import UserAvatar from './UserAvatar.jsx';
import '../styles/socialx.css';

// Avisos animados de conquista desbloqueada / subida de nível (no lugar do
// aviso simples de texto), com "Comemorar": destaca o momento na página
// Atividade dos amigos e avisa quem estiver online. Também mostra quando
// um amigo comemora ("Dar parabéns") e quando alguém te dá parabéns.

const ICONS = {
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  level: 'm12 3 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8L12 3Z',
  party: 'M4 20 9 7l8 8-13 5ZM14 4l.5 2M19 9l2-.5M17 3l-1.5 3M20 6l-3 1.5',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  close: 'M6 6l12 12M18 6 6 18',
};
function Glyph({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

const LIFETIME = 11000;
const CONFETTI = Array.from({ length: 18 }, (_, i) => i);

export default function CelebrationToasts() {
  const { socket } = useSocket() || {};
  const navigate = useNavigate();
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
  }, []);

  const schedule = useCallback((id, ms = LIFETIME) => {
    const old = timers.current.get(id);
    if (old) clearTimeout(old);
    timers.current.set(id, setTimeout(() => dismiss(id), ms));
  }, [dismiss]);

  const push = useCallback((toast) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((list) => [...list.slice(-2), { ...toast, id, state: 'idle' }]);
    schedule(id);
  }, [schedule]);

  const patch = (id, changes) => setToasts((list) => list.map((t) => (t.id === id ? { ...t, ...changes } : t)));

  useEffect(() => {
    if (!socket) return undefined;
    const onAchievement = (a) => push({
      kind: 'achievement', title: 'Conquista desbloqueada!', name: a?.name || 'Nova conquista',
      text: a?.description || '', rarity: a?.rarity || 'COMMON', iconUrl: a?.iconUrl || null,
      celebrate: { kind: 'achievement', key: a?.key },
    });
    const onLevel = ({ newLevel, newLevelName, coinsReward } = {}) => push({
      kind: 'level', title: 'Você subiu de nível!', name: `Nível ${newLevel}`,
      text: [newLevelName && newLevelName !== `Lv.${newLevel}` ? newLevelName : null, coinsReward > 0 ? `+${coinsReward} moedas` : null].filter(Boolean).join(' · '),
      level: newLevel, celebrate: { kind: 'level', level: newLevel },
    });
    const onFriendCelebrate = ({ from, itemKey, label } = {}) => push({
      kind: 'friend', title: 'Momento de comemorar', name: from?.displayName || 'Um amigo', user: from,
      text: label || 'tem novidade', itemKey,
    });
    const onCheer = ({ from, label } = {}) => push({
      kind: 'cheer', title: 'Parabéns pra você!', name: from?.displayName || 'Um amigo', user: from,
      text: `comemorou ${label || 'com você'}`,
    });
    socket.on('achievement:unlocked', onAchievement);
    socket.on('xp:levelup', onLevel);
    socket.on('activity:celebrate', onFriendCelebrate);
    socket.on('activity:cheer', onCheer);
    return () => {
      socket.off('achievement:unlocked', onAchievement);
      socket.off('xp:levelup', onLevel);
      socket.off('activity:celebrate', onFriendCelebrate);
      socket.off('activity:cheer', onCheer);
    };
  }, [socket, push]);

  useEffect(() => () => { timers.current.forEach((t) => clearTimeout(t)); timers.current.clear(); }, []);

  // Teste visual sem servidor: window.__pcCelebrate({ ... })
  useEffect(() => {
    if (!import.meta.env.DEV && !window.__pcCelebrateEnabled) return undefined;
    window.__pcCelebrate = (t) => push(t);
    return () => { delete window.__pcCelebrate; };
  }, [push]);

  const onPrimary = async (t) => {
    if (t.state !== 'idle') return;
    patch(t.id, { state: 'busy' });
    schedule(t.id, LIFETIME);
    try {
      if (t.kind === 'friend') {
        if (t.itemKey) await toggleActivityCheer(t.itemKey);
        patch(t.id, { state: 'done', burst: true, doneText: 'Parabéns enviados!' });
      } else {
        const r = await celebrateActivity(t.celebrate);
        patch(t.id, { state: 'done', burst: true, doneText: r?.shared === false ? 'Comemorado! (sua atividade está privada)' : 'Comemorado! Seus amigos foram avisados.' });
      }
      schedule(t.id, 4500);
    } catch {
      patch(t.id, { state: 'done', burst: true, doneText: 'Comemorado!' });
      schedule(t.id, 3500);
    }
  };

  if (toasts.length === 0) return null;

  return (
    <div className="sx-toasts" role="status" aria-live="polite">
      {toasts.map((t) => {
        const color = t.kind === 'achievement' ? RARITY_COLOR[t.rarity] || RARITY_COLOR.COMMON : t.kind === 'level' ? '#ffb02e' : 'var(--brand)';
        const primary = t.kind === 'friend' ? 'Dar parabéns' : t.kind === 'cheer' ? null : 'Comemorar';
        return (
          <div
            key={t.id}
            className={`sx-toast sx-toast-${t.kind}${t.burst ? ' is-burst' : ''}`}
            style={{ '--sx-accent': color }}
            onMouseEnter={() => { const old = timers.current.get(t.id); if (old) clearTimeout(old); }}
            onMouseLeave={() => schedule(t.id, 5000)}
          >
            <span className="sx-toast-glow" aria-hidden="true" />
            {t.burst && (
              <span className="sx-confetti" aria-hidden="true">
                {CONFETTI.map((i) => <i key={i} style={{ '--i': i }} />)}
              </span>
            )}
            <div className="sx-toast-icon">
              {t.user ? <UserAvatar user={t.user} size={44} />
                : t.iconUrl ? <img src={proxyImage(t.iconUrl)} alt="" />
                  : <Glyph name={t.kind === 'level' ? 'level' : 'trophy'} size={24} />}
              {t.user && <span className="sx-toast-badge"><Glyph name={t.kind === 'cheer' ? 'heart' : 'party'} size={12} /></span>}
            </div>
            <div className="sx-toast-body">
              <span className="sx-toast-eyebrow">
                {t.title}
                {t.kind === 'achievement' && <span className="sx-toast-rarity">{RARITY_LABEL[t.rarity] || 'Comum'}</span>}
              </span>
              <span className="sx-toast-name">{t.name}</span>
              {(t.doneText || t.text) && <span className="sx-toast-text">{t.doneText || t.text}</span>}
              <div className="sx-toast-actions">
                {primary && t.state !== 'done' && (
                  <button type="button" className="sx-btn primary sm" disabled={t.state === 'busy'} onClick={() => onPrimary(t)}>
                    <Glyph name={t.kind === 'friend' ? 'heart' : 'party'} size={15} /> {t.state === 'busy' ? 'Enviando...' : primary}
                  </button>
                )}
                <button type="button" className="sx-btn ghost sm" onClick={() => { dismiss(t.id); navigate(t.kind === 'friend' || t.kind === 'cheer' ? '/atividade' : '/progresso?tab=conquistas'); }}>
                  {t.kind === 'friend' || t.kind === 'cheer' ? 'Ver atividade' : 'Ver progresso'}
                </button>
              </div>
            </div>
            <button type="button" className="sx-toast-close" aria-label="Fechar aviso" onClick={() => dismiss(t.id)}><Glyph name="close" size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}
