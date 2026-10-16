const prisma = require('../config/prisma');
const { SELF_USER_FIELDS } = require('./authController');
const { broadcastUserUpdate } = require('./userController');
const shop = require('./shopController');
const sup = require('../services/supporters');
const { STYLE_KEYS } = require('../services/profileStyles');

// Loja (parte 3): fontes e estilos de perfil (ShopItem), staff dando itens
// pra alguém e itens limitados com estoque + trocas entre jogadores.

const { KINDS, kindOf, findItem, isLimited, claimStock, fontJson, styleKeyOf, parseData } = shop;
const fail = (msg, status = 400, extra) => Object.assign(new Error(msg), { status, extra });
const sendFail = (res, e) => res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
const ledger = () => require('../services/economyLedger');
const notices = () => require('../services/notices');
const intIn = (v, min, max) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; };
const priceOrNull = (v) => { if (v === undefined || v === null || v === '') return null; const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : null; };
const bool = (v) => v === true || v === 'true' || v === '1';
const fileOf = (req, name) => req.files?.[name]?.[0] || null;
// A prévia vem pelo mesmo upload da fonte (que aceita arquivos que não são
// imagem), então confere aqui que é imagem de verdade.
const previewOf = (req) => {
  const f = fileOf(req, 'preview');
  if (!f) return null;
  if (!/^image\/(png|jpe?g|gif|webp)$/i.test(f.mimetype || '')) throw fail('A prévia tem que ser uma imagem (PNG, JPG, GIF ou WebP).');
  return f;
};
const FONT_FILE_RE = /\.(woff2?|ttf|otf)$/i;
const FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 ]{1,59}$/;

function logStaff(req, action, targetId, metadata) {
  return prisma.platformAuditLog.create({
    data: { actorId: req.user.id, action, targetType: 'USER', targetId, metadata: metadata ? JSON.stringify(metadata) : null },
  }).catch(() => null);
}

// ---------- Google Fonts: acha o arquivo .ttf da família ----------
// O site carrega a fonte pelo CSS do Google Fonts; o app do celular precisa
// do arquivo em si. O CSS devolve TrueType quando o pedido vem de um
// navegador antigo — é só pegar o primeiro src: url(...).
async function resolveGoogleFontFile(family) {
  try {
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1)' }, signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!r.ok) return null;
    const css = await r.text();
    const m = css.match(/src:\s*url\((https:[^)]+)\)/);
    return m ? m[1] : null;
  } catch { return null; }
}

// ---------- Staff: fontes e estilos ----------
// GET /decorations/admin/items?kind=FONT|STYLE
async function adminListItems(req, res, next) {
  try {
    const kind = req.query.kind === 'STYLE' ? 'STYLE' : req.query.kind === 'FONT' ? 'FONT' : undefined;
    const items = await prisma.shopItem.findMany({
      where: kind ? { kind } : {},
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { owners: true } } },
    });
    res.json({ items: items.map((i) => ({ ...i, data: parseData(i.data) })), styleKeys: STYLE_KEYS });
  } catch (err) { next(err); }
}

function readItem(b) {
  const data = {};
  if (b.name !== undefined) data.name = String(b.name).trim().slice(0, 60);
  if (b.priceCoins !== undefined) data.priceCoins = priceOrNull(b.priceCoins);
  if (b.priceGems !== undefined) data.priceGems = priceOrNull(b.priceGems);
  if (b.active !== undefined) data.active = bool(b.active);
  if (b.sortOrder !== undefined) data.sortOrder = parseInt(b.sortOrder, 10) || 0;
  if (b.collectionId !== undefined) data.collectionId = b.collectionId && b.collectionId !== 'null' ? String(b.collectionId) : null;
  Object.assign(data, shop.readShopFlags(b));
  return data;
}

