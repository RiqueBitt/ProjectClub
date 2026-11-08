import { channelUnreadBadge } from '../utils/unreadCount.js';

// Número vermelho de mensagens novas do canal; com menção vira "@N".
// Sem número, cai na bolinha branca de sempre (quando `unread`).
export default function UnreadCountBadge({ channel, active = false, muted = false, unread = false }) {
  const b = channelUnreadBadge(channel, { active, muted });
  if (!b) return unread && !muted && !active ? <span className="unread-dot" /> : null;
  return (
    <span className={`unread-count-badge${b.mention ? ' has-mention' : ''}`} title={b.title} aria-label={b.title}>
      {b.mention && <span aria-hidden="true">@</span>}{b.label}
    </span>
  );
}
