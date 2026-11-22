import { channelUnreadBadge } from '../utils/unreadCount.js';

// Número vermelho "@N" do canal: só menções e respostas pra você (ver
// utils/unreadCount.js). Sem isso, cai na bolinha branca de sempre quando o
// canal está marcado como não lido (`unread` — ex.: "Todas as mensagens").
export default function UnreadCountBadge({ channel, active = false, muted = false, unread = false }) {
  const b = channelUnreadBadge(channel, { active, muted });
  if (!b) return unread && !muted && !active ? <span className="unread-dot" /> : null;
  return (
    <span className={`unread-count-badge${b.mention ? ' has-mention' : ''}`} title={b.title} aria-label={b.title}>
      {b.mention && <span aria-hidden="true">@</span>}{b.label}
    </span>
  );
}
