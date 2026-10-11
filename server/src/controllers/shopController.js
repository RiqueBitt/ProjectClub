const prisma = require('../config/prisma');
const { SELF_USER_FIELDS } = require('./authController');
const { broadcastUserUpdate } = require('./userController');

// Loja (parte 2): coleções e efeitos de perfil. As molduras continuam em
// decorationsController.js; aqui só juntamos tudo numa chamada pra Loja.
// O efeito equipado fica copiado em User.profileEffect (JSON) pra o perfil
// e o miniperfil desenharem sem consulta extra.

const clamp = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const priceOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const bool = (v) => v === true || v === 'true' || v === '1';
const idOrNull = (v) => (v === undefined || v === null || v === '' || v === 'null' ? null : String(v));
const colorOrNull = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : null);
const fileUrl = (req, name) => req.files?.[name]?.[0]?.url || null;

const effectJson = (e) => JSON.stringify({
  id: e.id, url: e.imageUrl,
  d: { s: e.scale, x: e.offsetX, y: e.offsetY, o: e.opacity, t: e.duration },
  m: { s: e.mScale, x: e.mOffsetX, y: e.mOffsetY, o: e.mOpacity, t: e.mDuration },
});
const idFromJson = (raw) => { try { return raw ? JSON.parse(raw).id || null : null; } catch { return null; } };

// GET /decorations/shop — tudo que a Loja mostra, numa chamada só.
async function shop(req, res, next) {
  try {
    const userId = req.user.id;
    const order = [{ sortOrder: 'asc' }, { createdAt: 'desc' }];
    const [decorations, effects, collections, ownedD, ownedE, me] = await Promise.all([
      prisma.avatarDecoration.findMany({ where: { active: true }, orderBy: order }),
      prisma.profileEffect.findMany({ where: { active: true }, orderBy: order }),
      prisma.shopCollection.findMany({ where: { active: true }, orderBy: order }),
      prisma.userAvatarDecoration.findMany({ where: { userId }, select: { decorationId: true } }),
      prisma.userProfileEffect.findMany({ where: { userId }, select: { effectId: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { coins: true, gems: true, avatarDecoration: true, profileEffect: true } }),
    ]);
    const od = new Set(ownedD.map((o) => o.decorationId));
    const oe = new Set(ownedE.map((o) => o.effectId));
    res.json({
      decorations: decorations.map((d) => ({ ...d, owned: od.has(d.id) })),
      effects: effects.map((e) => ({ ...e, owned: oe.has(e.id) })),
      collections,
      coins: me?.coins ?? 0, gems: me?.gems ?? 0,
      equippedId: idFromJson(me?.avatarDecoration),
      equippedEffectId: idFromJson(me?.profileEffect),
    });
  } catch (err) { next(err); }
}

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });

async function buyEffect(req, res, next) {
  try {
    const currency = req.body?.currency === 'gems' ? 'gems' : 'coins';
    const fx = await prisma.profileEffect.findUnique({ where: { id: req.params.id } });
    if (!fx || !fx.active) return res.status(404).json({ error: 'Efeito não encontrado.' });
    const price = currency === 'gems' ? fx.priceGems : fx.priceCoins;
    if (price === null || price === undefined) return res.status(400).json({ error: 'Esse efeito não é vendido nessa moeda.' });
    const userId = req.user.id;
    try {
      await prisma.$transaction(async (tx) => {
        const already = await tx.userProfileEffect.findUnique({ where: { userId_effectId: { userId, effectId: fx.id } } });
        if (already) throw fail('Você já tem esse efeito.');
        const r = await tx.user.updateMany({ where: { id: userId, [currency]: { gte: price } }, data: { [currency]: { decrement: price } } });
        if (r.count === 0) throw fail(currency === 'gems' ? 'Gemas insuficientes.' : 'Moedas insuficientes.');
        await tx.userProfileEffect.create({ data: { userId, effectId: fx.id } });
      });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      throw e;
    }
    require('../services/economyLedger').recordTransaction(userId, { kind: 'SHOP', label: `Loja: efeito ${fx.name || ''}`.trim(), [currency]: -price });
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true, gems: true } });
    res.json({ ok: true, ...me });
  } catch (err) { next(err); }
}

