const prisma = require('../config/prisma');
const { SELF_USER_FIELDS } = require('./authController');
const { broadcastUserUpdate } = require('./userController');

// Loja de molduras de avatar. A moldura equipada fica copiada em
// User.avatarDecoration (JSON) pra todo avatar do app conseguir desenhar
// sem consulta extra.

const clamp = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const priceOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const decoJson = (d) => JSON.stringify({ id: d.id, url: d.imageUrl, s: d.scale, x: d.offsetX, y: d.offsetY });

async function list(req, res, next) {
  try {
    const [items, owned, me] = await Promise.all([
      prisma.avatarDecoration.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] }),
      prisma.userAvatarDecoration.findMany({ where: { userId: req.user.id }, select: { decorationId: true } }),
      prisma.user.findUnique({ where: { id: req.user.id }, select: { coins: true, gems: true, avatarDecoration: true } }),
    ]);
    const ownedSet = new Set(owned.map((o) => o.decorationId));
    let equippedId = null;
    try { equippedId = me?.avatarDecoration ? JSON.parse(me.avatarDecoration).id : null; } catch { /* ignora */ }
    res.json({
      items: items.map((d) => ({ ...d, owned: ownedSet.has(d.id) })),
      coins: me?.coins ?? 0, gems: me?.gems ?? 0, equippedId,
    });
  } catch (err) { next(err); }
}

async function buy(req, res, next) {
  try {
    const currency = req.body?.currency === 'gems' ? 'gems' : 'coins';
    const deco = await prisma.avatarDecoration.findUnique({ where: { id: req.params.id } });
    if (!deco || !deco.active) return res.status(404).json({ error: 'Moldura não encontrada.' });
    const price = currency === 'gems' ? deco.priceGems : deco.priceCoins;
    if (price === null || price === undefined) return res.status(400).json({ error: 'Essa moldura não é vendida nessa moeda.' });
    const userId = req.user.id;
    try {
      await prisma.$transaction(async (tx) => {
        const already = await tx.userAvatarDecoration.findUnique({ where: { userId_decorationId: { userId, decorationId: deco.id } } });
        if (already) throw Object.assign(new Error('Você já tem essa moldura.'), { status: 400 });
        // Desconta só se tiver saldo (condição no próprio update evita corrida).
        const r = await tx.user.updateMany({ where: { id: userId, [currency]: { gte: price } }, data: { [currency]: { decrement: price } } });
        if (r.count === 0) throw Object.assign(new Error(currency === 'gems' ? 'Gemas insuficientes.' : 'Moedas insuficientes.'), { status: 400 });
        await tx.userAvatarDecoration.create({ data: { userId, decorationId: deco.id } });
      });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      throw e;
    }
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true, gems: true } });
    res.json({ ok: true, ...me });
  } catch (err) { next(err); }
}

async function equip(req, res, next) {
  try {
    const id = req.body?.id || null;
    let value = null;
    if (id) {
      const own = await prisma.userAvatarDecoration.findUnique({
        where: { userId_decorationId: { userId: req.user.id, decorationId: id } }, include: { decoration: true },
      });
      if (!own) return res.status(403).json({ error: 'Você ainda não tem essa moldura.' });
      value = decoJson(own.decoration);
    }
    const user = await prisma.user.update({ where: { id: req.user.id }, data: { avatarDecoration: value }, select: SELF_USER_FIELDS });
    await broadcastUserUpdate(req, user);
    res.json({ user });
  } catch (err) { next(err); }
}

// ---------- Staff ----------
async function adminList(req, res, next) {
  try {
    const items = await prisma.avatarDecoration.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }], include: { _count: { select: { owners: true } } },
    });
    res.json({ items });
  } catch (err) { next(err); }
}

function readFields(body) {
  const data = {};
  if (body.name !== undefined) data.name = String(body.name).trim().slice(0, 60);
  if (body.priceCoins !== undefined) data.priceCoins = priceOrNull(body.priceCoins);
  if (body.priceGems !== undefined) data.priceGems = priceOrNull(body.priceGems);
  if (body.scale !== undefined) data.scale = clamp(body.scale, 0.8, 2, 1.2);
  if (body.offsetX !== undefined) data.offsetX = clamp(body.offsetX, -50, 50, 0);
  if (body.offsetY !== undefined) data.offsetY = clamp(body.offsetY, -50, 50, 0);
  if (body.active !== undefined) data.active = body.active === true || body.active === 'true';
  if (body.sortOrder !== undefined) data.sortOrder = parseInt(body.sortOrder, 10) || 0;
  return data;
}

// Quem já está usando recebe a posição/imagem nova também.
async function syncEquipped(req, deco) {
  const users = await prisma.user.findMany({ where: { avatarDecoration: { contains: `"id":"${deco.id}"` } }, select: { id: true } });
  if (!users.length) return;
  await prisma.user.updateMany({ where: { id: { in: users.map((u) => u.id) } }, data: { avatarDecoration: decoJson(deco) } });
  for (const { id } of users.slice(0, 200)) {
    const user = await prisma.user.findUnique({ where: { id }, select: SELF_USER_FIELDS });
    if (user) await broadcastUserUpdate(req, user);
  }
}

async function adminCreate(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie a imagem da moldura (PNG, GIF ou WebP).' });
    const data = readFields(req.body || {});
    if (!data.name) return res.status(400).json({ error: 'Dê um nome pra moldura.' });
    const item = await prisma.avatarDecoration.create({ data: { ...data, imageUrl: req.file.url } });
    res.status(201).json({ item });
  } catch (err) { next(err); }
}

async function adminUpdate(req, res, next) {
  try {
    const data = readFields(req.body || {});
    if (req.file) data.imageUrl = req.file.url;
    const item = await prisma.avatarDecoration.update({ where: { id: req.params.id }, data });
    await syncEquipped(req, item);
    res.json({ item });
  } catch (err) { next(err); }
}

async function adminRemove(req, res, next) {
  try {
    const id = req.params.id;
    const users = await prisma.user.findMany({ where: { avatarDecoration: { contains: `"id":"${id}"` } }, select: { id: true } });
    if (users.length) await prisma.user.updateMany({ where: { id: { in: users.map((u) => u.id) } }, data: { avatarDecoration: null } });
    await prisma.avatarDecoration.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { list, buy, equip, adminList, adminCreate, adminUpdate, adminRemove };