// Monta o "data" da fonte: arquivo enviado (vale ele) ou família do Google Fonts.
async function fontData(req, prev = {}) {
  const b = req.body || {};
  const file = fileOf(req, 'font');
  const family = b.family !== undefined ? String(b.family).trim() : prev.family;
  if (file) {
    if (!FONT_FILE_RE.test(file.originalname || '') && !FONT_FILE_RE.test(file.url || '')) throw fail('O arquivo da fonte tem que ser .woff2, .woff, .ttf ou .otf.');
    return { family: family && FAMILY_RE.test(family) ? family : `PCFont${Date.now().toString(36)}`, url: file.url, source: 'file' };
  }
  if (!family || !FAMILY_RE.test(family)) throw fail('Escreva o nome da fonte do Google Fonts (ex.: Creepster) ou envie o arquivo da fonte.');
  if (prev.source === 'google' && prev.family === family && prev.url) return prev;
  const url = await resolveGoogleFontFile(family);
  if (!url) throw fail(`Não achei a fonte "${family}" no Google Fonts. Confira o nome (igual aparece no site do Google Fonts).`);
  return { family, url, source: 'google' };
}

// Quem está usando a fonte/estilo recebe a versão nova (ou perde, se apagou).
async function syncEquipped(req, item, removed = false) {
  const where = item.kind === 'FONT' ? { profileFont: { contains: `"id":"${item.id}"` } } : { profileStyle: styleKeyOf(item) };
  const users = await prisma.user.findMany({ where, select: { id: true } });
  if (!users.length) return;
  const value = removed ? null : item.kind === 'FONT' ? fontJson(item) : styleKeyOf(item);
  // Estilo apagado/desativado continua com quem já tem (é dele); só some se apagar o item.
  if (item.kind === 'STYLE' && !removed) return;
  await prisma.user.updateMany({ where: { id: { in: users.map((u) => u.id) } }, data: item.kind === 'FONT' ? { profileFont: value } : { profileStyle: value } });
  for (const { id } of users.slice(0, 200)) {
    const user = await prisma.user.findUnique({ where: { id }, select: SELF_USER_FIELDS });
    if (user) await broadcastUserUpdate(req, user).catch(() => {});
  }
}

async function adminCreateItem(req, res, next) {
  try {
    const kind = req.body?.kind === 'STYLE' ? 'STYLE' : 'FONT';
    if (kind === 'STYLE') return res.status(400).json({ error: 'Os estilos de perfil já vêm prontos — é só editar (ativar, preço, coleção).' });
    const data = readItem(req.body || {});
    if (!data.name) return res.status(400).json({ error: 'Dê um nome pra fonte.' });
    const preview = previewOf(req);
    if (preview) data.previewUrl = preview.url;
    const item = await prisma.shopItem.create({ data: { ...data, kind, data: JSON.stringify(await fontData(req)) } });
    res.status(201).json({ item: { ...item, data: parseData(item.data) } });
  } catch (err) {
    if (err.status) return sendFail(res, err);
    next(err);
  }
}

async function adminUpdateItem(req, res, next) {
  try {
    const prev = await prisma.shopItem.findUnique({ where: { id: req.params.id } });
    if (!prev) return res.status(404).json({ error: 'Item não encontrado.' });
    const data = readItem(req.body || {});
    const preview = previewOf(req);
    if (preview) data.previewUrl = preview.url;
    if (bool(req.body?.removePreview)) data.previewUrl = null;
    if (prev.kind === 'FONT' && (fileOf(req, 'font') || req.body?.family !== undefined)) data.data = JSON.stringify(await fontData(req, parseData(prev.data)));
    // Estoque não pode ficar menor que o que já foi vendido.
    if (data.stock != null && data.stock < prev.sold) data.stock = prev.sold;
    const item = await prisma.shopItem.update({ where: { id: prev.id }, data });
    if (item.kind === 'FONT') await syncEquipped(req, item);
    res.json({ item: { ...item, data: parseData(item.data) } });
  } catch (err) {
    if (err.status) return sendFail(res, err);
    next(err);
  }
}