async function equipEffect(req, res, next) {
  try {
    const id = req.body?.id || null;
    let value = null;
    if (id) {
      const own = await prisma.userProfileEffect.findUnique({
        where: { userId_effectId: { userId: req.user.id, effectId: id } }, include: { effect: true },
      });
      if (!own) return res.status(403).json({ error: 'Você ainda não tem esse efeito.' });
      value = effectJson(own.effect);
    }
    const user = await prisma.user.update({ where: { id: req.user.id }, data: { profileEffect: value }, select: SELF_USER_FIELDS });
    await broadcastUserUpdate(req, user);
    res.json({ user });
  } catch (err) { next(err); }
}

// Compra o pacote da coleção: tudo que a pessoa ainda não tem. Se o que
// falta custar menos que o pacote (já tem parte), cobra o menor valor.
async function buyCollection(req, res, next) {
  try {
    const currency = req.body?.currency === 'gems' ? 'gems' : 'coins';
    const col = await prisma.shopCollection.findUnique({
      where: { id: req.params.id },
      include: { decorations: { where: { active: true } }, effects: { where: { active: true } } },
    });
    if (!col || !col.active) return res.status(404).json({ error: 'Coleção não encontrada.' });
    const bundle = currency === 'gems' ? col.bundlePriceGems : col.bundlePriceCoins;
    if (bundle === null || bundle === undefined) return res.status(400).json({ error: 'Essa coleção não vende pacote nessa moeda.' });
    const userId = req.user.id;
    const key = currency === 'gems' ? 'priceGems' : 'priceCoins';
    let paid = 0;
    try {
      await prisma.$transaction(async (tx) => {
        const [od, oe] = await Promise.all([
          tx.userAvatarDecoration.findMany({ where: { userId, decorationId: { in: col.decorations.map((d) => d.id) } }, select: { decorationId: true } }),
          tx.userProfileEffect.findMany({ where: { userId, effectId: { in: col.effects.map((e) => e.id) } }, select: { effectId: true } }),
        ]);
        const hasD = new Set(od.map((o) => o.decorationId));
        const hasE = new Set(oe.map((o) => o.effectId));
        const missD = col.decorations.filter((d) => !hasD.has(d.id));
        const missE = col.effects.filter((e) => !hasE.has(e.id));
        if (!missD.length && !missE.length) throw fail('Você já tem tudo dessa coleção.');
        const missing = [...missD, ...missE];
        const allPriced = missing.every((i) => i[key] !== null && i[key] !== undefined);
        const sum = missing.reduce((a, i) => a + (i[key] || 0), 0);
        paid = allPriced ? Math.min(bundle, sum) : bundle;
        if (paid > 0) {
          const r = await tx.user.updateMany({ where: { id: userId, [currency]: { gte: paid } }, data: { [currency]: { decrement: paid } } });
          if (r.count === 0) throw fail(currency === 'gems' ? 'Gemas insuficientes.' : 'Moedas insuficientes.');
        }
        for (const d of missD) await tx.userAvatarDecoration.create({ data: { userId, decorationId: d.id } });
        for (const e of missE) await tx.userProfileEffect.create({ data: { userId, effectId: e.id } });
      });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      throw e;
    }
    if (paid > 0) require('../services/economyLedger').recordTransaction(userId, { kind: 'SHOP', label: `Loja: coleção ${col.name || ''}`.trim(), [currency]: -paid });
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true, gems: true } });
    res.json({ ok: true, paid, ...me });
  } catch (err) { next(err); }
}

// ---------- Staff: efeitos ----------
async function adminListEffects(req, res, next) {
  try {
    const items = await prisma.profileEffect.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }], include: { _count: { select: { owners: true } } },
    });
    res.json({ items });
  } catch (err) { next(err); }
}

function readEffect(b) {
  const data = {};
  if (b.name !== undefined) data.name = String(b.name).trim().slice(0, 60);
  if (b.priceCoins !== undefined) data.priceCoins = priceOrNull(b.priceCoins);
  if (b.priceGems !== undefined) data.priceGems = priceOrNull(b.priceGems);
  for (const p of ['', 'm']) {
    const k = (n) => (p ? `m${n[0].toUpperCase()}${n.slice(1)}` : n);
    if (b[k('scale')] !== undefined) data[k('scale')] = clamp(b[k('scale')], 0.3, 3, 1);
    if (b[k('offsetX')] !== undefined) data[k('offsetX')] = clamp(b[k('offsetX')], -100, 100, 0);
    if (b[k('offsetY')] !== undefined) data[k('offsetY')] = clamp(b[k('offsetY')], -100, 100, 0);
    if (b[k('opacity')] !== undefined) data[k('opacity')] = clamp(b[k('opacity')], 0.1, 1, 0.85);
    if (b[k('duration')] !== undefined) data[k('duration')] = clamp(b[k('duration')], 1, 20, 4);
  }
  if (b.active !== undefined) data.active = bool(b.active);
  if (b.sortOrder !== undefined) data.sortOrder = parseInt(b.sortOrder, 10) || 0;
  if (b.collectionId !== undefined) data.collectionId = idOrNull(b.collectionId);
  return data;
}

