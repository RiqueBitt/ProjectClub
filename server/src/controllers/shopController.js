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
// Oferta por tempo limitado numa coleção: desconto % no pacote entre
// offerStartsAt e offerEndsAt (sem início = já vale; sem fim = não tem oferta).
function offerOf(col, now = Date.now()) {
  const pct = Number(col?.offerDiscount) || 0;
  if (!(pct > 0) || !col.offerEndsAt) return null;
  const ends = new Date(col.offerEndsAt).getTime();
  const starts = col.offerStartsAt ? new Date(col.offerStartsAt).getTime() : 0;
  if (!(ends > now)) return null;
  return { discount: Math.min(90, pct), startsAt: col.offerStartsAt || null, endsAt: col.offerEndsAt, active: starts <= now };
}
const discounted = (price, offer) => (price == null || !offer?.active ? price : Math.max(0, Math.ceil(price * (100 - offer.discount) / 100)));
function shapeCollection(c, now = Date.now()) {
  const offer = offerOf(c, now);
  return {
    ...c, offer,
    // Preço cheio fica em bundlePrice*; o que se paga agora em finalBundle*.
    finalBundleCoins: discounted(c.bundlePriceCoins, offer),
    finalBundleGems: discounted(c.bundlePriceGems, offer),
  };
}

// Fonte equipada fica copiada em User.profileFont: {id, family, url}.
const parseData = (raw) => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };
const fontJson = (it) => { const d = parseData(it.data); return JSON.stringify({ id: it.id, family: d.family || null, url: d.url || null }); };
const styleKeyOf = (it) => parseData(it.data).style || it.key || null;
const idFromJson = (raw) => { try { return raw ? JSON.parse(raw).id || null : null; } catch { return null; } };

const sup = require('../services/supporters');
const ledger = () => require('../services/economyLedger');
const fail = (msg, status = 400, extra) => Object.assign(new Error(msg), { status, extra });
const sendFail = (res, e) => res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
const noFunds = (currency) => fail(currency === 'gems' ? 'Gemas insuficientes.' : 'Moedas insuficientes.', 400, { code: 'INSUFFICIENT_FUNDS' });

// Moldura e efeito usam o mesmo fluxo de compra; só mudam as tabelas.
// font/style vivem na tabela genérica ShopItem (type = ShopItem.kind).
const KINDS = {
  deco: {
    label: 'moldura', item: 'avatarDecoration', own: 'userAvatarDecoration', fk: 'decorationId', rel: 'decoration',
    uniq: (userId, id) => ({ userId_decorationId: { userId, decorationId: id } }),
  },
  effect: {
    label: 'efeito', item: 'profileEffect', own: 'userProfileEffect', fk: 'effectId', rel: 'effect',
    uniq: (userId, id) => ({ userId_effectId: { userId, effectId: id } }),
  },
  font: {
    label: 'fonte', item: 'shopItem', own: 'userShopItem', fk: 'itemId', rel: 'item', type: 'FONT',
    uniq: (userId, id) => ({ userId_itemId: { userId, itemId: id } }),
  },
  style: {
    label: 'estilo', item: 'shopItem', own: 'userShopItem', fk: 'itemId', rel: 'item', type: 'STYLE',
    uniq: (userId, id) => ({ userId_itemId: { userId, itemId: id } }),
  },
};
const kindOf = (v) => (Object.prototype.hasOwnProperty.call(KINDS, v) ? v : null);
// Busca o item do tipo certo (font/style dividem a tabela ShopItem).
async function findItem(db, kind, id) {
  const K = KINDS[kind];
  const item = await db[K.item].findUnique({ where: { id: String(id || '') } });
  if (!item || (K.type && item.kind !== K.type)) return null;
  return item;
}
const isLimited = (item) => item?.stock !== null && item?.stock !== undefined;

// Item de coleção oculta (showInShop = false): não é vendido nem presenteado
// pela Loja, mas quem já tem continua usando e a staff pode dar normalmente.
async function hiddenFromShop(db, item) {
  if (!item?.collectionId) return false;
  const col = await db.shopCollection.findUnique({ where: { id: item.collectionId }, select: { showInShop: true } });
  return !!col && col.showInShop === false;
}

