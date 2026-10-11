// Jogo de Cartas — Painel da Staff (somente ADMIN da plataforma; a rota usa
// requirePlatformAdmin). Cartas, pacotes, regras/economia, jogadores,
// trocas e partidas — tudo sem mexer no código.
const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');
const { RARITIES, ELEMENTS, ABILITIES, DEFAULT_SETTINGS, mergeSettings, BOARD_EFFECTS } = require('../cards/config');
const S = require('../cards/service');
const { logAction } = require('../services/audit');

const { CardError } = S;
function handle(fn) {
  return async (req, res, next) => {
    try { await fn(req, res); } catch (err) {
      if (err instanceof CardError) return res.status(err.status || 400).json({ error: err.message });
      if (err?.code === 'P2002') return res.status(409).json({ error: 'Já existe um item com esse identificador.' });
      next(err);
    }
  };
}
const audit = (req, action, targetId, metadata) => logAction(req.app.get('io'), { actorId: req.user.id, action, targetType: 'CARDS', targetId, metadata }).catch(() => {});

const int = (v, min, max, fb) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb;
};
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// ---------- Cartas ----------
const listCards = handle(async (req, res) => {
  const catalog = await S.getCatalog(true);
  const owners = await prisma.userCard.groupBy({ by: ['cardId'], where: { quantity: { gt: 0 } }, _sum: { quantity: true }, _count: true });
  const byCard = Object.fromEntries(owners.map((o) => [o.cardId, { copies: o._sum.quantity || 0, owners: o._count }]));
  res.json({
    cards: catalog.all.map((c) => ({ ...S.shapeCard(c), stats: byCard[c.id] || { copies: 0, owners: 0 } })),
    meta: { rarities: RARITIES, elements: ELEMENTS, abilities: Object.entries(ABILITIES).map(([k, a]) => ({ key: k, label: a.label, desc: a.desc, value: a.value })) },
  });
});

