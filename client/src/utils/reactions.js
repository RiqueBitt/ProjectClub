// Shared by Message.jsx and ForumChannelView.jsx — collapses a flat list of
// Reaction rows (one per user per emoji) into per-emoji [emoji, count, mine]
// tuples for rendering as reaction chips.
// `counts` (opcional, { emoji: total }) cobre um payload "enxuto", em que
// o servidor manda só uma amostra das linhas de reação e o total à parte.
export function groupReactions(reactions, myUserId, counts = null) {
  const map = new Map();
  for (const r of reactions || []) {
    const entry = map.get(r.emoji) || { count: 0, mine: false };
    entry.count += 1;
    if ((r.user?.id ?? r.userId) === myUserId) entry.mine = true;
    map.set(r.emoji, entry);
  }
  if (counts && typeof counts === 'object') {
    for (const [emoji, total] of Object.entries(counts)) {
      const n = Number(total) || 0;
      const entry = map.get(emoji);
      if (entry) entry.count = Math.max(entry.count, n);
      else if (n > 0) map.set(emoji, { count: n, mine: false });
    }
  }
  return Array.from(map.entries()).map(([emoji, { count, mine }]) => [emoji, count, mine]);
}

// Linhas de reação de cada emoji (com o usuário, quando veio no payload) —
// usado pelo tooltip e pelo menu "quem reagiu" do chip.
export function reactorsByEmoji(reactions) {
  const map = new Map();
  for (const r of reactions || []) {
    if (!map.has(r.emoji)) map.set(r.emoji, []);
    map.get(r.emoji).push(r);
  }
  return map;
}

// Frase do tooltip: "Fulano, Beltrano e mais 3 reagiram com".
export function reactorsSentence(names, total) {
  const shown = names.slice(0, 3);
  const rest = Math.max(0, total - shown.length);
  if (!shown.length) return `${total} ${total === 1 ? 'pessoa reagiu' : 'pessoas reagiram'} com`;
  const verb = total === 1 ? 'reagiu' : 'reagiram';
  if (rest > 0) return `${shown.join(', ')} e mais ${rest} ${verb} com`;
  if (shown.length === 1) return `${shown[0]} ${verb} com`;
  return `${shown.slice(0, -1).join(', ')} e ${shown[shown.length - 1]} ${verb} com`;
}

// Matches the server's own cap (see MAX_DISTINCT_REACTIONS in
// server/src/controllers/messageController.js) — kept in sync manually
// since the client has no runtime access to the server's constant; used
// only to grey out "add a new emoji" affordances once a message is already
// at the limit (the server still enforces this for real).
export const MAX_DISTINCT_REACTIONS = 20;

// Kept in sync with server/src/controllers/messageController.js's own copy.
export const MAX_FORUM_POST_REACTIONS = 5;

// Matches MAX_FORUM_QUICK_REACTIONS server-side.
export const MAX_FORUM_QUICK_REACTIONS = 3;