// Item limitado: reserva uma cópia do estoque dentro da transação e devolve
// o número de série dela (#1, #2...). Esgotado = erro 409.
async function claimStock(tx, kind, item) {
  if (!isLimited(item)) return null;
  const K = KINDS[kind];
  const r = await tx[K.item].updateMany({ where: { id: item.id, sold: { lt: item.stock } }, data: { sold: { increment: 1 } } });
  if (r.count === 0) throw fail('Esgotado! Esse item limitado não tem mais estoque.', 409, { code: 'SOLD_OUT' });
  const fresh = await tx[K.item].findUnique({ where: { id: item.id }, select: { sold: true } });
  return fresh.sold;
}
const tierOf = async (db, userId) => sup.normalizeTier((await db.user.findUnique({ where: { id: userId }, select: { supporterTier: true } }))?.supporterTier);

// "expectedPrice" é o preço que a pessoa CONFIRMOU na tela. Se o servidor
// calcular outro (desconto acabou, staff mudou o preço...), não cobra:
// devolve 409 com o preço novo pra ela confirmar de novo.
function checkExpected(body, final) {
  if (body?.expectedPrice === undefined || body?.expectedPrice === null || body?.expectedPrice === '') return;
  const exp = Number(body.expectedPrice);
  if (!Number.isFinite(exp) || exp !== final) throw fail('O preço mudou. Confira o valor novo e confirme de novo.', 409, { code: 'PRICE_CHANGED', price: final });
}

// GET /decorations/shop — tudo que a Loja mostra, numa chamada só, já com o
// preço final de cada item calculado pro status de apoio de quem pede.
async function shop(req, res, next) {
  try {
    const userId = req.user.id;
    const order = [{ sortOrder: 'asc' }, { createdAt: 'desc' }];
    const count = { _count: { select: { owners: true } } };
    const [decorations, effects, shopItems, allCollections, hiddenCols, ownedD, ownedE, ownedI, me] = await Promise.all([
      prisma.avatarDecoration.findMany({ where: { active: true }, orderBy: order, include: count }),
      prisma.profileEffect.findMany({ where: { active: true }, orderBy: order, include: count }),
      prisma.shopItem.findMany({ where: { active: true }, orderBy: order, include: count }),
      prisma.shopCollection.findMany({ where: { active: true }, orderBy: order }),
      prisma.shopCollection.findMany({ where: { showInShop: false }, select: { id: true } }),
      prisma.userAvatarDecoration.findMany({ where: { userId }, select: { decorationId: true, serial: true, expiresAt: true } }),
      prisma.userProfileEffect.findMany({ where: { userId }, select: { effectId: true, serial: true, expiresAt: true } }),
      prisma.userShopItem.findMany({ where: { userId }, select: { itemId: true, serial: true, expiresAt: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { coins: true, gems: true, avatarDecoration: true, profileEffect: true, profileFont: true, profileStyle: true, supporterTier: true, supporterUntil: true } }),
    ]);
    const tier = sup.normalizeTier(me?.supporterTier);
    // Coleções ocultas: fora da vitrine; os itens delas só aparecem pra quem
    // já tem (pra continuar equipando), marcados com inShop: false.
    const hiddenIds = new Set(hiddenCols.map((c) => c.id));
    const collections = allCollections.filter((c) => !hiddenIds.has(c.id));
    // "Em alta": quantas cópias saíram nos últimos 7 dias (compras, presentes, prêmios).
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const [trD, trE, trI, banners] = await Promise.all([
      prisma.userAvatarDecoration.groupBy({ by: ['decorationId'], where: { createdAt: { gte: weekAgo } }, _count: { _all: true } }).catch(() => []),
      prisma.userProfileEffect.groupBy({ by: ['effectId'], where: { createdAt: { gte: weekAgo } }, _count: { _all: true } }).catch(() => []),
      prisma.userShopItem.groupBy({ by: ['itemId'], where: { createdAt: { gte: weekAgo } }, _count: { _all: true } }).catch(() => []),
      prisma.shopBanner.findMany({ where: { active: true, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }], take: 6 }).catch(() => []),
    ]);
    const trending = new Map([...trD.map((r) => [r.decorationId, r._count._all]), ...trE.map((r) => [r.effectId, r._count._all]), ...trI.map((r) => [r.itemId, r._count._all])]);
    const od = new Set(ownedD.map((o) => o.decorationId));
    const oe = new Set(ownedE.map((o) => o.effectId));
    const oi = new Set(ownedI.map((o) => o.itemId));
    const serials = new Map([...ownedD.map((o) => [o.decorationId, o.serial]), ...ownedE.map((o) => [o.effectId, o.serial]), ...ownedI.map((o) => [o.itemId, o.serial])]);
    // Itens com prazo (recompensa de missão): a Loja mostra quando vencem.
    const expires = new Map([...ownedD.map((o) => [o.decorationId, o.expiresAt]), ...ownedE.map((o) => [o.effectId, o.expiresAt]), ...ownedI.map((o) => [o.itemId, o.expiresAt])]);
    const shape = (it, ownedSet) => {
      const { _count, ...rest } = it;
      const exclusive = sup.exclusiveOf(it);
      const viaTier = !!exclusive && sup.qualifiesFor(tier, exclusive);
      const limited = isLimited(it);
      return {
        ...rest,
        ...(it.data !== undefined ? { data: parseData(it.data) } : {}),
        limited,
        remaining: limited ? Math.max(0, it.stock - it.sold) : null,
        serial: serials.get(it.id) ?? null,
        expiresAt: expires.get(it.id) || null,
        exclusiveTier: exclusive,
        owned: ownedSet.has(it.id) || viaTier,
        ownedVia: ownedSet.has(it.id) ? 'PURCHASE' : viaTier ? 'SUPPORTER' : null,
        locked: !!exclusive && !viaTier && !ownedSet.has(it.id),
        popularity: _count?.owners || 0,
        trending: trending.get(it.id) || 0,
        tags: it.tags ? String(it.tags).split(',').filter(Boolean) : [],
        pricing: exclusive ? null : sup.pricing(it, tier),
        inShop: !hiddenIds.has(it.collectionId),
      };
    };
    // Itens de coleção oculta só voltam pra quem já tem (ou libera pelo apoio).
    const visible = (list, ownedSet) => list.map((it) => shape(it, ownedSet)).filter((it) => it.inShop || it.owned);
    res.json({
      decorations: visible(decorations, od),
      effects: visible(effects, oe),
      fonts: visible(shopItems.filter((i) => i.kind === 'FONT'), oi),
      styles: visible(shopItems.filter((i) => i.kind === 'STYLE'), oi),
      collections: collections.map((c) => {
        const col = shapeCollection(c);
        return { ...col, pricing: { coins: sup.bundlePriceFor(c, 'coins', tier, col.offer), gems: sup.bundlePriceFor(c, 'gems', tier, col.offer) } };
      }),
      coins: me?.coins ?? 0, gems: me?.gems ?? 0,
      supporter: { ...sup.supporterInfo(tier), until: me?.supporterUntil || null },
      banners,
      equippedId: idFromJson(me?.avatarDecoration),
      equippedEffectId: idFromJson(me?.profileEffect),
      equippedFontId: idFromJson(me?.profileFont),
      equippedStyle: me?.profileStyle || null,
    });
  } catch (err) { next(err); }
}

