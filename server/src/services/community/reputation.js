// Reputação: botão "Agradecer" em mensagens e posts do Fórum.
//
// Regras: ninguém agradece a si mesmo; cada pessoa agradece a MESMA pessoa
// no máximo uma vez por dia (ReputationThanks único por quem dá + quem
// recebe + dia de Brasília) — dá pra agradecer várias pessoas diferentes.
// Só vale pra mensagem que quem agradece consegue ver (canal com acesso ou
// conversa da qual participa). A reputação é a contagem de agradecimentos
// recebidos; aparece no perfil e num ranking.
const { dayKey } = require('../../utils/spTime');
const { deps, httpError, PUBLIC_MINI } = require('./common');

const RANKING_SIZE = 10;
const RANKING_DAYS = 30;
const DAILY_GIVE_CAP = 30; // teto de agradecimentos que uma pessoa dá por dia

/** Autor de uma mensagem que `userId` pode ver (ou erro 404). */
async function messageAuthorVisibleTo(db, authz, userId, messageId) {
  const msg = await db.message.findUnique({ where: { id: String(messageId || '') }, select: { id: true, authorId: true, channelId: true, conversationId: true, deleted: true } });
  if (!msg || msg.deleted) throw httpError(404, 'Mensagem não encontrada.');
  if (msg.conversationId) {
    const member = await db.conversationMember.findFirst({ where: { conversationId: msg.conversationId, userId }, select: { id: true } });
    if (!member) throw httpError(404, 'Mensagem não encontrada.');
  } else if (msg.channelId) {
    try { await authz.requirePermission(userId, msg.channelId, 'VIEW_CHANNEL'); } catch { throw httpError(404, 'Mensagem não encontrada.'); }
  }
  return msg;
}

async function resolveTarget(d, authz, userId, targetType, targetId) {
  if (targetType === 'MESSAGE') {
    const msg = await messageAuthorVisibleTo(d.db, authz, userId, targetId);
    return { receiverId: msg.authorId, link: null };
  }
  if (targetType === 'POST') {
    const post = await d.db.post.findUnique({ where: { id: String(targetId || '') }, select: { id: true, authorId: true, title: true } });
    if (!post) throw httpError(404, 'Post não encontrado.');
    return { receiverId: post.authorId, link: `/posts/${post.id}`, title: post.title };
  }
  throw httpError(400, 'Tipo inválido.');
}

async function thank(giver, { targetType, targetId }, over = {}) {
  const d = deps(over);
  const authz = over.authz || require('../authz');
  const type = String(targetType || '').toUpperCase();
  const target = await resolveTarget(d, authz, giver.id, type, targetId);
  if (target.receiverId === giver.id) throw httpError(400, 'Não dá pra agradecer a si mesmo.');
  const day = dayKey(d.now);
  const given = await d.db.reputationThanks.count({ where: { giverId: giver.id, dayKey: day } });
  if (given >= DAILY_GIVE_CAP) throw httpError(429, 'Você já agradeceu bastante gente hoje. Volte amanhã!');
  try {
    await d.db.reputationThanks.create({ data: { giverId: giver.id, receiverId: target.receiverId, targetType: type, targetId: String(targetId), dayKey: day } });
  } catch (err) {
    if (err?.code === 'P2002') throw httpError(409, 'Você já agradeceu essa pessoa hoje. Amanhã pode de novo!', { code: 'ALREADY_THANKED' });
    throw err;
  }
  const total = await d.db.reputationThanks.count({ where: { receiverId: target.receiverId } });
  await d.notify(d.io, target.receiverId, {
    kind: 'REPUTATION', title: `${giver.displayName || 'Alguém'} agradeceu você`,
    body: type === 'POST' ? `Pelo post "${String(target.title || '').slice(0, 80)}".` : 'Por uma mensagem sua no chat.',
    link: target.link || `/perfil/${target.receiverId}`, data: { from: giver.id, targetType: type, targetId, total },
  });
  if (total >= require('./secretAchievements').THANKS_FOR_GENTE_BOA) {
    (over.unlock || require('./secretAchievements').unlock)(target.receiverId, 'secreta_gente_boa', d.io, { db: d.db });
  }
  d.io?.notifyUser?.(target.receiverId, 'reputation:update', { userId: target.receiverId, total });
  return { ok: true, receiverId: target.receiverId, total };
}

async function profile(userId, over = {}) {
  const d = deps(over);
  const since = new Date(d.now.getTime() - RANKING_DAYS * 86400000);
  const [total, recent] = await Promise.all([
    d.db.reputationThanks.count({ where: { receiverId: userId } }),
    d.db.reputationThanks.count({ where: { receiverId: userId, createdAt: { gte: since } } }),
  ]);
  return { userId, total, last30Days: recent };
}

async function ranking({ period = '30d' } = {}, over = {}) {
  const d = deps(over);
  const where = period === 'all' ? {} : { createdAt: { gte: new Date(d.now.getTime() - RANKING_DAYS * 86400000) } };
  const rows = await d.db.reputationThanks.groupBy({
    by: ['receiverId'], where, _count: { receiverId: true }, orderBy: { _count: { receiverId: 'desc' } }, take: RANKING_SIZE,
  });
  if (!rows.length) return { period, ranking: [] };
  const users = await d.db.user.findMany({ where: { id: { in: rows.map((r) => r.receiverId) } }, select: PUBLIC_MINI });
  const byId = new Map(users.map((u) => [u.id, u]));
  return {
    period,
    ranking: rows.filter((r) => byId.has(r.receiverId)).map((r, i) => ({ rank: i + 1, user: byId.get(r.receiverId), thanks: r._count.receiverId })),
  };
}

module.exports = { thank, profile, ranking, messageAuthorVisibleTo, DAILY_GIVE_CAP, RANKING_DAYS };
