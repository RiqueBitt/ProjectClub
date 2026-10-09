import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useStore, isConversationUnread } from '../store/useStore';
import FriendsPanel from '../components/FriendsPanel.jsx';
import DMConversationsList from '../components/DMConversationsList.jsx';
import SocialIcon from '../components/SocialIcons.jsx';
import ClansPage from './ClansPage.jsx';

// Social: amigos, mensagens diretas e clubes numa página só, com
// contadores nas abas (online, não lidas, pedidos pendentes).
const TABS = [
  { key: 'amigos', label: 'Amigos', icon: 'friends' },
  { key: 'mensagens', label: 'Mensagens', icon: 'chat' },
  { key: 'clubes', label: 'Clubes', icon: 'club' },
];

export default function AmigosPage() {
  const [tab, setTab] = useState('amigos');
  const { user } = useAuth();
  const friends = useStore((s) => s.friends);
  const presence = useStore((s) => s.presence);
  const conversations = useStore((s) => s.conversations);

  const accepted = friends.filter((f) => f.status === 'ACCEPTED');
  const onlineCount = accepted.filter((f) => {
    const st = presence[f.user.id]?.status || f.user.status;
    return st && st !== 'OFFLINE' && st !== 'INVISIBLE';
  }).length;
  const pendingIncoming = friends.filter((f) => f.status === 'PENDING' && f.isIncoming).length;
  const unread = conversations.filter((c) => isConversationUnread(c, user.id)).length;

  const counter = (key) => {
    if (key === 'amigos') return pendingIncoming ? { n: pendingIncoming, alert: true } : null;
    if (key === 'mensagens') return unread ? { n: unread, alert: true } : null;
    return null;
  };

  return (
    <div className="social">
      <header className="social-hero">
        <div>
          <h1>Social</h1>
          <p>
            {accepted.length} amigo{accepted.length === 1 ? '' : 's'}
            {' · '}
            <span className="social-online"><span className="social-dot" /> {onlineCount} online</span>
          </p>
        </div>
        <nav className="social-tabs" role="tablist" aria-label="Seções do Social">
          {TABS.map((t) => {
            const c = counter(t.key);
            return (
              <button
                key={t.key} type="button" role="tab" aria-selected={tab === t.key}
                className={`social-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}
              >
                <SocialIcon name={t.icon} size={17} />
                {t.label}
                {c && <span className="social-badge">{c.n > 99 ? '99+' : c.n}</span>}
              </button>
            );
          })}
        </nav>
      </header>
      <div className={`social-content social-content-${tab}`}>
        {tab === 'amigos' && <FriendsPanel />}
        {tab === 'mensagens' && <DMConversationsList />}
        {tab === 'clubes' && <ClansPage />}
      </div>
    </div>
  );
}