// Compra avulsa de moldura/efeito. Preço recalculado aqui, dentro da
// transação, com o status de apoio lido do banco nesse momento.
async function buyItem(kind, req, res, next) {
  const K = KINDS[kind];
  try {
    const currency = req.body?.currency === 'gems' ? 'gems' : 'coins';
    const item = await findItem(prisma, kind, req.params.id);
    if (!item || !item.active) return res.status(404).json({ error: `${K.label[0].toUpperCase()}${K.label.slice(1)} não encontrado(a).` });
    if (await hiddenFromShop(prisma, item)) return res.status(403).json({ error: 'Esse item não está à venda na Loja.', code: 'NOT_FOR_SALE' });
    if (sup.exclusiveOf(item)) return res.status(403).json({ error: `Item exclusivo de ${sup.TIER_LABEL[sup.exclusiveOf(item)]} — não é vendido, é liberado pelo apoio.`, code: 'EXCLUSIVE' });
    const userId = req.user.id;
    let price;
    try {
      await prisma.$transaction(async (tx) => {
        const p = sup.priceFor(item, currency, await tierOf(tx, userId));
        if (p.final === null) throw fail(`Esse ${K.label} não é vendido nessa moeda.`);
        checkExpected(req.body, p.final);
        price = p;
        const already = await tx[K.own].findUnique({ where: K.uniq(userId, item.id) });
        if (already && !already.expiresAt) throw fail(`Você já tem esse ${K.label}.`, 400, { code: 'ALREADY_OWNED' });
        if (p.final > 0) {
          // Desconta só se tiver saldo (condição no próprio update evita corrida).
          const r = await tx.user.updateMany({ where: { id: userId, [currency]: { gte: p.final } }, data: { [currency]: { decrement: p.final } } });
          if (r.count === 0) throw noFunds(currency);
        }
        // UNIQUE(userId, itemId): compra repetida em paralelo desfaz tudo
        // (inclusive a cópia do estoque reservada pelo limitado).
        // Tinha só com prazo (missão)? Comprar deixa pra sempre.
        if (already) await tx[K.own].update({ where: K.uniq(userId, item.id), data: { expiresAt: null } });
        else {
          const serial = await claimStock(tx, kind, item);
          await tx[K.own].create({ data: { userId, [K.fk]: item.id, serial } });
        }
      });
    } catch (e) {
      if (e.status) return sendFail(res, e);
      if (e.code === 'P2002') return res.status(400).json({ error: `Você já tem esse ${K.label}.`, code: 'ALREADY_OWNED' });
      throw e;
    }
    const label = `Loja: ${K.label} ${item.name || ''}`.trim() + (price.discount ? ` (-${price.discount}% Assinante)` : '');
    if (price.final > 0) ledger().recordTransaction(userId, { kind: 'SHOP', label, [currency]: -price.final });
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true, gems: true } });
    res.json({ ok: true, paid: price.final, currency, base: price.base, discount: price.discount, ...me });
  } catch (err) { next(err); }
}
const buyEffect = (req, res, next) => buyItem('effect', req, res, next);
const buyDecoration = (req, res, next) => buyItem('deco', req, res, next);
const buyFont = (req, res, next) => buyItem('font', req, res, next);
const buyStyle = (req, res, next) => buyItem('style', req, res, next);