function readCard(req, isNew) {
  const b = req.body || {};
  const d = {};
  if (b.name !== undefined) d.name = str(b.name, 60);
  if (isNew && !d.name) throw new CardError('Dê um nome à carta.');
  if (b.name !== undefined && !d.name) throw new CardError('O nome não pode ficar vazio.');
  if (b.slug !== undefined || isNew) d.slug = slugify(b.slug || d.name);
  if (b.description !== undefined) d.description = str(b.description, 600) || null;
  if (b.flavor !== undefined) d.flavor = str(b.flavor, 300) || null;
  if (b.collection !== undefined) d.collection = str(b.collection, 40) || 'Origens';
  if (b.rarity !== undefined) { if (!RARITIES.includes(b.rarity)) throw new CardError('Raridade inválida.'); d.rarity = b.rarity; }
  if (b.element !== undefined) { if (!ELEMENTS.includes(b.element)) throw new CardError('Elemento inválido.'); d.element = b.element; }
  if (b.ability !== undefined) { if (!ABILITIES[b.ability]) throw new CardError('Habilidade inválida.'); d.ability = b.ability; }
  if (b.kind !== undefined) d.kind = b.kind === 'SPELL' ? 'SPELL' : 'UNIT';
  if (b.cost !== undefined) d.cost = int(b.cost, 0, 10, 1);
  if (b.attack !== undefined) d.attack = int(b.attack, 0, 30, 1);
  if (b.health !== undefined) d.health = int(b.health, 1, 40, 1);
  if (b.abilityValue !== undefined) d.abilityValue = int(b.abilityValue, 0, 20, 0);
  if (b.enabled !== undefined) d.enabled = b.enabled === true || b.enabled === 'true';
  if (b.removeImage === 'true' || b.removeImage === true) d.imageUrl = null;
  else if (b.imageUrl !== undefined && typeof b.imageUrl === 'string' && /^https?:\/\//.test(b.imageUrl)) d.imageUrl = b.imageUrl.slice(0, 500);
  if (req.file?.url) d.imageUrl = req.file.url;
  return d;
}

const createCard = handle(async (req, res) => {
  const data = readCard(req, true);
  if (!data.slug) throw new CardError('Identificador inválido.');
  const card = await prisma.cardDef.create({ data });
  S.invalidateCatalog();
  audit(req, 'CARDS_CARD_CREATE', card.id, { name: card.name });
  res.status(201).json({ card: S.shapeCard(card) });
});

const updateCard = handle(async (req, res) => {
  const data = readCard(req, false);
  const card = await prisma.cardDef.update({ where: { id: req.params.id }, data }).catch((e) => { if (e.code === 'P2025') throw new CardError('Carta não encontrada.', 404); throw e; });
  S.invalidateCatalog();
  audit(req, 'CARDS_CARD_UPDATE', card.id, { name: card.name, fields: Object.keys(data) });
  res.json({ card: S.shapeCard(card) });
});

// Excluir: se alguém tem a carta, exige force=1 (remove das coleções também).
const deleteCard = handle(async (req, res) => {
  const card = await prisma.cardDef.findUnique({ where: { id: req.params.id } });
  if (!card) throw new CardError('Carta não encontrada.', 404);
  const owned = await prisma.userCard.count({ where: { cardId: card.id, quantity: { gt: 0 } } });
  if (owned && req.query.force !== '1') {
    return res.status(409).json({ error: `${owned} jogador(es) têm essa carta. Desative em vez de excluir, ou confirme a exclusão definitiva.`, owners: owned });
  }
  await prisma.$transaction([
    prisma.userCard.deleteMany({ where: { cardId: card.id } }),
    prisma.cardDef.delete({ where: { id: card.id } }),
  ]);
  S.invalidateCatalog();
  audit(req, 'CARDS_CARD_DELETE', card.id, { name: card.name, owners: owned });
  res.json({ ok: true });
});

// ---------- Pacotes ----------
const listPacks = handle(async (req, res) => {
  await S.ensureSeed();
  const packs = await prisma.cardPack.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
  const sold = await prisma.cardPackOpen.groupBy({ by: ['packId'], _count: true });
  const byPack = Object.fromEntries(sold.map((s) => [s.packId, s._count]));
  res.json({ packs: packs.map((p) => ({ ...p, weights: safe(p.weights, {}), poolCardIds: safe(p.poolCardIds, []), sold: byPack[p.id] || 0 })) });
});
function safe(s, fb) { try { return s ? JSON.parse(s) : fb; } catch { return fb; } }

function readPack(req, isNew) {
  const b = req.body || {};
  const d = {};
  if (b.name !== undefined) d.name = str(b.name, 60);
  if (isNew && !d.name) throw new CardError('Dê um nome ao pacote.');
  if (b.description !== undefined) d.description = str(b.description, 400) || null;
  if (b.color !== undefined) d.color = /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#7c5cff';
  const price = (v) => (v === null || v === '' || v === undefined || v === 'null' ? null : int(v, 0, 1_000_000, null));
  if (b.priceCoins !== undefined) d.priceCoins = price(b.priceCoins);
  if (b.priceGems !== undefined) d.priceGems = price(b.priceGems);
  if (b.cardsPerPack !== undefined) d.cardsPerPack = int(b.cardsPerPack, 1, 15, 5);
  if (b.dailyLimit !== undefined) d.dailyLimit = b.dailyLimit === null || b.dailyLimit === '' || b.dailyLimit === 'null' ? null : int(b.dailyLimit, 1, 100, null);
  if (b.weights !== undefined) {
    const w = typeof b.weights === 'string' ? safe(b.weights, {}) : b.weights;
    const clean = {};
    for (const r of RARITIES) { const n = Number(w?.[r]); clean[r] = Number.isFinite(n) && n > 0 ? Math.min(1000, Math.round(n * 1000) / 1000) : 0; }
    if (!Object.values(clean).some((n) => n > 0)) throw new CardError('Defina a chance de pelo menos uma raridade.');
    d.weights = JSON.stringify(clean);
  } else if (isNew) d.weights = JSON.stringify({ COMUM: 60, INCOMUM: 28, RARA: 9, EPICA: 2.5, LENDARIA: 0.45, MITICA: 0.05 });
  if (b.guaranteed !== undefined) d.guaranteed = RARITIES.includes(b.guaranteed) ? b.guaranteed : null;
  if (b.poolMode !== undefined) d.poolMode = ['ALL', 'COLLECTION', 'LIST'].includes(b.poolMode) ? b.poolMode : 'ALL';
  if (b.poolCollection !== undefined) d.poolCollection = str(b.poolCollection, 40) || null;
  if (b.poolCardIds !== undefined) {
    const ids = typeof b.poolCardIds === 'string' ? safe(b.poolCardIds, []) : b.poolCardIds;
    d.poolCardIds = JSON.stringify(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string').slice(0, 500) : []);
  }
  if (b.discountPercent !== undefined) d.discountPercent = b.discountPercent === '' || b.discountPercent === null || b.discountPercent === 'null' ? null : int(b.discountPercent, 0, 90, 0) || null;
  if (b.offerEndsAt !== undefined) { const t = b.offerEndsAt ? new Date(b.offerEndsAt) : null; d.offerEndsAt = t && !Number.isNaN(t.getTime()) ? t : null; }
  if (b.expansion !== undefined) d.expansion = b.expansion === true || b.expansion === 'true';
  if (b.availableUntil !== undefined) { const t = b.availableUntil ? new Date(b.availableUntil) : null; d.availableUntil = t && !Number.isNaN(t.getTime()) ? t : null; }
  if (b.active !== undefined) d.active = b.active === true || b.active === 'true';
  if (b.sort !== undefined) d.sort = int(b.sort, -999, 999, 0);
  if (b.removeImage === 'true' || b.removeImage === true) d.imageUrl = null;
  if (req.file?.url) d.imageUrl = req.file.url;
  return d;
}

const createPack = handle(async (req, res) => {
  const pack = await prisma.cardPack.create({ data: readPack(req, true) });
  audit(req, 'CARDS_PACK_CREATE', pack.id, { name: pack.name });
  res.status(201).json({ pack });
});
const updatePack = handle(async (req, res) => {
  const data = readPack(req, false);
  const pack = await prisma.cardPack.update({ where: { id: req.params.id }, data }).catch((e) => { if (e.code === 'P2025') throw new CardError('Pacote não encontrado.', 404); throw e; });
  audit(req, 'CARDS_PACK_UPDATE', pack.id, { name: pack.name, fields: Object.keys(data) });
  res.json({ pack });
});
const deletePack = handle(async (req, res) => {
  const r = await prisma.cardPack.deleteMany({ where: { id: req.params.id } });
  if (!r.count) throw new CardError('Pacote não encontrado.', 404);
  audit(req, 'CARDS_PACK_DELETE', req.params.id);
  res.json({ ok: true });
});

// Simula aberturas (sem dar nada a ninguém) pra staff conferir as chances.
const simulatePack = handle(async (req, res) => {
  const pack = await prisma.cardPack.findUnique({ where: { id: req.params.id } });
  if (!pack) throw new CardError('Pacote não encontrado.', 404);
  const catalog = await S.getCatalog();
  const n = int(req.query.n, 1, 2000, 500);
  const byRarity = {};
  let cards = 0;
  for (let i = 0; i < n; i += 1) for (const c of S.drawPack(pack, catalog)) { byRarity[c.rarity] = (byRarity[c.rarity] || 0) + 1; cards += 1; }
  res.json({ packs: n, cards, byRarity, pool: S.packPool(pack, catalog).length });
});

// ---------- Configurações ----------
const getSettings = handle(async (req, res) => {
  res.json({ settings: await S.getSettings(true), defaults: DEFAULT_SETTINGS });
});

const NUM_LIMITS = {
  rules: { startHp: [5, 100], deckSize: [10, 40], maxCopies: [1, 5], maxCopiesLegendary: [1, 5], startHand: [1, 8], maxHand: [3, 12], maxEnergy: [3, 15], boardSize: [3, 7], turnSeconds: [20, 300], elementBonus: [0, 5], maxTimeouts: [1, 10], levelCap: [1, 10] },
  rewards: { FACIL: [0, 10000], MEDIO: [0, 10000], DIFICIL: [0, 10000], LENDARIO: [0, 10000], pveLoss: [0, 10000], pvpWin: [0, 10000], pvpLoss: [0, 10000], dailyRewardedMatches: [0, 500], pvpRewardsPerOpponentPerDay: [0, 50], minTurnsForReward: [0, 30], streakBonus: [0, 1000], streakBonusMax: [0, 10000] },
  economy: { tradeMaxCoins: [0, 1_000_000], maxOpenTrades: [1, 50], starterCards: [0, 60], foilChance: [0, 100], foilSellMultiplier: [1, 20], marketTax: [0, 50], maxListings: [1, 100], dailyDealPercent: [0, 90] },
  season: { minGames: [0, 100] },
  extras: {
    brawlCoins: [0, 100000], brawlGems: [0, 1000], tutorialCoins: [0, 100000], chestEvery: [1, 20], chestCoins: [0, 100000], chestCards: [0, 10],
    passXpWin: [0, 1000], passXpLoss: [0, 1000], passXpMission: [0, 1000], passXpPack: [0, 1000], passXpPerLevel: [10, 10000], passLevels: [5, 60],
    goldenChance: [0, 1000], draftFee: [0, 100000], bossHp: [100, 1_000_000], bossCoins: [0, 100000], bossGems: [0, 1000],
  },
};

const updateSettings = handle(async (req, res) => {
  const cur = await S.getSettings(true);
  const b = req.body || {};
  const next = mergeSettings(cur);
  for (const [sec, fields] of Object.entries(NUM_LIMITS)) {
    for (const [k, [min, max]] of Object.entries(fields)) {
      if (b[sec]?.[k] !== undefined) next[sec][k] = int(b[sec][k], min, max, next[sec][k]);
    }
  }
  if (b.economy?.sellValues) for (const r of RARITIES) if (b.economy.sellValues[r] !== undefined) next.economy.sellValues[r] = int(b.economy.sellValues[r], 0, 100000, next.economy.sellValues[r]);
  for (const k of ['levelUpCopies', 'levelUpCoins']) {
    if (Array.isArray(b.economy?.[k])) next.economy[k] = b.economy[k].slice(0, 9).map((v) => int(v, 0, 100000, 0));
  }
  for (const k of ['rewards', 'gems']) if (b.season?.[k]) for (const dv of Object.keys(DEFAULT_SETTINGS.season.rewards)) if (b.season[k][dv] !== undefined) next.season[k][dv] = int(b.season[k][dv], 0, 1_000_000, next.season[k][dv]);
  if (b.enabled) for (const k of Object.keys(DEFAULT_SETTINGS.enabled)) if (b.enabled[k] !== undefined) next.enabled[k] = !!b.enabled[k];
  for (const k of ['streakCoins', 'draftRewards', 'clanTopCoins']) {
    if (Array.isArray(b.extras?.[k])) next.extras[k] = b.extras[k].slice(0, 12).map((v) => int(v, 0, 100000, 0));
  }
  if (next.rules.startHand > next.rules.maxHand) next.rules.startHand = next.rules.maxHand;
  next.seedVersion = cur.seedVersion || 1;
  await prisma.cardGameSettings.upsert({ where: { id: 'singleton' }, update: { data: JSON.stringify(next) }, create: { id: 'singleton', data: JSON.stringify(next) } });
  S.invalidateSettings();
  audit(req, 'CARDS_SETTINGS_UPDATE', 'settings', {});
  res.json({ settings: next });
});

// ---------- Jogadores ----------
const searchPlayers = handle(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  let users;
  if (q) {
    users = await prisma.user.findMany({ where: { OR: [{ id: q }, { username: { contains: q } }, { displayName: { contains: q } }] }, select: { ...PUBLIC_USER_FIELDS, coins: true, gems: true }, take: 20 });
  } else {
    const top = await prisma.cardPlayer.findMany({ orderBy: { updatedAt: 'desc' }, take: 20 });
    users = top.length ? await prisma.user.findMany({ where: { id: { in: top.map((t) => t.userId) } }, select: { ...PUBLIC_USER_FIELDS, coins: true, gems: true } }) : [];
  }
  const players = users.length ? await prisma.cardPlayer.findMany({ where: { userId: { in: users.map((u) => u.id) } } }) : [];
  const counts = users.length ? await prisma.userCard.groupBy({ by: ['userId'], where: { userId: { in: users.map((u) => u.id) }, quantity: { gt: 0 } }, _sum: { quantity: true } }) : [];
  const pBy = Object.fromEntries(players.map((p) => [p.userId, p]));
  const cBy = Object.fromEntries(counts.map((c) => [c.userId, c._sum.quantity || 0]));
  res.json({ players: users.map((u) => ({ user: u, player: pBy[u.id] || null, cards: cBy[u.id] || 0 })) });
});

const playerDetail = handle(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { ...PUBLIC_USER_FIELDS, coins: true, gems: true } });
  if (!user) throw new CardError('Usuário não encontrado.', 404);
  const catalog = await S.getCatalog();
  const [player, rows, matches, opens] = await Promise.all([
    S.getPlayer(user.id),
    prisma.userCard.findMany({ where: { userId: user.id, quantity: { gt: 0 } } }),
    prisma.cardMatch.findMany({ where: { OR: [{ p1Id: user.id }, { p2Id: user.id }] }, orderBy: { createdAt: 'desc' }, take: 15, select: { id: true, mode: true, difficulty: true, status: true, winnerId: true, reward1: true, reward2: true, p1Id: true, createdAt: true, endReason: true } }),
    prisma.cardPackOpen.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);
  res.json({
    user, player,
    cards: rows.map((r) => catalog.byId.get(r.cardId) && S.shapeCard(catalog.byId.get(r.cardId), r)).filter(Boolean),
    matches, opens: opens.map((o) => ({ ...o, cards: safe(o.cards, []).length })),
  });
});

