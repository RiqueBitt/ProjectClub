// Padrinho de novatos.
//
// Quem tem nível MIN_LEVEL ou mais pode se oferecer como padrinho/madrinha
// (CommunityPrefs.mentorOptIn). Cada conta nova aprovada ganha um padrinho
// automaticamente — sempre o disponível com MENOS afilhados ativos (divide
// o trabalho), que tenha usado o Project Club nos últimos ACTIVE_WITHIN_DAYS
// dias. Os dois recebem aviso e já ganham uma conversa (DM) aberta.
// Quando o afilhado usa o Project Club em MENTEE_ACTIVE_DAYS dias diferentes
// (dentro de REWARD_WINDOW_DAYS), o padrinho ganha REWARD_COINS moedas.
const { randomInt } = require('node:crypto');
const { dayKey, DAY_MS } = require('../../utils/spTime');
const { deps, httpError, grantOnce, economyDisabled, claimJob, finishJob, PUBLIC_MINI } = require('./common');

const MIN_LEVEL = 10;
const MAX_ACTIVE_MENTEES = 5;
const ACTIVE_WITHIN_DAYS = 14;
const MENTEE_ACTIVE_DAYS = 7;
const REWARD_WINDOW_DAYS = 30;
const REWARD_COINS = 150;

async function getPrefs(user, over = {}) {
  const d = deps(over);
  const row = await d.db.communityPrefs.findUnique({ where: { userId: user.id } });
  const full = await d.db.user.findUnique({ where: { id: user.id }, select: { accountLevel: true, birthDate: true } });
  return {
    mentorOptIn: !!row?.mentorOptIn,
    birthdayOptIn: !!row?.birthdayOptIn,
    canMentor: (full?.accountLevel || 1) >= MIN_LEVEL,
    mentorMinLevel: MIN_LEVEL,
    // Só diz SE tem data cadastrada — nunca a data (nem o ano).
    hasBirthDate: !!full?.birthDate,
  };
}

async function setPrefs(user, body = {}, over = {}) {
  const d = deps(over);
  const data = {};
  if (body.mentorOptIn !== undefined) {
    const on = !!body.mentorOptIn;
    if (on) {
      const full = await d.db.user.findUnique({ where: { id: user.id }, select: { accountLevel: true } });
      if ((full?.accountLevel || 1) < MIN_LEVEL) throw httpError(403, `Padrinhos precisam ter nível ${MIN_LEVEL} ou mais.`);
    }
    data.mentorOptIn = on;
  }
  if (body.birthdayOptIn !== undefined) data.birthdayOptIn = !!body.birthdayOptIn;
  if (!Object.keys(data).length) throw httpError(400, 'Nada para salvar.');
  const existing = await d.db.communityPrefs.findUnique({ where: { userId: user.id } });
  if (existing) await d.db.communityPrefs.update({ where: { userId: user.id }, data });
  else {
    try { await d.db.communityPrefs.create({ data: { userId: user.id, ...data } }); } catch (err) {
      if (err?.code !== 'P2002') throw err;
      await d.db.communityPrefs.update({ where: { userId: user.id }, data });
    }
  }
  return getPrefs(user, d);
}

/** Escolhe o padrinho com menos afilhados ativos (empate: sorteio). */
function pickMentor(candidates, loads) {
  const open = candidates.filter((c) => (loads.get(c) || 0) < MAX_ACTIVE_MENTEES);
  if (!open.length) return null;
  const min = Math.min(...open.map((c) => loads.get(c) || 0));
  const best = open.filter((c) => (loads.get(c) || 0) === min);
  return best[randomInt(best.length)];
}

