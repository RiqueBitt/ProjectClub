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

// Candidatos a nome logo depois de cada "@": 1 a 6 palavras seguidas
// (nomes de exibição podem ter espaço — "@Ana Clara"), com e sem
// pontuação no fim ("@Ana," / "@Ana!"). Só esses nomes vão pro banco —
// antes cada mensagem com "@" carregava TODOS os usuários e cargos.
const MAX_WORDS = 6;
const MAX_NAME_LEN = 64;
const MAX_CANDIDATES = 200;
function mentionCandidates(content) {
  const out = new Set();
  if (!content || !content.includes('@')) return [];
  const re = /@([^\s@][^@\n]{0,80})/g;
  let m;
  while ((m = re.exec(content)) && out.size < MAX_CANDIDATES) {
    const words = m[1].split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
    let acc = '';
    for (const w of words) {
      acc = acc ? `${acc} ${w}` : w;
      if (acc.length > MAX_NAME_LEN) break;
      out.add(acc);
      const trimmed = acc.replace(/[.,!?;:)\]}'"»”]+$/u, '');
      if (trimmed && trimmed !== acc) out.add(trimmed);
    }
  }
  out.delete('everyone');
  out.delete('here');
  return [...out];
}

// Resolve as menções de um texto consultando só os nomes candidatos
// (`displayName in [...]`, e cargos por nome) e depois aplica o mesmo
// parseMentions de sempre em cima desse subconjunto pequeno.
async function resolveMentions(prisma, content) {
  if (!content || !content.includes('@')) return [];
  const names = mentionCandidates(content);
  const [members, roles] = names.length
    ? await Promise.all([
      prisma.user.findMany({ where: { displayName: { in: names } }, select: { id: true, displayName: true }, take: 200 }),
      prisma.role.findMany({ where: { name: { in: names } }, select: { id: true, name: true, mentionable: true } }),
    ])
    : [[], []];
  return parseMentions(content, { members, roles });
}

module.exports = { parseMentions, mentionCandidates, resolveMentions };