async function syncEquippedEffect(req, fx) {
  const users = await prisma.user.findMany({ where: { profileEffect: { contains: `"id":"${fx.id}"` } }, select: { id: true } });
  if (!users.length) return;
  await prisma.user.updateMany({ where: { id: { in: users.map((u) => u.id) } }, data: { profileEffect: effectJson(fx) } });
  for (const { id } of users.slice(0, 200)) {
    const user = await prisma.user.findUnique({ where: { id }, select: SELF_USER_FIELDS });
    if (user) await broadcastUserUpdate(req, user);
  }
}

async function adminCreateEffect(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie a animação do efeito (GIF, WebP ou PNG animado).' });
    const data = readEffect(req.body || {});
    if (!data.name) return res.status(400).json({ error: 'Dê um nome pro efeito.' });
    const item = await prisma.profileEffect.create({ data: { ...data, imageUrl: req.file.url } });
    res.status(201).json({ item });
  } catch (err) { next(err); }
}

async function adminUpdateEffect(req, res, next) {
  try {
    const data = readEffect(req.body || {});
    if (req.file) data.imageUrl = req.file.url;
    const item = await prisma.profileEffect.update({ where: { id: req.params.id }, data });
    await syncEquippedEffect(req, item);
    res.json({ item });
  } catch (err) { next(err); }
}

async function adminRemoveEffect(req, res, next) {
  try {
    const id = req.params.id;
    const users = await prisma.user.findMany({ where: { profileEffect: { contains: `"id":"${id}"` } }, select: { id: true } });
    if (users.length) await prisma.user.updateMany({ where: { id: { in: users.map((u) => u.id) } }, data: { profileEffect: null } });
    await prisma.profileEffect.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ---------- Staff: coleções ----------
async function adminListCollections(req, res, next) {
  try {
    const items = await prisma.shopCollection.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { decorations: true, effects: true } } },
    });
    res.json({ items });
  } catch (err) { next(err); }
}

function readCollection(b) {
  const data = {};
  if (b.name !== undefined) data.name = String(b.name).trim().slice(0, 60);
  if (b.description !== undefined) data.description = String(b.description).trim().slice(0, 400) || null;
  if (b.accentColor !== undefined) data.accentColor = colorOrNull(b.accentColor);
  if (b.active !== undefined) data.active = bool(b.active);
  if (b.featured !== undefined) data.featured = bool(b.featured);
  if (b.sortOrder !== undefined) data.sortOrder = parseInt(b.sortOrder, 10) || 0;
  if (b.bundlePriceCoins !== undefined) data.bundlePriceCoins = priceOrNull(b.bundlePriceCoins);
  if (b.bundlePriceGems !== undefined) data.bundlePriceGems = priceOrNull(b.bundlePriceGems);
  if (bool(b.removeLogo)) data.logoUrl = null;
  return data;
}

async function adminCreateCollection(req, res, next) {
  try {
    const data = readCollection(req.body || {});
    if (!data.name) return res.status(400).json({ error: 'Dê um nome pra coleção.' });
    const banner = fileUrl(req, 'banner');
    const logo = fileUrl(req, 'logo');
    if (banner) data.bannerUrl = banner;
    if (logo) data.logoUrl = logo;
    const item = await prisma.shopCollection.create({ data });
    res.status(201).json({ item });
  } catch (err) { next(err); }
}

async function adminUpdateCollection(req, res, next) {
  try {
    const data = readCollection(req.body || {});
    const banner = fileUrl(req, 'banner');
    const logo = fileUrl(req, 'logo');
    if (banner) data.bannerUrl = banner;
    if (logo) data.logoUrl = logo;
    const item = await prisma.shopCollection.update({ where: { id: req.params.id }, data });
    res.json({ item });
  } catch (err) { next(err); }
}

async function adminRemoveCollection(req, res, next) {
  try {
    // Itens da coleção ficam na loja, só saem da coleção (onDelete: SetNull).
    await prisma.shopCollection.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  shop, buyEffect, equipEffect, buyCollection,
  adminListEffects, adminCreateEffect, adminUpdateEffect, adminRemoveEffect,
  adminListCollections, adminCreateCollection, adminUpdateCollection, adminRemoveCollection,
  effectJson,
};
