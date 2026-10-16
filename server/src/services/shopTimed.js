const prisma = require('../config/prisma');

// Itens da Loja com prazo (recompensa de missão, igual às molduras de
// Missões do Discord): a linha de posse ganha expiresAt; quando vence, some
// do inventário e sai do perfil se estiver equipada. Comprar/ganhar de
// presente o mesmo item deixa ele pra sempre (expiresAt = null).

const KINDS = () => require('../controllers/shopController').KINDS;

// Dá (ou estende) um item por N dias. days null = pra sempre.
// Quem já tem pra sempre continua tendo pra sempre.
async function grantTimed(db, userId, kind, itemId, days) {
  const K = KINDS()[kind];
  if (!K) return null;
  const { findItem } = require('../controllers/shopController');
  const item = await findItem(db, kind, itemId);
  if (!item) return null;
  const own = await db[K.own].findUnique({ where: K.uniq(userId, item.id) });
  const add = days ? days * 86400000 : null;
  if (own) {
    if (!own.expiresAt) return { item, expiresAt: null, already: true };
    const base = Math.max(Date.now(), new Date(own.expiresAt).getTime());
    const expiresAt = add ? new Date(base + add) : null;
    await db[K.own].update({ where: { id: own.id }, data: { expiresAt } });
    return { item, expiresAt };
  }
  const expiresAt = add ? new Date(Date.now() + add) : null;
  await db[K.own].create({ data: { userId, [K.fk]: item.id, expiresAt } });
  return { item, expiresAt };
}

const idFromJson = (raw) => { try { return raw ? JSON.parse(raw).id || null : null; } catch { return null; } };
const parseData = (raw) => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };

// Tira do inventário o que venceu e desequipa do perfil.
async function sweepExpired(io) {
  const now = new Date();
  const [decos, effects, items] = await Promise.all([
    prisma.userAvatarDecoration.findMany({ where: { expiresAt: { lte: now } }, select: { id: true, userId: true, decorationId: true } }),
    prisma.userProfileEffect.findMany({ where: { expiresAt: { lte: now } }, select: { id: true, userId: true, effectId: true } }),
    prisma.userShopItem.findMany({ where: { expiresAt: { lte: now } }, select: { id: true, userId: true, itemId: true, item: { select: { kind: true, key: true, data: true } } } }),
  ]);
  if (!decos.length && !effects.length && !items.length) return 0;
  const userIds = [...new Set([...decos, ...effects, ...items].map((r) => r.userId))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, avatarDecoration: true, profileEffect: true, profileFont: true, profileStyle: true } });
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const patches = {};
  const patch = (uid, data) => { patches[uid] = { ...(patches[uid] || {}), ...data }; };
  decos.forEach((r) => { if (idFromJson(byId[r.userId]?.avatarDecoration) === r.decorationId) patch(r.userId, { avatarDecoration: null }); });
  effects.forEach((r) => { if (idFromJson(byId[r.userId]?.profileEffect) === r.effectId) patch(r.userId, { profileEffect: null }); });
  items.forEach((r) => {
    const u = byId[r.userId];
    if (r.item?.kind === 'FONT' && idFromJson(u?.profileFont) === r.itemId) patch(r.userId, { profileFont: null });
    if (r.item?.kind === 'STYLE') {
      const key = parseData(r.item.data).style || (r.item.key || '').replace(/^style:/, '');
      if (key && u?.profileStyle === key) patch(r.userId, { profileStyle: null });
    }
  });
  await Promise.all([
    decos.length ? prisma.userAvatarDecoration.deleteMany({ where: { id: { in: decos.map((r) => r.id) } } }) : null,
    effects.length ? prisma.userProfileEffect.deleteMany({ where: { id: { in: effects.map((r) => r.id) } } }) : null,
    items.length ? prisma.userShopItem.deleteMany({ where: { id: { in: items.map((r) => r.id) } } }) : null,
  ]);
  const { SELF_USER_FIELDS } = require('../controllers/authController');
  for (const [uid, data] of Object.entries(patches)) {
    const user = await prisma.user.update({ where: { id: uid }, data, select: SELF_USER_FIELDS }).catch(() => null);
    if (user && io) {
      const { email, emailVerified, twoFactorEnabled, ...pub } = user;
      io.to(`user:${uid}`).emit('user:update', user);
      io.to('community').except(`user:${uid}`).emit('user:update', pub);
    }
  }
  return decos.length + effects.length + items.length;
}

function startTimedSweeper(io) {
  const tick = () => sweepExpired(io).catch((e) => console.error('[loja] itens com prazo:', e?.message || e));
  setTimeout(tick, 60 * 1000);
  setInterval(tick, 10 * 60 * 1000).unref?.();
}

module.exports = { grantTimed, sweepExpired, startTimedSweeper };