/** Conta nova aprovada → ganha um padrinho (se tiver alguém disponível). */
async function assignMentor(menteeId, over = {}) {
  const d = deps(over);
  if (!menteeId) return null;
  if (await d.db.mentorship.findUnique({ where: { menteeId } })) return null;
  const optIns = await d.db.communityPrefs.findMany({ where: { mentorOptIn: true, userId: { not: menteeId } }, select: { userId: true }, take: 500 });
  if (!optIns.length) return null;
  const users = await d.db.user.findMany({
    where: { id: { in: optIns.map((o) => o.userId) }, accountLevel: { gte: MIN_LEVEL }, isPlatformBanned: false, accountDisabledAt: null },
    select: { id: true, displayName: true, suspendedUntil: true },
  });
  const recentDay = dayKey(d.now.getTime() - ACTIVE_WITHIN_DAYS * DAY_MS);
  const active = await d.db.userActiveDay.findMany({ where: { userId: { in: users.map((u) => u.id) }, day: { gte: recentDay } }, select: { userId: true } });
  const activeSet = new Set(active.map((a) => a.userId));
  const candidates = users.filter((u) => activeSet.has(u.id) && !(u.suspendedUntil && new Date(u.suspendedUntil) > d.now)).map((u) => u.id);
  if (!candidates.length) return null;
  const current = await d.db.mentorship.findMany({ where: { mentorId: { in: candidates }, status: 'ACTIVE' }, select: { mentorId: true } });
  const loads = new Map();
  for (const m of current) loads.set(m.mentorId, (loads.get(m.mentorId) || 0) + 1);
  const mentorId = pickMentor(candidates, loads);
  if (!mentorId) return null;
  let row;
  try {
    row = await d.db.mentorship.create({ data: { mentorId, menteeId } });
  } catch (err) {
    if (err?.code === 'P2002') return null;
    throw err;
  }
  const [mentor, mentee] = await Promise.all([
    d.db.user.findUnique({ where: { id: mentorId }, select: PUBLIC_MINI }),
    d.db.user.findUnique({ where: { id: menteeId }, select: PUBLIC_MINI }),
  ]);
  // Conversa já aberta entre os dois (mesmo helper de aceitar amizade).
  let conversation = null;
  try {
    const ensure = over.ensureDirectConversation || require('../../controllers/conversationController').ensureDirectConversation;
    conversation = await ensure(mentorId, menteeId);
    if (conversation) {
      d.io?.notifyUser?.(mentorId, 'conversation:new', { conversation });
      d.io?.notifyUser?.(menteeId, 'conversation:new', { conversation });
    }
  } catch { /* a conversa é um extra: sem ela o apadrinhamento continua */ }
  const dmLink = conversation?.id ? `/conversations/${conversation.id}` : null;
  await d.notify(d.io, menteeId, {
    kind: 'MENTOR', title: `${mentor?.displayName || 'Alguém'} é seu padrinho no Project Club`,
    body: 'Qualquer dúvida sobre a comunidade, é só chamar na conversa que já está aberta. Bem-vindo(a)!',
    link: dmLink || '/participar?aba=padrinhos', data: { mentorId, conversationId: conversation?.id || null },
  });
  await d.notify(d.io, mentorId, {
    kind: 'MENTOR', title: `Você ganhou um afilhado: ${mentee?.displayName || 'membro novo'}`,
    body: `Dê as boas-vindas! Se ele(a) usar o Project Club em ${MENTEE_ACTIVE_DAYS} dias diferentes, você ganha ${REWARD_COINS} moedas.`,
    link: dmLink || '/participar?aba=padrinhos', data: { menteeId, conversationId: conversation?.id || null },
  });
  return row;
}

