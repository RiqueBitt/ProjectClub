// Parses @mentions out of a message's final text (after any de-fanging of
// unauthorized @everyone/@here already happened in messageController — so
// this never needs to check MENTION_EVERYONE itself, an unauthorized mention
// simply won't match the regex anymore by the time it gets here).
//
// Longest-name-first matching avoids "Ana" swallowing a mention of "Ana
// Clara" — same trick the client's richTextRender.jsx uses for the visual
// highlight, kept in sync so what renders as a mention chip is exactly what
// generates a real notification/unread badge.

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// members: [{ id, displayName }], roles: [{ id, name, mentionable }]
function parseMentions(content, { members = [], roles = [] } = {}) {
  if (!content) return [];
  const found = [];
  const seen = new Set();
  const add = (targetType, targetId = null) => {
    const key = `${targetType}:${targetId}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ targetType, targetId });
  };

  if (/@everyone\b/.test(content)) add('EVERYONE');
  if (/@here\b/.test(content)) add('HERE');

  const mentionableRoles = [...roles]
    .filter((r) => r.mentionable !== false)
    .sort((a, b) => b.name.length - a.name.length);
  for (const r of mentionableRoles) {
    const re = new RegExp(`@${escapeRegExp(r.name)}\\b`);
    if (re.test(content)) add('ROLE', r.id);
  }

  const sortedMembers = [...members].sort((a, b) => (b.displayName?.length || 0) - (a.displayName?.length || 0));
  for (const m of sortedMembers) {
    if (!m.displayName) continue;
    const re = new RegExp(`@${escapeRegExp(m.displayName)}\\b`);
    if (re.test(content)) add('USER', m.id);
  }

  return found;
}

module.exports = { parseMentions };
