// Loja dos criadores (Fase 8).
//
// Membros enviam criações (emoji, figurinha ou moldura de avatar) com nome e
// preço em moedas. A equipe aprova ou recusa (com motivo). Itens aprovados
// aparecem na "Loja dos criadores": quem compra paga o preço cheio e o
// criador recebe o preço menos a taxa da plataforma (FEE_PERCENT), tudo numa
// transação só. Ninguém compra o próprio item nem o mesmo item duas vezes.
//
// Depois de comprado:
//  - EMOJI: entra na lista de emojis usáveis da pessoa (emojiController
//    .listUsableEmojis) e todo mundo enxerga ele renderizado no chat
//    (mapa público /api/creator-shop/emoji-map);
//  - STICKER: aparece na seção "Loja dos criadores" do seletor de figurinhas;
//  - FRAME: vira posse de moldura (UserAvatarDecoration) — a moldura aprovada
//    é uma AvatarDecoration numa coleção OCULTA da Loja, então só quem tem
//    enxerga e equipa, pelo mesmo fluxo de sempre.
const getPrisma = () => require('../config/prisma');

const KINDS = ['EMOJI', 'STICKER', 'FRAME'];
const KIND_LABEL = { EMOJI: 'emoji', STICKER: 'figurinha', FRAME: 'moldura' };
const PRICE_MIN = 10;
const PRICE_MAX = 5000;
const FEE_PERCENT = 10;
const MAX_PENDING = 5;
const MAX_BYTES = { EMOJI: 512 * 1024, STICKER: 1024 * 1024, FRAME: 2 * 1024 * 1024 };
const MIME_OK = ['image/png', 'image/gif', 'image/webp', 'image/jpeg'];
const HIDDEN_COLLECTION_NAME = 'Loja dos criadores';
const STAFF_ROLES = ['ADMIN', 'MODERATOR'];

class CreatorShopError extends Error {
  constructor(message, status = 400, code = 'CREATOR_SHOP') { super(message); this.status = status; this.code = code; }
}

const isStaff = (user) => STAFF_ROLES.includes(user?.platformRole);

// Taxa sempre arredondada pra cima (mínimo 1 moeda em qualquer preço válido).
function computeFee(price) {
  const p = Math.max(0, Math.trunc(price) || 0);
  const fee = Math.min(p, Math.ceil((p * FEE_PERCENT) / 100));
  return { price: p, fee, creatorShare: p - fee };
}