// Pode usar = comprou OU é exclusivo e a categoria de apoio libera.
async function usableItem(kind, userId, id) {
  const K = KINDS[kind];
  const own = await prisma[K.own].findUnique({ where: K.uniq(userId, id), include: { [K.rel]: true } });
  if (own && (!K.type || own[K.rel]?.kind === K.type)) return own[K.rel];
  const item = await findItem(prisma, kind, id);
  const req = sup.exclusiveOf(item);
  if (item && item.active && req && sup.qualifiesFor(await tierOf(prisma, userId), req)) return item;
  return null;
}

async function equipEffect(req, res, next) {
  try {
    const id = req.body?.id || null;
    let value = null;
    if (id) {
      const fx = await usableItem('effect', req.user.id, String(id));
      if (!fx) return res.status(403).json({ error: 'Você ainda não tem esse efeito.' });
      value = effectJson(fx);
    }
    const user = await prisma.user.update({ where: { id: req.user.id }, data: { profileEffect: value }, select: SELF_USER_FIELDS });
    await broadcastUserUpdate(req, user);
    res.json({ user });
  } catch (err) { next(err); }
}

// Fonte do nome (null = volta pra fonte grátis escolhida no perfil).
async function equipFont(req, res, next) {
  try {
    const id = req.body?.id || null;
    let value = null;
    if (id) {
      const it = await usableItem('font', req.user.id, String(id));
      if (!it) return res.status(403).json({ error: 'Você ainda não tem essa fonte.' });
      value = fontJson(it);
    }
    const user = await prisma.user.update({ where: { id: req.user.id }, data: { profileFont: value }, select: SELF_USER_FIELDS });
    await broadcastUserUpdate(req, user);
    res.json({ user });
  } catch (err) { next(err); }
}

// Estilo de perfil/miniperfil (null = visual padrão).
async function equipStyle(req, res, next) {
  try {
    const id = req.body?.id || null;
    let value = null;
    if (id) {
      const it = await usableItem('style', req.user.id, String(id));
      if (!it) return res.status(403).json({ error: 'Você ainda não tem esse estilo.' });
      value = styleKeyOf(it);
    }
    const user = await prisma.user.update({ where: { id: req.user.id }, data: { profileStyle: value }, select: SELF_USER_FIELDS });
    await broadcastUserUpdate(req, user);
    res.json({ user });
  } catch (err) { next(err); }
}