/** De hora em hora: paga padrinhos cujos afilhados ficaram ativos; expira os antigos. */
async function processRewards(over = {}) {
  const d = deps(over);
  const out = { rewarded: 0, expired: 0 };
  const rows = await d.db.mentorship.findMany({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, take: 500 });
  const off = await economyDisabled(d.db);
  for (const m of rows) {
    const startDay = dayKey(m.createdAt);
    const endDay = dayKey(new Date(m.createdAt).getTime() + REWARD_WINDOW_DAYS * DAY_MS);
    // eslint-disable-next-line no-await-in-loop
    const days = await d.db.userActiveDay.count({ where: { userId: m.menteeId, day: { gte: startDay, lte: endDay } } });
    if (days >= MENTEE_ACTIVE_DAYS && !off) {
      // eslint-disable-next-line no-await-in-loop
      const claim = await d.db.mentorship.updateMany({ where: { id: m.id, status: 'ACTIVE' }, data: { status: 'REWARDED', rewardedAt: d.now } });
      if (claim.count !== 1) continue;
      // eslint-disable-next-line no-await-in-loop
      const mentee = await d.db.user.findUnique({ where: { id: m.menteeId }, select: { displayName: true } });
      // eslint-disable-next-line no-await-in-loop
      await grantOnce(d, `padrinho:${m.id}`, m.mentorId, REWARD_COINS, { kind: 'MENTOR', label: `Padrinho de ${mentee?.displayName || 'membro novo'}` });
      // eslint-disable-next-line no-await-in-loop
      await d.notify(d.io, m.mentorId, {
        kind: 'MENTOR', title: 'Seu afilhado ficou! Obrigado, padrinho',
        body: `${mentee?.displayName || 'Seu afilhado'} já usou o Project Club em ${MENTEE_ACTIVE_DAYS} dias. Você ganhou ${REWARD_COINS} moedas.`,
        link: '/participar?aba=padrinhos',
      });
      out.rewarded += 1;
    } else if (d.now.getTime() - new Date(m.createdAt).getTime() > REWARD_WINDOW_DAYS * DAY_MS) {
      // eslint-disable-next-line no-await-in-loop
      const r = await d.db.mentorship.updateMany({ where: { id: m.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
      out.expired += r.count;
    }
  }
  return out;
}

async function hourlyTick(over = {}) {
  const d = deps(over);
  const key = `padrinhos:${d.now.toISOString().slice(0, 13)}`;
  if (!await claimJob(d.db, key, { now: d.now })) return null;
  try {
    const r = await processRewards(d);
    await finishJob(d.db, key, JSON.stringify(r));
    return r;
  } catch (err) {
    console.error('[padrinhos] falhou:', err?.message || err);
    return null;
  }
}

async function overview(user, over = {}) {
  const d = deps(over);
  const [prefs, asMentee, asMentor] = await Promise.all([
    getPrefs(user, d),
    d.db.mentorship.findUnique({ where: { menteeId: user.id } }),
    d.db.mentorship.findMany({ where: { mentorId: user.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
  ]);
  const ids = [...new Set([asMentee?.mentorId, ...asMentor.map((m) => m.menteeId)].filter(Boolean))];
  const users = ids.length ? await d.db.user.findMany({ where: { id: { in: ids } }, select: PUBLIC_MINI }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const mentees = [];
  for (const m of asMentor) {
    const startDay = dayKey(m.createdAt);
    // eslint-disable-next-line no-await-in-loop
    const days = m.status === 'ACTIVE' ? await d.db.userActiveDay.count({ where: { userId: m.menteeId, day: { gte: startDay } } }) : MENTEE_ACTIVE_DAYS;
    mentees.push({ id: m.id, status: m.status, createdAt: m.createdAt, user: byId.get(m.menteeId) || null, activeDays: Math.min(days, MENTEE_ACTIVE_DAYS) });
  }
  return {
    prefs,
    mentor: asMentee ? { since: asMentee.createdAt, user: byId.get(asMentee.mentorId) || null } : null,
    mentees,
    rules: { minLevel: MIN_LEVEL, maxActive: MAX_ACTIVE_MENTEES, menteeActiveDays: MENTEE_ACTIVE_DAYS, rewardCoins: REWARD_COINS, windowDays: REWARD_WINDOW_DAYS },
  };
}

module.exports = {
  getPrefs, setPrefs, assignMentor, pickMentor, processRewards, hourlyTick, overview,
  MIN_LEVEL, MAX_ACTIVE_MENTEES, MENTEE_ACTIVE_DAYS, REWARD_COINS, REWARD_WINDOW_DAYS,
};