const grantCard = handle(async (req, res) => {
  const userId = req.params.userId;
  const card = await prisma.cardDef.findUnique({ where: { id: String(req.body?.cardId || '') } });
  if (!card) throw new CardError('Carta não encontrada.', 404);
  const qty = int(req.body?.qty, -999, 999, 1);
  if (!qty) throw new CardError('Quantidade inválida.');
  if (qty > 0) {
    await prisma.userCard.upsert({ where: { userId_cardId: { userId, cardId: card.id } }, update: { quantity: { increment: qty } }, create: { userId, cardId: card.id, quantity: qty } });
  } else {
    const row = await prisma.userCard.findUnique({ where: { userId_cardId: { userId, cardId: card.id } } });
    if (!row) throw new CardError('O jogador não tem essa carta.');
    await prisma.userCard.update({ where: { id: row.id }, data: { quantity: Math.max(0, row.quantity + qty) } });
  }
  if (req.body?.level !== undefined) {
    await prisma.userCard.updateMany({ where: { userId, cardId: card.id }, data: { level: int(req.body.level, 1, 10, 1) } });
  }
  audit(req, 'CARDS_GRANT', userId, { cardId: card.id, name: card.name, qty });
  res.json({ ok: true });
});

const updatePlayer = handle(async (req, res) => {
  const userId = req.params.userId;
  const b = req.body || {};
  const data = {};
  if (b.banned !== undefined) data.banned = !!b.banned;
  if (b.resetStats) Object.assign(data, { wins: 0, losses: 0, pvpWins: 0, pvpLosses: 0, rating: 1000, streak: 0, bestStreak: 0 });
  if (b.resetStarter) data.starterClaimed = false;
  if (b.rating !== undefined) data.rating = int(b.rating, 100, 5000, 1000);
  await prisma.cardPlayer.upsert({ where: { userId }, update: data, create: { userId, ...data } });
  if (b.wipeCollection) await prisma.userCard.deleteMany({ where: { userId } });
  audit(req, 'CARDS_PLAYER_UPDATE', userId, { ...b });
  res.json({ ok: true });
});