// Compra o pacote da coleção: tudo que a pessoa ainda não tem (exclusivos
// de apoio ficam de fora — não são vendidos). Se o que falta custar menos
// que o pacote (já tem parte), cobra o menor valor.
async function buyCollection(req, res, next) {
  try {
    const currency = req.body?.currency === 'gems' ? 'gems' : 'coins';
    const col = await prisma.shopCollection.findUnique({
      where: { id: req.params.id },
      include: { decorations: { where: { active: true } }, effects: { where: { active: true } }, items: { where: { active: true } } },
    });
    if (!col || !col.active || col.showInShop === false) return res.status(404).json({ error: 'Coleção não encontrada.' });
    const userId = req.user.id;
    // Limitados ficam fora do pacote: são vendidos um a um (com estoque).
    const sellable = (i) => !sup.exclusiveOf(i) && !isLimited(i);
    const sellD = col.decorations.filter(sellable);
    const sellE = col.effects.filter(sellable);
    const sellI = col.items.filter(sellable);
    let paid = 0; let source = null;
    try {
      await prisma.$transaction(async (tx) => {
        const tier = await tierOf(tx, userId);
        const bundle = sup.bundlePriceFor(col, currency, tier, offerOf(col));
        if (bundle.final === null) throw fail('Essa coleção não vende pacote nessa moeda.');
        const [od, oe, oi] = await Promise.all([
          tx.userAvatarDecoration.findMany({ where: { userId, decorationId: { in: sellD.map((d) => d.id) } }, select: { decorationId: true } }),
          tx.userProfileEffect.findMany({ where: { userId, effectId: { in: sellE.map((e) => e.id) } }, select: { effectId: true } }),
          tx.userShopItem.findMany({ where: { userId, itemId: { in: sellI.map((i) => i.id) } }, select: { itemId: true } }),
        ]);
        const hasD = new Set(od.map((o) => o.decorationId));
        const hasE = new Set(oe.map((o) => o.effectId));
        const hasI = new Set(oi.map((o) => o.itemId));
        const missD = sellD.filter((d) => !hasD.has(d.id));
        const missE = sellE.filter((e) => !hasE.has(e.id));
        const missI = sellI.filter((i) => !hasI.has(i.id));
        if (!missD.length && !missE.length && !missI.length) throw fail('Você já tem tudo dessa coleção.', 400, { code: 'ALREADY_OWNED' });
        const missing = [...missD, ...missE, ...missI];
        const each = missing.map((i) => sup.priceFor(i, currency, tier).final);
        const allPriced = each.every((v) => v !== null);
        const sum = each.reduce((a, v) => a + (v || 0), 0);
        paid = allPriced ? Math.min(bundle.final, sum) : bundle.final;
        source = paid === bundle.final ? bundle.source : (tier !== 'NONE' ? 'SUBSCRIBER' : null);
        checkExpected(req.body, paid);
        if (paid > 0) {
          const r = await tx.user.updateMany({ where: { id: userId, [currency]: { gte: paid } }, data: { [currency]: { decrement: paid } } });
          if (r.count === 0) throw noFunds(currency);
        }
        // Um INSERT por tabela. Sem skipDuplicates de propósito: compra
        // repetida em paralelo estoura a UNIQUE e desfaz a transação inteira
        // (inclusive o débito) — ninguém paga duas vezes.
        if (missD.length) await tx.userAvatarDecoration.createMany({ data: missD.map((d) => ({ userId, decorationId: d.id })) });
        if (missE.length) await tx.userProfileEffect.createMany({ data: missE.map((e) => ({ userId, effectId: e.id })) });
        if (missI.length) await tx.userShopItem.createMany({ data: missI.map((i) => ({ userId, itemId: i.id })) });
      });
    } catch (e) {
      if (e.status) return sendFail(res, e);
      if (e.code === 'P2002') return res.status(409).json({ error: 'Compra já processada.', code: 'ALREADY_OWNED' });
      throw e;
    }
    if (paid > 0) ledger().recordTransaction(userId, { kind: 'SHOP', label: `Loja: coleção ${col.name || ''}`.trim() + (source === 'SUBSCRIBER' ? ' (desconto Assinante)' : ''), [currency]: -paid });
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true, gems: true } });
    res.json({ ok: true, paid, currency, ...me });
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
  Object.assign(data, readShopFlags(b));
  return data;
}