async function adminRemoveItem(req, res, next) {
  try {
    const item = await prisma.shopItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
    if (item.key) return res.status(400).json({ error: 'Os estilos embutidos não podem ser apagados — desative pra tirar da Loja.' });
    await syncEquipped(req, item, true);
    await prisma.shopItem.delete({ where: { id: item.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ---------- Staff: dar item pra alguém ----------
// GET /decorations/admin/catalog — todos os itens (ativos ou não) pra escolher.
async function adminCatalog(req, res, next) {
  try {
    const sel = { id: true, name: true, active: true, stock: true, sold: true, priceCoins: true, priceGems: true };
    const [decos, effects, items] = await Promise.all([
      prisma.avatarDecoration.findMany({ select: { ...sel, imageUrl: true }, orderBy: { name: 'asc' } }),
      prisma.profileEffect.findMany({ select: { ...sel, imageUrl: true }, orderBy: { name: 'asc' } }),
      prisma.shopItem.findMany({ select: { ...sel, kind: true, previewUrl: true, data: true }, orderBy: { name: 'asc' } }),
    ]);
    res.json({
      items: [
        ...decos.map((d) => ({ ...d, kind: 'deco' })),
        ...effects.map((e) => ({ ...e, kind: 'effect' })),
        ...items.map((i) => ({ ...i, kind: i.kind === 'FONT' ? 'font' : 'style', data: parseData(i.data) })),
      ],
    });
  } catch (err) { next(err); }
}

// POST /decorations/admin/grant { kind, itemId, userId, note, force }
// Dá o item de graça (sem cobrar). Limitado gasta uma cópia do estoque;
// se esgotou, só com "force" (cria uma cópia extra e aumenta o estoque).
async function adminGrant(req, res, next) {
  try {
    const kind = kindOf(req.body?.kind);
    const userId = String(req.body?.userId || '');
    const note = String(req.body?.note || '').trim().slice(0, 200);
    if (!kind) return res.status(400).json({ error: 'Tipo de item inválido.' });
    const K = KINDS[kind];
    const [item, target] = await Promise.all([
      findItem(prisma, kind, req.body?.itemId),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true, username: true } }),
    ]);
    if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    let serial = null;
    try {
      await prisma.$transaction(async (tx) => {
        const already = await tx[K.own].findUnique({ where: K.uniq(userId, item.id) });
        if (already) throw fail(`${target.displayName || target.username} já tem esse item.`, 400, { code: 'ALREADY_OWNED' });
        try {
          serial = await claimStock(tx, kind, item);
        } catch (e) {
          if (e.extra?.code !== 'SOLD_OUT' || !bool(req.body?.force)) throw e;
          await tx[K.item].update({ where: { id: item.id }, data: { stock: { increment: 1 }, sold: { increment: 1 } } });
          serial = (await tx[K.item].findUnique({ where: { id: item.id }, select: { sold: true } })).sold;
        }
        await tx[K.own].create({ data: { userId, [K.fk]: item.id, serial } });
      });
    } catch (e) {
      if (e.status) return sendFail(res, e);
      if (e.code === 'P2002') return res.status(400).json({ error: 'Essa pessoa já tem esse item.', code: 'ALREADY_OWNED' });
      throw e;
    }
    await logStaff(req, 'SHOP_GRANT', userId, { kind, itemId: item.id, itemName: item.name, serial, note: note || undefined });
    await notices().createNotice(req.app.get('io'), userId, {
      kind: 'GIFT',
      title: 'A equipe te deu um item da Loja',
      body: `"${item.name}"${serial ? ` (#${serial})` : ''} já está nos seus itens.${note ? ` ${note}` : ''}`,
      link: '/loja',
      data: { itemKind: kind, itemId: item.id, itemName: item.name, fromStaff: true },
    }).catch(() => null);
    res.json({ ok: true, serial });
  } catch (err) { next(err); }
}

// DELETE /decorations/admin/grant { kind, itemId, userId } — tira o item (ex.: dado por engano).
async function adminRevoke(req, res, next) {
  try {
    const kind = kindOf(req.body?.kind);
    const userId = String(req.body?.userId || '');
    if (!kind) return res.status(400).json({ error: 'Tipo de item inválido.' });
    const K = KINDS[kind];
    const item = await findItem(prisma, kind, req.body?.itemId);
    if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
    const r = await prisma[K.own].deleteMany({ where: { userId, [K.fk]: item.id } });
    if (!r.count) return res.status(404).json({ error: 'Essa pessoa não tem esse item.' });
    await unequipIfLost(req, userId, kind, item);
    await logStaff(req, 'SHOP_REVOKE', userId, { kind, itemId: item.id, itemName: item.name });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ---------- Itens limitados ----------
// Desequipa o item de quem deixou de ter (troca, staff tirou...), a não
// ser que ainda possa usar pela categoria de apoio.
async function unequipIfLost(req, userId, kind, item, db = prisma) {
  const still = await shop.usableItem(kind, userId, item.id);
  if (still) return;
  const u = await db.user.findUnique({ where: { id: userId }, select: { avatarDecoration: true, profileEffect: true, profileFont: true, profileStyle: true } });
  if (!u) return;
  const has = (raw) => !!raw && raw.includes(`"id":"${item.id}"`);
  const data = {};
  if (kind === 'deco' && has(u.avatarDecoration)) data.avatarDecoration = null;
  if (kind === 'effect' && has(u.profileEffect)) data.profileEffect = null;
  if (kind === 'font' && has(u.profileFont)) data.profileFont = null;
  if (kind === 'style' && u.profileStyle && u.profileStyle === styleKeyOf(item)) data.profileStyle = null;
  if (!Object.keys(data).length) return;
  const user = await db.user.update({ where: { id: userId }, data, select: SELF_USER_FIELDS });
  if (req) await broadcastUserUpdate(req, user).catch(() => {});
}

const ITEM_SELECT = {
  deco: { id: true, name: true, imageUrl: true, stock: true, sold: true, priceCoins: true, priceGems: true },
  effect: { id: true, name: true, imageUrl: true, stock: true, sold: true, priceCoins: true, priceGems: true },
  font: { id: true, name: true, previewUrl: true, data: true, kind: true, stock: true, sold: true, priceCoins: true, priceGems: true },
};
ITEM_SELECT.style = ITEM_SELECT.font;

// Itens limitados de alguém (com número de série) — pra montar uma troca.
async function limitedsOf(userId) {
  const [d, e, i] = await Promise.all([
    prisma.userAvatarDecoration.findMany({ where: { userId, decoration: { stock: { not: null } } }, include: { decoration: { select: ITEM_SELECT.deco } } }),
    prisma.userProfileEffect.findMany({ where: { userId, effect: { stock: { not: null } } }, include: { effect: { select: ITEM_SELECT.effect } } }),
    prisma.userShopItem.findMany({ where: { userId, item: { stock: { not: null } } }, include: { item: { select: ITEM_SELECT.font } } }),
  ]);
  const shape = (kind, it, serial) => ({
    kind, id: it.id, name: it.name, serial, stock: it.stock, sold: it.sold,
    imageUrl: it.imageUrl || it.previewUrl || null,
    ...(it.data !== undefined ? { data: parseData(it.data) } : {}),
  });
  return [
    ...d.map((o) => shape('deco', o.decoration, o.serial)),
    ...e.map((o) => shape('effect', o.effect, o.serial)),
    ...i.map((o) => shape(o.item.kind === 'FONT' ? 'font' : 'style', o.item, o.serial)),
  ];
}

// GET /decorations/limiteds/:userId ("me" = você)
async function listLimiteds(req, res, next) {
  try {
    const userId = req.params.userId === 'me' ? req.user.id : String(req.params.userId);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, displayName: true, avatarUrl: true } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json({ user, items: await limitedsOf(userId) });
  } catch (err) { next(err); }
}

// ---------- Trocas ----------
const MAX_ITEMS_SIDE = 8;
const MAX_PENDING = 20;
const MAX_CURRENCY = 10_000_000;

function readSide(raw) {
  const side = raw && typeof raw === 'object' ? raw : {};
  const items = Array.isArray(side.items) ? side.items : [];
  const seen = new Set();
  const out = [];
  for (const it of items.slice(0, MAX_ITEMS_SIDE + 1)) {
    const kind = kindOf(it?.kind);
    const id = String(it?.id || '');
    if (!kind || !id || seen.has(`${kind}:${id}`)) continue;
    seen.add(`${kind}:${id}`);
    out.push({ kind, id });
  }
  if (out.length > MAX_ITEMS_SIDE) throw fail(`No máximo ${MAX_ITEMS_SIDE} itens de cada lado.`);
  return { items: out, coins: intIn(side.coins || 0, 0, MAX_CURRENCY), gems: intIn(side.gems || 0, 0, MAX_CURRENCY) };
}
const sideEmpty = (s) => !s.items.length && !s.coins && !s.gems;

// Confere que "userId" tem todos os itens da lista e que todos são limitados.
async function checkOwns(db, userId, items, who) {
  for (const { kind, id } of items) {
    const K = KINDS[kind];
    const item = await findItem(db, kind, id);
    if (!item) throw fail('Um dos itens da troca não existe mais.');
    if (!isLimited(item)) throw fail(`"${item.name}" não é um item limitado — só limitados podem ser trocados.`);
    const own = await db[K.own].findUnique({ where: K.uniq(userId, id) });
    if (!own) throw fail(`${who} não tem mais "${item.name}".`, 409, { code: 'NOT_OWNED' });
  }
}

// Detalhes dos itens pra mostrar a troca.
async function hydrate(items, ownerId) {
  const out = [];
  for (const { kind, id } of items) {
    const K = KINDS[kind];
    const [it, own] = await Promise.all([
      prisma[K.item].findUnique({ where: { id }, select: ITEM_SELECT[kind] }),
      ownerId ? prisma[K.own].findUnique({ where: K.uniq(ownerId, id), select: { serial: true } }) : null,
    ]);
    out.push({ kind, id, name: it?.name || 'Item removido', imageUrl: it?.imageUrl || it?.previewUrl || null, data: it?.data ? parseData(it.data) : undefined, stock: it?.stock ?? null, serial: own?.serial ?? null });
  }
  return out;
}

const USER_MINI = { id: true, username: true, displayName: true, avatarUrl: true, avatarDecoration: true };
async function shapeTrade(t, users) {
  const offer = parseData(t.offer);
  const request = parseData(t.request);
  const live = t.status === 'PENDING';
  return {
    id: t.id, status: t.status, message: t.message, createdAt: t.createdAt, respondedAt: t.respondedAt,
    from: users[t.fromUserId] || null, to: users[t.toUserId] || null,
    offer: { ...offer, items: await hydrate(offer.items || [], live ? t.fromUserId : null) },
    request: { ...request, items: await hydrate(request.items || [], live ? t.toUserId : null) },
  };
}

// GET /decorations/trades — recebidas, enviadas e histórico.
async function listTrades(req, res, next) {
  try {
    const me = req.user.id;
    const rows = await prisma.itemTrade.findMany({
      where: { OR: [{ fromUserId: me }, { toUserId: me }] }, orderBy: { createdAt: 'desc' }, take: 60,
    });
    const ids = [...new Set(rows.flatMap((t) => [t.fromUserId, t.toUserId]))];
    const people = await prisma.user.findMany({ where: { id: { in: ids } }, select: USER_MINI });
    const users = Object.fromEntries(people.map((u) => [u.id, u]));
    const shaped = await Promise.all(rows.map((t) => shapeTrade(t, users)));
    res.json({
      incoming: shaped.filter((t) => t.status === 'PENDING' && t.to?.id === me),
      outgoing: shaped.filter((t) => t.status === 'PENDING' && t.from?.id === me),
      history: shaped.filter((t) => t.status !== 'PENDING').slice(0, 30),
    });
  } catch (err) { next(err); }
}

// POST /decorations/trades { toUserId, offer, request, message }
async function createTrade(req, res, next) {
  try {
    const fromId = req.user.id;
    const toId = String(req.body?.toUserId || '');
    if (!toId || toId === fromId) return res.status(400).json({ error: 'Escolha com quem trocar.' });
    const offer = readSide(req.body?.offer);
    const request = readSide(req.body?.request);
    if (sideEmpty(offer) || sideEmpty(request)) return res.status(400).json({ error: 'Os dois lados da troca precisam ter alguma coisa.' });
    if (!offer.items.length && !request.items.length) return res.status(400).json({ error: 'Uma troca precisa de pelo menos um item limitado.' });
    const message = String(req.body?.message || '').trim().slice(0, 300) || null;
    const target = await prisma.user.findUnique({ where: { id: toId }, select: { id: true, displayName: true } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const pending = await prisma.itemTrade.count({ where: { fromUserId: fromId, status: 'PENDING' } });
    if (pending >= MAX_PENDING) return res.status(429).json({ error: `Você já tem ${MAX_PENDING} trocas esperando resposta. Cancele alguma antes.` });
    await checkOwns(prisma, fromId, offer.items, 'Você');
    await checkOwns(prisma, toId, request.items, target.displayName || 'Essa pessoa');
    const wallet = await prisma.user.findUnique({ where: { id: fromId }, select: { coins: true, gems: true, displayName: true } });
    if (wallet.coins < offer.coins) throw fail('Você não tem moedas suficientes pra essa oferta.', 400, { code: 'INSUFFICIENT_FUNDS' });
    if (wallet.gems < offer.gems) throw fail('Você não tem gemas suficientes pra essa oferta.', 400, { code: 'INSUFFICIENT_FUNDS' });
    const trade = await prisma.itemTrade.create({
      data: { fromUserId: fromId, toUserId: toId, offer: JSON.stringify(offer), request: JSON.stringify(request), message },
    });
    await notices().createNotice(req.app.get('io'), toId, {
      kind: 'TRADE', title: `${wallet.displayName || 'Alguém'} te mandou uma proposta de troca`,
      body: message || 'Abra a Loja → Trocas pra ver o que foi oferecido.', link: '/loja?tab=trocas', data: { tradeId: trade.id },
    }).catch(() => null);
    req.app.get('io')?.to(`user:${toId}`).emit('trade:update', { id: trade.id, status: 'PENDING' });
    res.status(201).json({ ok: true, id: trade.id });
  } catch (err) {
    if (err.status) return sendFail(res, err);
    next(err);
  }
}

// Muda o status só se ainda estiver pendente (duas respostas ao mesmo tempo não passam).
async function closeTrade(req, res, next, { by, status, verb }) {
  try {
    const t = await prisma.itemTrade.findUnique({ where: { id: req.params.id } });
    if (!t || t[by] !== req.user.id) return res.status(404).json({ error: 'Troca não encontrada.' });
    const r = await prisma.itemTrade.updateMany({ where: { id: t.id, status: 'PENDING' }, data: { status, respondedAt: new Date() } });
    if (!r.count) return res.status(409).json({ error: 'Essa troca já foi respondida.' });
    const other = by === 'toUserId' ? t.fromUserId : t.toUserId;
    req.app.get('io')?.to(`user:${other}`).emit('trade:update', { id: t.id, status });
    if (status === 'DECLINED') {
      await notices().createNotice(req.app.get('io'), other, { kind: 'TRADE', title: `Sua proposta de troca foi ${verb}`, link: '/loja?tab=trocas', data: { tradeId: t.id } }).catch(() => null);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
}
const declineTrade = (req, res, next) => closeTrade(req, res, next, { by: 'toUserId', status: 'DECLINED', verb: 'recusada' });
const cancelTrade = (req, res, next) => closeTrade(req, res, next, { by: 'fromUserId', status: 'CANCELLED', verb: 'cancelada' });

// POST /decorations/trades/:id/accept — confere tudo de novo e troca de uma vez.
async function acceptTrade(req, res, next) {
  try {
    const t = await prisma.itemTrade.findUnique({ where: { id: req.params.id } });
    if (!t || t.toUserId !== req.user.id) return res.status(404).json({ error: 'Troca não encontrada.' });
    if (t.status !== 'PENDING') return res.status(409).json({ error: 'Essa troca já foi respondida.' });
    const offer = readSide(parseData(t.offer));
    const request = readSide(parseData(t.request));
    const fromId = t.fromUserId;
    const toId = t.toUserId;
    const moved = [];
    try {
      await prisma.$transaction(async (tx) => {
        const lock = await tx.itemTrade.updateMany({ where: { id: t.id, status: 'PENDING' }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
        if (!lock.count) throw fail('Essa troca já foi respondida.', 409);
        await checkOwns(tx, fromId, offer.items, 'Quem propôs');
        await checkOwns(tx, toId, request.items, 'Você');
        const move = async (items, from, to) => {
          for (const { kind, id } of items) {
            const K = KINDS[kind];
            const dup = await tx[K.own].findUnique({ where: K.uniq(to, id) });
            if (dup) throw fail('Um dos lados já tem uma cópia de um item da troca.', 409, { code: 'ALREADY_OWNED' });
            const own = await tx[K.own].findUnique({ where: K.uniq(from, id) });
            await tx[K.own].update({ where: { id: own.id }, data: { userId: to } });
            moved.push({ kind, id, from });
          }
        };
        await move(offer.items, fromId, toId);
        await move(request.items, toId, fromId);
        const pay = async (payer, payee, side) => {
          for (const cur of ['coins', 'gems']) {
            if (!side[cur]) continue;
            const r = await tx.user.updateMany({ where: { id: payer, [cur]: { gte: side[cur] } }, data: { [cur]: { decrement: side[cur] } } });
            if (!r.count) throw fail(payer === toId ? `Você não tem ${cur === 'gems' ? 'gemas' : 'moedas'} suficientes.` : `Quem propôs não tem mais ${cur === 'gems' ? 'gemas' : 'moedas'} suficientes.`, 400, { code: 'INSUFFICIENT_FUNDS' });
            await tx.user.update({ where: { id: payee }, data: { [cur]: { increment: side[cur] } } });
          }
        };
        await pay(fromId, toId, offer);
        await pay(toId, fromId, request);
      });
    } catch (e) {
      if (e.status) {
        // Não deu pra trocar (alguém não tem mais o item/saldo): a troca fica inválida.
        if (e.status !== 409 || e.extra?.code) await prisma.itemTrade.updateMany({ where: { id: t.id, status: 'PENDING' }, data: { status: 'FAILED', respondedAt: new Date() } });
        return sendFail(res, e);
      }
      throw e;
    }
    // Quem deu um item que estava usando, deixa de usar.
    for (const m of moved) {
      const item = await findItem(prisma, m.kind, m.id);
      if (item) await unequipIfLost(req, m.from, m.kind, item).catch(() => {});
    }
    // Outras propostas pendentes com esses itens deixam de valer.
    const movedKeys = new Set(moved.map((m) => `${m.kind}:${m.id}`));
    const others = await prisma.itemTrade.findMany({ where: { status: 'PENDING', OR: [{ fromUserId: { in: [fromId, toId] } }, { toUserId: { in: [fromId, toId] } }] } });
    for (const o of others) {
      const all = [...(parseData(o.offer).items || []), ...(parseData(o.request).items || [])];
      if (all.some((i) => movedKeys.has(`${i.kind}:${i.id}`))) {
        await prisma.itemTrade.updateMany({ where: { id: o.id, status: 'PENDING' }, data: { status: 'FAILED', respondedAt: new Date() } });
      }
    }
    const label = 'Troca de itens limitados';
    ledger().recordTransaction(fromId, { kind: 'TRADE', label, coins: request.coins - offer.coins, gems: request.gems - offer.gems });
    ledger().recordTransaction(toId, { kind: 'TRADE', label, coins: offer.coins - request.coins, gems: offer.gems - request.gems });
    const me = await prisma.user.findUnique({ where: { id: toId }, select: { displayName: true, coins: true, gems: true } });
    await notices().createNotice(req.app.get('io'), fromId, {
      kind: 'TRADE', title: `${me?.displayName || 'Alguém'} aceitou sua troca`, body: 'Os itens já estão no seu inventário.', link: '/loja?tab=trocas', data: { tradeId: t.id },
    }).catch(() => null);
    req.app.get('io')?.to(`user:${fromId}`).emit('trade:update', { id: t.id, status: 'ACCEPTED' });
    res.json({ ok: true, coins: me?.coins, gems: me?.gems });
  } catch (err) { next(err); }
}

module.exports = {
  adminListItems, adminCreateItem, adminUpdateItem, adminRemoveItem,
  adminCatalog, adminGrant, adminRevoke,
  listLimiteds, listTrades, createTrade, acceptTrade, declineTrade, cancelTrade,
  limitedsOf, unequipIfLost, resolveGoogleFontFile,
};