function sanitizeItemName(kind, raw) {
  if (kind === 'EMOJI') {
    const name = String(raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 32);
    return /^[a-z0-9_]{2,32}$/.test(name) ? name : null;
  }
  const name = String(raw || '').replace(/[^\p{L}\p{N} _'!.-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 32).trim();
  return name.length >= 2 ? name : null;
}

// Valida o envio (puro): devolve { kind, name, price, description }.
function validateSubmission({ kind, name, price, description, file }) {
  const k = String(kind || '').toUpperCase();
  if (!KINDS.includes(k)) throw new CreatorShopError('Tipo inválido. Escolha emoji, figurinha ou moldura.');
  if (!file?.url) throw new CreatorShopError('Envie a imagem da criação.');
  if (file.mimetype && !MIME_OK.includes(file.mimetype)) throw new CreatorShopError('Formato não aceito. Use PNG, GIF, WebP ou JPG.');
  if (Number(file.size) > MAX_BYTES[k]) throw new CreatorShopError(`Imagem grande demais: ${KIND_LABEL[k]} pode ter até ${Math.round(MAX_BYTES[k] / 1024)} KB.`, 413, 'TOO_BIG');
  const clean = sanitizeItemName(k, name);
  if (!clean) throw new CreatorShopError(k === 'EMOJI' ? 'Nome do emoji: 2 a 32 letras minúsculas, números ou _.' : 'O nome precisa ter de 2 a 32 caracteres.');
  const p = Number(price);
  if (!Number.isInteger(p) || p < PRICE_MIN || p > PRICE_MAX) throw new CreatorShopError(`O preço precisa ser um número inteiro entre ${PRICE_MIN} e ${PRICE_MAX} moedas.`);
  const desc = description ? String(description).replace(/\s+/g, ' ').trim().slice(0, 200) : null;
  return { kind: k, name: clean, price: p, description: desc || null };
}

// Regras de compra (puras) — o banco confirma de novo dentro da transação.
function checkCanBuy({ item, buyerId, alreadyOwned, coins }) {
  if (!item || item.status !== 'APPROVED') throw new CreatorShopError('Item não encontrado.', 404, 'NOT_FOUND');
  if (item.creatorId === buyerId) throw new CreatorShopError('Você não pode comprar a sua própria criação.', 403, 'OWN_ITEM');
  if (alreadyOwned) throw new CreatorShopError('Você já tem esse item.', 409, 'ALREADY_OWNED');
  if (coins !== undefined && coins < item.priceCoins) throw new CreatorShopError('Moedas insuficientes.', 402, 'NO_COINS');
  return computeFee(item.priceCoins);
}

async function emojiNameTaken(db, name, exceptId = null) {
  const [base, creator] = await Promise.all([
    db.emoji.findUnique({ where: { name } }).catch(() => null),
    db.creatorItem.findFirst({ where: { kind: 'EMOJI', name, status: { in: ['PENDING', 'APPROVED'] }, ...(exceptId ? { NOT: { id: exceptId } } : {}) } }),
  ]);
  return !!(base || creator);
}

async function submit(userId, body, file, { db = getPrisma() } = {}) {
  const data = validateSubmission({ ...body, file });
  const pending = await db.creatorItem.count({ where: { creatorId: userId, status: 'PENDING' } });
  if (pending >= MAX_PENDING) throw new CreatorShopError(`Você já tem ${MAX_PENDING} criações esperando aprovação. Aguarde a equipe revisar.`, 429, 'TOO_MANY_PENDING');
  if (data.kind === 'EMOJI' && await emojiNameTaken(db, data.name)) throw new CreatorShopError('Já existe um emoji com esse nome. Escolha outro.', 409, 'NAME_TAKEN');
  return db.creatorItem.create({
    data: { creatorId: userId, kind: data.kind, name: data.name, description: data.description, imageUrl: file.url, priceCoins: data.price },
  });
}

const CREATOR_SELECT = { id: true, displayName: true, username: true, avatarUrl: true };

async function attachCreators(db, items) {
  const ids = [...new Set(items.map((i) => i.creatorId))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: CREATOR_SELECT }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return items.map((i) => ({ ...i, creator: byId.get(i.creatorId) || { id: i.creatorId, displayName: 'Alguém' } }));
}

async function listApproved(viewerId, { kind, q, sort } = {}, { db = getPrisma() } = {}) {
  const where = { status: 'APPROVED' };
  if (KINDS.includes(String(kind || '').toUpperCase())) where.kind = String(kind).toUpperCase();
  if (q) where.name = { contains: String(q).slice(0, 40) };
  const orderBy = sort === 'populares' ? [{ sales: 'desc' }, { createdAt: 'desc' }]
    : sort === 'preco' ? [{ priceCoins: 'asc' }, { createdAt: 'desc' }]
      : [{ reviewedAt: 'desc' }, { createdAt: 'desc' }];
  const [items, owned, me] = await Promise.all([
    db.creatorItem.findMany({ where, orderBy, take: 200 }),
    db.creatorPurchase.findMany({ where: { buyerId: viewerId }, select: { itemId: true } }),
    db.user.findUnique({ where: { id: viewerId }, select: { coins: true } }),
  ]);
  const ownedSet = new Set(owned.map((o) => o.itemId));
  const shaped = (await attachCreators(db, items)).map((i) => ({
    id: i.id, kind: i.kind, name: i.name, description: i.description, imageUrl: i.imageUrl, priceCoins: i.priceCoins,
    sales: i.sales, creator: i.creator, owned: ownedSet.has(i.id), mine: i.creatorId === viewerId,
  }));
  return { items: shaped, coins: me?.coins ?? 0, feePercent: FEE_PERCENT };
}

// Itens que a pessoa pode USAR: comprados + as próprias criações aprovadas.
async function usableItems(userId, kind, { db = getPrisma() } = {}) {
  const purchases = await db.creatorPurchase.findMany({ where: { buyerId: userId }, select: { itemId: true } });
  const items = await db.creatorItem.findMany({
    where: { kind, status: 'APPROVED', OR: [{ id: { in: purchases.map((p) => p.itemId) } }, { creatorId: userId }] },
    orderBy: { name: 'asc' },
  });
  return items.map((i) => ({ id: i.id, name: i.name, url: i.imageUrl }));
}

// Emojis da loja no formato que o seletor de emoji já entende.
async function usableEmojisFor(userId, opts = {}) {
  const list = await usableItems(userId, 'EMOJI', opts);
  return list.map((e) => ({ id: `criador-${e.id}`, name: e.name, url: e.url, category: HIDDEN_COLLECTION_NAME, collectionId: null, allowedRoleId: null, creatorShop: true }));
}

async function publicEmojiMap({ db = getPrisma() } = {}) {
  const items = await db.creatorItem.findMany({ where: { kind: 'EMOJI', status: 'APPROVED' }, select: { name: true, imageUrl: true } });
  return items.map((i) => ({ name: i.name, url: i.imageUrl }));
}

async function mine(userId, { db = getPrisma() } = {}) {
  const [submissions, purchases] = await Promise.all([
    db.creatorItem.findMany({ where: { creatorId: userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.creatorPurchase.findMany({ where: { buyerId: userId }, orderBy: { createdAt: 'desc' }, take: 200 }),
  ]);
  const bought = purchases.length ? await db.creatorItem.findMany({ where: { id: { in: purchases.map((p) => p.itemId) } } }) : [];
  const earnings = submissions.reduce((s, i) => s + (i.earnings || 0), 0);
  return {
    submissions, earnings, feePercent: FEE_PERCENT, maxPending: MAX_PENDING,
    purchases: (await attachCreators(db, bought)).map((i) => ({ id: i.id, kind: i.kind, name: i.name, imageUrl: i.imageUrl, status: i.status, creator: i.creator })),
  };
}

// Compra atômica. `notify` avisa o criador (fora da transação).
async function buy(buyerId, itemId, { db = getPrisma(), ledger = () => require('./economyLedger'), notify = null } = {}) {
  let result;
  try {
    result = await db.$transaction(async (tx) => {
      const item = await tx.creatorItem.findUnique({ where: { id: itemId } });
      const dup = item ? await tx.creatorPurchase.findUnique({ where: { itemId_buyerId: { itemId, buyerId } } }) : null;
      const { price, fee, creatorShare } = checkCanBuy({ item, buyerId, alreadyOwned: !!dup });
      const paid = await tx.user.updateMany({ where: { id: buyerId, coins: { gte: price } }, data: { coins: { decrement: price } } });
      if (!paid.count) throw new CreatorShopError('Moedas insuficientes.', 402, 'NO_COINS');
      await tx.creatorPurchase.create({ data: { itemId, buyerId, pricePaid: price, fee } });
      if (creatorShare > 0) await tx.user.updateMany({ where: { id: item.creatorId }, data: { coins: { increment: creatorShare } } });
      await tx.creatorItem.update({ where: { id: itemId }, data: { sales: { increment: 1 }, earnings: { increment: creatorShare } } });
      if (item.kind === 'FRAME' && item.decorationId) {
        await tx.userAvatarDecoration.upsert({
          where: { userId_decorationId: { userId: buyerId, decorationId: item.decorationId } },
          create: { userId: buyerId, decorationId: item.decorationId }, update: {},
        });
      }
      return { item, price, fee, creatorShare };
    });
  } catch (err) {
    if (err?.code === 'P2002') throw new CreatorShopError('Você já tem esse item.', 409, 'ALREADY_OWNED');
    throw err;
  }
  const { item, price, creatorShare } = result;
  const L = ledger();
  L.recordTransaction(buyerId, { kind: 'CREATOR_SHOP', label: `Loja dos criadores: ${KIND_LABEL[item.kind]} ${item.name}`, coins: -price });
  if (creatorShare > 0) L.recordTransaction(item.creatorId, { kind: 'CREATOR_SALE', label: `Venda na Loja dos criadores: ${item.name}`, coins: creatorShare });
  if (notify) {
    Promise.resolve(notify(item.creatorId, {
      kind: 'CREATOR_SALE', title: `Sua criação "${item.name}" foi vendida!`,
      body: `Você recebeu ${creatorShare} moedas (preço ${price}, taxa de ${FEE_PERCENT}%).`, link: '/loja/criadores?aba=minhas',
    })).catch(() => {});
  }
  return result;
}

// Coleção oculta onde ficam as molduras aprovadas.
async function hiddenCollectionId(db) {
  const found = await db.shopCollection.findFirst({ where: { name: HIDDEN_COLLECTION_NAME, showInShop: false }, select: { id: true } });
  if (found) return found.id;
  const created = await db.shopCollection.create({
    data: { name: HIDDEN_COLLECTION_NAME, description: 'Molduras criadas pelos membros (vendidas na Loja dos criadores).', showInShop: false, featured: false, active: true },
  });
  return created.id;
}

async function review(staffUser, itemId, { approve, reason } = {}, { db = getPrisma(), notify = null } = {}) {
  if (!isStaff(staffUser)) throw new CreatorShopError('Só a equipe pode revisar criações.', 403, 'FORBIDDEN');
  const item = await db.creatorItem.findUnique({ where: { id: itemId } });
  if (!item) throw new CreatorShopError('Item não encontrado.', 404, 'NOT_FOUND');
  if (item.status !== 'PENDING') throw new CreatorShopError('Esse item já foi revisado.', 409, 'NOT_PENDING');
  let updated;
  if (approve) {
    if (item.kind === 'EMOJI' && await emojiNameTaken(db, item.name, item.id)) throw new CreatorShopError('Já existe um emoji com esse nome — recuse pedindo outro nome.', 409, 'NAME_TAKEN');
    let decorationId = null;
    if (item.kind === 'FRAME') {
      const collectionId = await hiddenCollectionId(db);
      const deco = await db.avatarDecoration.create({
        data: { name: item.name, imageUrl: item.imageUrl, priceCoins: null, priceGems: null, active: true, discountEligible: false, description: 'Criação da comunidade (Loja dos criadores).', collectionId },
      });
      decorationId = deco.id;
      // O próprio criador também pode usar a moldura dele.
      await db.userAvatarDecoration.upsert({ where: { userId_decorationId: { userId: item.creatorId, decorationId } }, create: { userId: item.creatorId, decorationId }, update: {} }).catch(() => null);
    }
    updated = await db.creatorItem.update({ where: { id: itemId }, data: { status: 'APPROVED', reviewedById: staffUser.id, reviewedAt: new Date(), rejectReason: null, decorationId } });
  } else {
    const why = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (why.length < 3) throw new CreatorShopError('Escreva o motivo da recusa.');
    updated = await db.creatorItem.update({ where: { id: itemId }, data: { status: 'REJECTED', reviewedById: staffUser.id, reviewedAt: new Date(), rejectReason: why } });
  }
  if (notify) {
    Promise.resolve(notify(item.creatorId, approve
      ? { kind: 'CREATOR_APPROVED', title: `Sua criação "${item.name}" foi aprovada!`, body: 'Ela já está à venda na Loja dos criadores.', link: '/loja/criadores' }
      : { kind: 'CREATOR_REJECTED', title: `Sua criação "${item.name}" foi recusada`, body: `Motivo: ${updated.rejectReason}`, link: '/loja/criadores?aba=minhas' })).catch(() => {});
  }
  return updated;
}

// Remoção pela equipe (denúncia, conteúdo impróprio...). O item some da loja
// e deixa de ser usável; moldura sai de quem estava usando.
async function removeItem(staffUser, itemId, { reason } = {}, { db = getPrisma(), notify = null } = {}) {
  if (!isStaff(staffUser)) throw new CreatorShopError('Só a equipe pode remover criações.', 403, 'FORBIDDEN');
  const item = await db.creatorItem.findUnique({ where: { id: itemId } });
  if (!item) throw new CreatorShopError('Item não encontrado.', 404, 'NOT_FOUND');
  const why = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'Removido pela equipe.';
  if (item.decorationId) {
    const wearing = await db.user.findMany({ where: { avatarDecoration: { contains: `"id":"${item.decorationId}"` } }, select: { id: true } });
    if (wearing.length) await db.user.updateMany({ where: { id: { in: wearing.map((u) => u.id) } }, data: { avatarDecoration: null } });
    await db.avatarDecoration.delete({ where: { id: item.decorationId } }).catch(() => null);
  }
  const updated = await db.creatorItem.update({ where: { id: itemId }, data: { status: 'REMOVED', rejectReason: why, reviewedById: staffUser.id, reviewedAt: new Date(), decorationId: null } });
  await db.creatorItemReport.updateMany({ where: { itemId, status: 'OPEN' }, data: { status: 'RESOLVED' } });
  if (notify) Promise.resolve(notify(item.creatorId, { kind: 'CREATOR_REMOVED', title: `Sua criação "${item.name}" foi removida da loja`, body: `Motivo: ${why}`, link: '/loja/criadores?aba=minhas' })).catch(() => {});
  return updated;
}

async function withdraw(userId, itemId, { db = getPrisma() } = {}) {
  const item = await db.creatorItem.findUnique({ where: { id: itemId } });
  if (!item || item.creatorId !== userId) throw new CreatorShopError('Item não encontrado.', 404, 'NOT_FOUND');
  if (item.status === 'APPROVED') throw new CreatorShopError('Item aprovado não pode ser apagado (alguém pode ter comprado). Fale com a equipe.', 409, 'APPROVED');
  await db.creatorItem.delete({ where: { id: itemId } });
  return { ok: true };
}

async function report(userId, itemId, reason, { db = getPrisma() } = {}) {
  const item = await db.creatorItem.findUnique({ where: { id: itemId } });
  if (!item || item.status !== 'APPROVED') throw new CreatorShopError('Item não encontrado.', 404, 'NOT_FOUND');
  const why = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (why.length < 3) throw new CreatorShopError('Conte rapidinho o motivo da denúncia.');
  try {
    await db.creatorItemReport.create({ data: { itemId, reporterId: userId, reason: why } });
  } catch (err) {
    if (err?.code === 'P2002') throw new CreatorShopError('Você já denunciou esse item. A equipe vai olhar.', 409, 'ALREADY_REPORTED');
    throw err;
  }
  return { ok: true };
}

async function adminQueue(staffUser, { status = 'PENDING' } = {}, { db = getPrisma() } = {}) {
  if (!isStaff(staffUser)) throw new CreatorShopError('Acesso restrito à equipe.', 403, 'FORBIDDEN');
  const st = ['PENDING', 'APPROVED', 'REJECTED', 'REMOVED'].includes(status) ? status : 'PENDING';
  const items = await db.creatorItem.findMany({ where: { status: st }, orderBy: { createdAt: st === 'PENDING' ? 'asc' : 'desc' }, take: 200 });
  const reports = await db.creatorItemReport.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' }, take: 200 });
  const reportItems = reports.length ? await db.creatorItem.findMany({ where: { id: { in: [...new Set(reports.map((r) => r.itemId))] } } }) : [];
  const itemById = new Map((await attachCreators(db, reportItems)).map((i) => [i.id, i]));
  const counts = await db.creatorItem.groupBy({ by: ['status'], _count: { _all: true } }).catch(() => []);
  return {
    items: await attachCreators(db, items),
    reports: reports.map((r) => ({ ...r, item: itemById.get(r.itemId) || null })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  };
}

async function resolveReport(staffUser, reportId, { db = getPrisma() } = {}) {
  if (!isStaff(staffUser)) throw new CreatorShopError('Acesso restrito à equipe.', 403, 'FORBIDDEN');
  await db.creatorItemReport.update({ where: { id: reportId }, data: { status: 'RESOLVED' } });
  return { ok: true };
}

module.exports = {
  KINDS, PRICE_MIN, PRICE_MAX, FEE_PERCENT, MAX_PENDING, MAX_BYTES, HIDDEN_COLLECTION_NAME,
  CreatorShopError, isStaff, computeFee, sanitizeItemName, validateSubmission, checkCanBuy,
  submit, listApproved, usableItems, usableEmojisFor, publicEmojiMap, mine, buy, review, removeItem, withdraw, report,
  adminQueue, resolveReport,
};
