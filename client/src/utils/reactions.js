// Shared by Message.jsx and ForumChannelView.jsx — collapses a flat list of
// Reaction rows (one per user per emoji) into per-emoji [emoji, count, mine]
// tuples for rendering as reaction chips.
export function groupReactions(reactions, myUserId) {
  const map = new Map();
  for (const r of reactions || []) {
    const entry = map.get(r.emoji) || { count: 0, mine: false };
    entry.count += 1;
    if (r.user?.id === myUserId) entry.mine = true;
    map.set(r.emoji, entry);
  }
  return Array.from(map.entries()).map(([emoji, { count, mine }]) => [emoji, count, mine]);
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