// Campos da sala branca, comuns a molduras e efeitos.
function readShopFlags(b) {
  const data = {};
  if (b.featured !== undefined) data.featured = bool(b.featured);
  if (b.showInShop !== undefined) data.showInShop = bool(b.showInShop);
  if (b.discountEligible !== undefined) data.discountEligible = bool(b.discountEligible);
  if (b.exclusiveTier !== undefined) data.exclusiveTier = b.exclusiveTier === 'SUBSCRIBER' || b.exclusiveTier === 'SUPER' ? b.exclusiveTier : null;
  if (b.description !== undefined) data.description = String(b.description).trim().slice(0, 400) || null;
  // Estoque de item limitado: vazio/0 = ilimitado.
  if (b.stock !== undefined) {
    const n = parseInt(b.stock, 10);
    data.stock = Number.isFinite(n) && n > 0 ? Math.min(1000000, n) : null;
  }
  // Filtros da Loja: tags de tema, cor principal e grupo de variantes.
  if (b.tags !== undefined) {
    const list = String(b.tags || '').split(',').map((t) => t.trim()).filter((t) => SHOP_TAGS.includes(t));
    data.tags = list.length ? [...new Set(list)].join(',') : null;
  }
  if (b.color !== undefined) data.color = SHOP_COLORS.includes(b.color) ? b.color : null;
  if (b.variantGroup !== undefined) data.variantGroup = String(b.variantGroup || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64) || null;
  return data;
}
const SHOP_TAGS = ['anime', 'jogos', 'fofo', 'scifi', 'comida', 'fantasia', 'animais', 'natureza', 'filmes', 'dark', 'terror', 'esportes', 'musica', 'parceria'];
const SHOP_COLORS = ['roxo', 'azul', 'verde', 'marrom', 'amarelo', 'laranja', 'vermelho', 'rosa', 'branco', 'preto'];

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
    if (data.stock != null) {
      const prev = await prisma.profileEffect.findUnique({ where: { id: req.params.id }, select: { sold: true } });
      if (prev && data.stock < prev.sold) data.stock = prev.sold;
    }
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
      include: { _count: { select: { decorations: true, effects: true, items: true } } },
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
  if (b.discountEligible !== undefined) data.discountEligible = bool(b.discountEligible);
  if (b.sortOrder !== undefined) data.sortOrder = parseInt(b.sortOrder, 10) || 0;
  if (b.bundlePriceCoins !== undefined) data.bundlePriceCoins = priceOrNull(b.bundlePriceCoins);
  if (b.bundlePriceGems !== undefined) data.bundlePriceGems = priceOrNull(b.bundlePriceGems);
  if (bool(b.removeLogo)) data.logoUrl = null;
  // Oferta por tempo limitado (vazio = sem oferta).
  const dateOrNull = (v) => { if (v === undefined || v === null || v === '' || v === 'null') return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
  if (b.offerStartsAt !== undefined) data.offerStartsAt = dateOrNull(b.offerStartsAt);
  if (b.offerEndsAt !== undefined) data.offerEndsAt = dateOrNull(b.offerEndsAt);
  if (b.offerDiscount !== undefined) {
    const n = parseInt(b.offerDiscount, 10);
    data.offerDiscount = Number.isFinite(n) && n > 0 ? Math.min(90, n) : null;
  }
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

// ---------- Histórico de compras e presentes ----------
// GET /decorations/history?before= — compras e presentes enviados (vêm do
// histórico da carteira) + presentes recebidos (avisos salvos).
async function purchaseHistory(req, res, next) {
  try {
    const where = { userId: req.user.id, kind: { in: ['SHOP', 'GIFT'] } };
    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && !Number.isNaN(before.getTime())) where.createdAt = { lt: before };
    const take = 30;
    const [rows, received] = await Promise.all([
      prisma.economyTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, take }),
      before ? [] : prisma.userNotice.findMany({ where: { userId: req.user.id, kind: 'GIFT' }, orderBy: { createdAt: 'desc' }, take: 30 }).catch(() => []),
    ]);
    const { shapeNotice } = require('../services/notices');
    res.json({ purchases: rows, hasMore: rows.length === take, received: received.map(shapeNotice) });
  } catch (err) { next(err); }
}