// ---------- Trocas e partidas ----------
const listTrades = handle(async (req, res) => {
  const status = ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'FAILED'].includes(req.query.status) ? req.query.status : undefined;
  const rows = await prisma.cardTrade.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 60 });
  const ids = [...new Set(rows.flatMap((r) => [r.fromId, r.toId]))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: PUBLIC_USER_FIELDS }) : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const catalog = await S.getCatalog();
  const items = (raw) => safe(raw, []).map((i) => ({ ...i, name: catalog.byId.get(i.cardId)?.name || '(removida)', rarity: catalog.byId.get(i.cardId)?.rarity }));
  res.json({ trades: rows.map((r) => ({ ...r, from: byId[r.fromId], to: byId[r.toId], offer: items(r.offer), request: items(r.request) })) });
});

const cancelTrade = handle(async (req, res) => {
  const r = await prisma.cardTrade.updateMany({ where: { id: req.params.id, status: 'PENDING' }, data: { status: 'CANCELLED', resolvedAt: new Date() } });
  if (!r.count) throw new CardError('Essa troca não está pendente.');
  audit(req, 'CARDS_TRADE_CANCEL', req.params.id);
  res.json({ ok: true });
});

const listMatches = handle(async (req, res) => {
  const status = ['PENDING', 'ACTIVE', 'FINISHED', 'CANCELLED', 'DECLINED'].includes(req.query.status) ? req.query.status : undefined;
  const rows = await prisma.cardMatch.findMany({
    where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 60,
    select: { id: true, mode: true, difficulty: true, status: true, p1Id: true, p2Id: true, winnerId: true, reward1: true, reward2: true, endReason: true, createdAt: true, endedAt: true },
  });
  const ids = [...new Set(rows.flatMap((r) => [r.p1Id, r.p2Id]).filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: PUBLIC_USER_FIELDS }) : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const [total, active, today] = await Promise.all([
    prisma.cardMatch.count({ where: { status: 'FINISHED' } }),
    prisma.cardMatch.count({ where: { status: 'ACTIVE' } }),
    prisma.cardPackOpen.count({ where: { dayKey: S.dayKey() } }),
  ]);
  res.json({ stats: { finished: total, active, packsToday: today }, matches: rows.map((r) => ({ ...r, p1: byId[r.p1Id], p2: r.p2Id ? byId[r.p2Id] : null })) });
});