// ---------- Presentear um amigo ----------
// POST /decorations/gift { kind: 'deco'|'effect', id, toUserId, currency, note }
// Quem dá paga com a própria moeda; o amigo ganha o item e um aviso.
async function giftItem(req, res, next) {
  try {
    const kind = kindOf(req.body?.kind);
    const currency = req.body?.currency === 'gems' ? 'gems' : 'coins';
    const toUserId = String(req.body?.toUserId || '');
    const note = String(req.body?.note || '').trim().slice(0, 140);
    const fromId = req.user.id;
    if (!kind) return res.status(400).json({ error: 'Item inválido.' });
    if (!toUserId || toUserId === fromId) return res.status(400).json({ error: 'Escolha um amigo pra presentear.' });
    const friendship = await prisma.friendship.findFirst({
      where: { status: 'ACCEPTED', OR: [{ requesterId: fromId, addresseeId: toUserId }, { requesterId: toUserId, addresseeId: fromId }] },
      select: { id: true },
    });
    if (!friendship) return res.status(403).json({ error: 'Você só pode presentear amigos.' });
    const K = KINDS[kind];
    const item = await findItem(prisma, kind, req.body?.id);
    if (!item || !item.active) return res.status(404).json({ error: 'Item não encontrado.' });
    if (await hiddenFromShop(prisma, item)) return res.status(403).json({ error: 'Esse item não está à venda na Loja.', code: 'NOT_FOR_SALE' });
    if (sup.exclusiveOf(item)) return res.status(403).json({ error: 'Itens exclusivos de apoio não podem ser presenteados.', code: 'EXCLUSIVE' });
    let price = null;
    const [sender, recipient] = await Promise.all([
      prisma.user.findUnique({ where: { id: fromId }, select: { displayName: true } }),
      prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, displayName: true } }),
    ]);
    if (!recipient) return res.status(404).json({ error: 'Amigo não encontrado.' });
    try {
      await prisma.$transaction(async (tx) => {
        const already = await tx[K.own].findUnique({ where: K.uniq(toUserId, item.id) });
        if (already && !already.expiresAt) throw fail(`${recipient.displayName} já tem esse item.`, 400, { code: 'ALREADY_OWNED' });
        // Quem paga é quem dá: o desconto de Assinante dele vale aqui.
        const p = sup.priceFor(item, currency, await tierOf(tx, fromId));
        if (p.final === null) throw fail('Esse item não é vendido nessa moeda.');
        checkExpected(req.body, p.final);
        price = p.final;
        if (price > 0) {
          const r = await tx.user.updateMany({ where: { id: fromId, [currency]: { gte: price } }, data: { [currency]: { decrement: price } } });
          if (r.count === 0) throw noFunds(currency);
        }
        if (already) await tx[K.own].update({ where: K.uniq(toUserId, item.id), data: { expiresAt: null } });
        else {
          const serial = await claimStock(tx, kind, item);
          await tx[K.own].create({ data: { userId: toUserId, [K.fk]: item.id, serial } });
        }
      });
    } catch (e) {
      if (e.status) return sendFail(res, e);
      if (e.code === 'P2002') return res.status(400).json({ error: `${recipient.displayName} já tem esse item.`, code: 'ALREADY_OWNED' });
      throw e;
    }
    const what = K.label;
    if (price > 0) ledger().recordTransaction(fromId, { kind: 'GIFT', label: `Presente para ${recipient.displayName}: ${what} ${item.name || ''}`.trim(), [currency]: -price });
    await require('../services/notices').createNotice(req.app.get('io'), toUserId, {
      kind: 'GIFT',
      title: `${sender?.displayName || 'Um amigo'} te deu um presente`,
      body: note ? `"${item.name}" — ${note}` : `"${item.name}" já está nos seus itens da Loja.`,
      link: '/loja',
      data: { fromUserId: fromId, itemKind: kind, itemId: item.id, itemName: item.name },
    });
    const me = await prisma.user.findUnique({ where: { id: fromId }, select: { coins: true, gems: true } });
    res.json({ ok: true, ...me });
  } catch (err) { next(err); }
}

module.exports = {
  purchaseHistory, giftItem, offerOf,
  shop, buyEffect, buyDecoration, buyFont, buyStyle, equipEffect, equipFont, equipStyle, buyCollection, usableItem, KINDS,
  kindOf, findItem, isLimited, claimStock, fontJson, styleKeyOf, parseData,
  adminListEffects, adminCreateEffect, adminUpdateEffect, adminRemoveEffect,
  adminListCollections, adminCreateCollection, adminUpdateCollection, adminRemoveCollection,
  effectJson, readShopFlags, SHOP_TAGS, SHOP_COLORS,
};