const cancelMatch = handle(async (req, res) => {
  const r = await prisma.cardMatch.updateMany({ where: { id: req.params.id, status: { in: ['PENDING', 'ACTIVE'] } }, data: { status: 'CANCELLED', endReason: 'staff', endedAt: new Date(), turnDeadline: null } });
  if (!r.count) throw new CardError('Essa partida já terminou.');
  audit(req, 'CARDS_MATCH_CANCEL', req.params.id);
  res.json({ ok: true });
});

// ---------- Mesas (fundos de batalha) ----------
function readBoard(req, isNew) {
  const b = req.body || {};
  const d = {};
  if (b.name !== undefined) d.name = str(b.name, 50) || '';
  if (isNew && !d.name) throw new CardError('Dê um nome ao fundo.');
  if (b.theme !== undefined) d.theme = S.BOARD_THEMES.includes(b.theme) ? b.theme : 'floresta';
  if (b.dim !== undefined) d.dim = int(b.dim, 0, 85, 35);
  if (b.accent !== undefined) d.accent = /^#[0-9a-fA-F]{6}$/.test(String(b.accent)) ? String(b.accent) : '#8b6bff';
  if (b.weight !== undefined) d.weight = int(b.weight, 0, 100, 10);
  if (b.effect !== undefined) d.effect = BOARD_EFFECTS[b.effect] ? b.effect : 'NONE';
  if (b.sort !== undefined) d.sort = int(b.sort, -999, 999, 0);
  if (b.active !== undefined) d.active = b.active === true || b.active === 'true';
  if (b.removeImage === 'true' || b.removeImage === true) d.imageUrl = null;
  else if (typeof b.imageUrl === 'string' && /^https:\/\//.test(b.imageUrl)) d.imageUrl = b.imageUrl.slice(0, 500);
  if (req.file?.url) d.imageUrl = req.file.url;
  return d;
}
const listBoards = handle(async (req, res) => {
  const [boards, used] = await Promise.all([
    S.getBoards(true),
    prisma.cardMatch.groupBy({ by: ['boardId'], _count: { _all: true } }).catch(() => []),
  ]);
  const uses = Object.fromEntries(used.filter((u) => u.boardId).map((u) => [u.boardId, u._count._all]));
  res.json({ boards: boards.map((b) => ({ ...b, uses: uses[b.id] || 0 })), themes: S.BOARD_THEMES, effects: Object.entries(BOARD_EFFECTS).map(([key, e]) => ({ key, label: e.label, desc: e.desc })) });
});
const createBoard = handle(async (req, res) => {
  const n = await prisma.cardBoard.count();
  if (n >= 60) throw new CardError('Limite de 60 fundos.');
  const board = await prisma.cardBoard.create({ data: { sort: n, ...readBoard(req, true) } });
  S.invalidateBoards();
  audit(req, 'CARDS_BOARD_CREATE', board.id, { name: board.name });
  res.status(201).json({ board });
});
const updateBoard = handle(async (req, res) => {
  const data = readBoard(req, false);
  const board = await prisma.cardBoard.update({ where: { id: req.params.id }, data }).catch((e) => { if (e.code === 'P2025') throw new CardError('Fundo não encontrado.', 404); throw e; });
  S.invalidateBoards();
  audit(req, 'CARDS_BOARD_UPDATE', board.id, { name: board.name, fields: Object.keys(data) });
  res.json({ board });
});
const deleteBoard = handle(async (req, res) => {
  const r = await prisma.cardBoard.deleteMany({ where: { id: req.params.id } });
  if (!r.count) throw new CardError('Fundo não encontrado.', 404);
  S.invalidateBoards();
  audit(req, 'CARDS_BOARD_DELETE', req.params.id);
  res.json({ ok: true });
});

module.exports = {
  listBoards, createBoard, updateBoard, deleteBoard,
  listCards, createCard, updateCard, deleteCard, listPacks, createPack, updatePack, deletePack, simulatePack,
  getSettings, updateSettings, searchPlayers, playerDetail, grantCard, updatePlayer, listTrades, cancelTrade, listMatches, cancelMatch,
};
