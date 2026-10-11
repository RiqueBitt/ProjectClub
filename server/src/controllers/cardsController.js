// Jogo de Cartas — API dos jogadores. TUDO é validado aqui no servidor:
// moedas, posse de cartas, baralhos, ações da batalha (motor autoritativo),
// recompensas e trocas. O cliente só pede; nunca decide.
const crypto = require('crypto');
const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');
const {
  RARITIES, RARITY_LABEL, ELEMENTS, ELEMENT_LABEL, ELEMENT_BEATS, ABILITIES, DIFFICULTIES, DIVISIONS, divisionOf, abilityText,
} = require('../cards/config');
const { createGame, reduce, viewFor, eventsFor } = require('../cards/engine');
const { playTurn } = require('../cards/ai');
const S = require('../cards/service');
const { count: spectatorCount } = require('../cards/spectators');
const { recent: recentEmotes } = require('../cards/emotes');

const { CardError } = S;
const ledger = () => require('../services/economyLedger');

function handle(fn) {
  return async (req, res, next) => {
    try { await fn(req, res); } catch (err) {
      if (err instanceof CardError || err?.engine) return res.status(err.status || 400).json({ error: err.message });
      next(err);
    }
  };
}

async function requireActivePlayer(userId) {
  const p = await S.getPlayer(userId);
  if (p.banned) throw new CardError('Você está bloqueado no Jogo de Cartas. Fale com a equipe.', 403);
  return p;
}

// ---------- Metadados / início ----------
const META = {
  rarities: RARITIES.map((r) => ({ key: r, label: RARITY_LABEL[r] })),
  elements: ELEMENTS.map((e) => ({ key: e, label: ELEMENT_LABEL[e], beats: ELEMENT_BEATS[e] })),
  abilities: Object.entries(ABILITIES).map(([key, a]) => ({ key, label: a.label, desc: a.desc, value: a.value, spell: !!a.spell })),
  divisions: DIVISIONS,
  difficulties: Object.entries(DIFFICULTIES).map(([key, d]) => ({ key, label: d.label, heroHp: d.heroHp, level: d.level })),
};

const home = handle(async (req, res) => {
  const userId = req.user.id;
  const settings = await S.getSettings();
  await S.ensureSeed();
  const [player, me, owned, active, challenges, tradesIn, boards] = await Promise.all([
    S.getPlayer(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { coins: true, gems: true } }),
    prisma.userCard.aggregate({ where: { userId, quantity: { gt: 0 } }, _sum: { quantity: true }, _count: true }),
    prisma.cardMatch.findFirst({ where: { status: 'ACTIVE', OR: [{ p1Id: userId }, { p2Id: userId }, { p3Id: userId }, { p4Id: userId }] }, orderBy: { updatedAt: 'desc' }, select: { id: true, mode: true, difficulty: true, format: true, custom: true } }),
    pendingChallengesFor(userId),
    prisma.cardTrade.count({ where: { toId: userId, status: 'PENDING' } }),
    S.getBoards().catch(() => []),
  ]);
  const R = settings.rewards;
  res.json({
    meta: META,
    rules: settings.rules,
    rewards: { FACIL: R.FACIL, MEDIO: R.MEDIO, DIFICIL: R.DIFICIL, LENDARIO: R.LENDARIO, pvpWin: R.pvpWin, dailyRewardedMatches: R.dailyRewardedMatches },
    economy: { sellValues: settings.economy.sellValues, levelUpCopies: settings.economy.levelUpCopies, levelUpCoins: settings.economy.levelUpCoins, tradeMaxCoins: settings.economy.tradeMaxCoins, starterCards: settings.economy.starterCards, foilSellMultiplier: settings.economy.foilSellMultiplier, foilChance: settings.economy.foilChance, marketTax: settings.economy.marketTax },
    enabled: settings.enabled,
    player: { ...player, rewardsToday: player.rewardDay === S.dayKey() ? player.rewardsToday : 0, lastSeasonReward: undefined },
    season: (() => {
      const div = divisionOf(player.seasonRating);
      const next = DIVISIONS[DIVISIONS.findIndex((d) => d.key === div.key) + 1] || null;
      const now = new Date();
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 3));
      return { key: player.seasonKey, rating: player.seasonRating, wins: player.seasonWins, losses: player.seasonLosses, division: div, next, endsAt: end, minGames: settings.season.minGames, rewards: settings.season.rewards, gems: settings.season.gems, lastReward: safeJson(player.lastSeasonReward || 'null', null) };
    })(),
    wallet: me,
    collection: { total: owned._sum.quantity || 0, distinct: owned._count || 0 },
    starterAvailable: !player.starterClaimed,
    starterCount: Math.max(settings.rules.deckSize, settings.economy.starterCards | 0),
    extras: settings.extras,
    boards: boards.map(S.shapeBoard),
    activeMatch: active,
    challenges,
    tradesPending: tradesIn,
  });
});

const claimStarter = handle(async (req, res) => {
  const userId = req.user.id;
  await requireActivePlayer(userId);
  const settings = await S.getSettings();
  const catalog = await S.getCatalog();
  const n = Math.max(settings.rules.deckSize, settings.economy.starterCards | 0);
  // Pacote de boas-vindas: cartas comuns (entram incomuns só se faltar variedade).
  const commons = catalog.enabled.filter((c) => c.rarity === 'COMUM');
  const basic = commons.length * settings.rules.maxCopies >= n ? commons : catalog.enabled.filter((c) => S.rankOf(c.rarity) <= S.rankOf('INCOMUM'));
  if (!basic.length) throw new CardError('Ainda não há cartas básicas no catálogo.');
  const picks = [];
  const count = new Map();
  let guard = 0;
  while (picks.length < n && guard < 5000) {
    guard += 1;
    const c = basic[S.randInt(basic.length)];
    if ((count.get(c.id) || 0) >= settings.rules.maxCopies && guard < 4000) continue;
    count.set(c.id, (count.get(c.id) || 0) + 1);
    picks.push(c.id);
  }
  const ok = await prisma.$transaction(async (tx) => {
    await tx.cardPlayer.upsert({ where: { userId }, update: {}, create: { userId } });
    const r = await tx.cardPlayer.updateMany({ where: { userId, starterClaimed: false }, data: { starterClaimed: true } });
    if (r.count === 0) return false;
    await S.grantCards(tx, userId, picks);
    return true;
  });
  if (!ok) throw new CardError('Você já pegou o pacote inicial.');
  res.json({ cards: picks.map((id) => S.shapeCard(catalog.byId.get(id))) });
});

// ---------- Coleção ----------
const collection = handle(async (req, res) => {
  const catalog = await S.getCatalog();
  const owned = await S.ownedMap(req.user.id);
  const cards = catalog.enabled.map((c) => S.shapeCard(c, owned.get(c.id) || null));
  res.json({ cards, collections: [...new Set(catalog.enabled.map((c) => c.collection))] });
});

// Cartas que outra pessoa tem (pra montar uma troca / ver no perfil).
const userCollection = handle(async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.userId }, select: PUBLIC_USER_FIELDS });
  if (!target) throw new CardError('Usuário não encontrado.', 404);
  const catalog = await S.getCatalog();
  const rows = await prisma.userCard.findMany({ where: { userId: target.id, quantity: { gt: 0 } } });
  const cards = rows.map((r) => catalog.byId.get(r.cardId) && S.shapeCard(catalog.byId.get(r.cardId), r)).filter(Boolean)
    .sort((a, b) => S.rankOf(b.rarity) - S.rankOf(a.rarity) || b.power - a.power);
  const player = await prisma.cardPlayer.findUnique({ where: { userId: target.id } });
  res.json({ user: target, cards, player: player ? publicPlayer(player) : null });
});

const publicPlayer = (p) => ({ wins: p.wins, losses: p.losses, pvpWins: p.pvpWins, pvpLosses: p.pvpLosses, rating: p.rating, packsOpened: p.packsOpened, bestStreak: p.bestStreak, streak: p.streak, seasonRating: p.seasonRating, seasonWins: p.seasonWins, seasonLosses: p.seasonLosses, division: divisionOf(p.seasonRating) });

// Resumo pro perfil (vitrine).
const profileSummary = handle(async (req, res) => {
  const userId = req.params.userId;
  const [player, rows, catalog] = await Promise.all([
    prisma.cardPlayer.findUnique({ where: { userId } }),
    prisma.userCard.findMany({ where: { userId, quantity: { gt: 0 } } }),
    S.getCatalog(),
  ]);
  const cards = rows.map((r) => catalog.byId.get(r.cardId) && S.shapeCard(catalog.byId.get(r.cardId), r)).filter(Boolean);
  cards.sort((a, b) => S.rankOf(b.rarity) - S.rankOf(a.rarity) || b.power - a.power);
  res.json({
    player: player ? publicPlayer(player) : null,
    distinct: cards.length, total: catalog.enabled.length,
    showcase: cards.slice(0, 5),
  });
});

const sellCard = handle(async (req, res) => {
  const userId = req.user.id;
  await requireActivePlayer(userId);
  const settings = await S.getSettings();
  if (!settings.enabled.sell) throw new CardError('A venda de cartas está desativada.');
  const qty = Math.max(1, Math.min(99, parseInt(req.body?.qty, 10) || 1));
  const catalog = await S.getCatalog();
  const card = catalog.byId.get(req.params.cardId);
  if (!card) throw new CardError('Carta não encontrada.', 404);
  const foil = req.body?.foil === true;
  const unit = Math.max(0, settings.economy.sellValues[card.rarity] | 0) * (foil ? Math.max(1, settings.economy.foilSellMultiplier | 0) : 1);
  const total = unit * qty;
  await prisma.$transaction(async (tx) => {
    // Só vende REPETIDAS: precisa sobrar pelo menos 1 cópia.
    const r = await tx.userCard.updateMany({
      where: { userId, cardId: card.id, quantity: { gte: qty + 1 }, ...(foil ? { foil: { gte: qty } } : {}) },
      data: { quantity: { decrement: qty }, ...(foil ? { foil: { decrement: qty } } : {}) },
    });
    if (r.count === 0) throw new CardError(foil ? 'Você não tem essa cópia brilhante repetida.' : 'Você só pode vender cópias repetidas (fica sempre 1).');
    if (!foil) await S.clampFoil(tx, userId, card.id);
    if (total > 0) await tx.user.update({ where: { id: userId }, data: { coins: { increment: total } } });
  });
  if (total > 0) ledger().recordTransaction(userId, { kind: 'CARDS', label: `Jogo de Cartas: vendeu ${qty}x ${card.name}`, coins: total });
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true, gems: true } });
  res.json({ ok: true, earned: total, wallet: me });
});

const levelUp = handle(async (req, res) => {
  const userId = req.user.id;
  await requireActivePlayer(userId);
  const settings = await S.getSettings();
  const catalog = await S.getCatalog();
  const card = catalog.byId.get(req.params.cardId);
  if (!card) throw new CardError('Carta não encontrada.', 404);
  const row = await prisma.userCard.findUnique({ where: { userId_cardId: { userId, cardId: card.id } } });
  if (!row || row.quantity < 1) throw new CardError('Você não tem essa carta.');
  const cap = settings.rules.levelCap;
  if (row.level >= cap) throw new CardError('Essa carta já está no nível máximo.');
  const i = row.level - 1;
  const copies = Math.max(0, settings.economy.levelUpCopies[i] ?? settings.economy.levelUpCopies.at(-1) ?? 1);
  const coins = Math.max(0, settings.economy.levelUpCoins[i] ?? settings.economy.levelUpCoins.at(-1) ?? 0);
  await prisma.$transaction(async (tx) => {
    const r = await tx.userCard.updateMany({
      where: { userId, cardId: card.id, level: row.level, quantity: { gte: copies + 1 } },
      data: { quantity: { decrement: copies }, level: { increment: 1 } },
    });
    if (r.count === 0) throw new CardError(`Precisa de ${copies} cópia(s) repetida(s) para evoluir.`);
    await S.clampFoil(tx, userId, card.id);
    if (coins > 0) {
      const m = await tx.user.updateMany({ where: { id: userId, coins: { gte: coins } }, data: { coins: { decrement: coins } } });
      if (m.count === 0) throw new CardError('Moedas insuficientes.');
    }
  });
  if (coins > 0) ledger().recordTransaction(userId, { kind: 'CARDS', label: `Jogo de Cartas: evoluiu ${card.name}`, coins: -coins });
  const updated = await prisma.userCard.findUnique({ where: { userId_cardId: { userId, cardId: card.id } } });
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true, gems: true } });
  res.json({ card: S.shapeCard(card, updated), wallet: me });
});

// ---------- Pacotes ----------
// Preço final: desconto da staff (com ou sem prazo) ou "oferta do dia"
// (um pacote sorteado por dia, sempre o mesmo para todos). Vale o maior.
function dailyDealId(packs, day) {
  const list = packs.filter((p) => p.active).sort((a, b) => a.id.localeCompare(b.id));
  if (!list.length) return null;
  let h = 0;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length].id;
}
function packDiscount(pack, dealId, settings, now = Date.now()) {
  const staff = pack.discountPercent && (!pack.offerEndsAt || new Date(pack.offerEndsAt).getTime() > now) ? pack.discountPercent : 0;
  const deal = pack.id === dealId ? (settings.economy.dailyDealPercent | 0) : 0;
  return Math.max(0, Math.min(90, Math.max(staff, deal)));
}
const discounted = (price, pct) => (price === null || price === undefined ? price : Math.max(0, Math.round(price * (100 - pct) / 100)));

const listPacks = handle(async (req, res) => {
  await S.ensureSeed();
  const today = S.dayKey();
  const [packs, opens] = await Promise.all([
    prisma.cardPack.findMany({ where: { active: true, OR: [{ availableUntil: null }, { availableUntil: { gt: new Date() } }] }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
    prisma.cardPackOpen.groupBy({ by: ['packId'], where: { userId: req.user.id, dayKey: today }, _count: true }),
  ]);
  const openedToday = Object.fromEntries(opens.map((o) => [o.packId, o._count]));
  const settings = await S.getSettings();
  const dealId = dailyDealId(packs, today);
  res.json({
    foilChance: settings.economy.foilChance, goldenChance: settings.extras.goldenChance,
    packs: packs.map((p) => {
      const pct = packDiscount(p, dealId, settings);
      return {
      id: p.id, name: p.name, description: p.description, imageUrl: p.imageUrl, color: p.color,
      priceCoins: discounted(p.priceCoins, pct), priceGems: discounted(p.priceGems, pct), cardsPerPack: p.cardsPerPack,
      fullPriceCoins: p.priceCoins, fullPriceGems: p.priceGems, discountPercent: pct, dailyDeal: p.id === dealId && pct > 0,
      offerEndsAt: pct && p.id !== dealId ? p.offerEndsAt : null,
      weights: safeJson(p.weights, {}), guaranteed: p.guaranteed, dailyLimit: p.dailyLimit,
      openedToday: openedToday[p.id] || 0, poolMode: p.poolMode, poolCollection: p.poolCollection,
      expansion: !!p.expansion, availableUntil: p.availableUntil || null,
    };
    }),
  });
});

function safeJson(s, fb) { try { return JSON.parse(s); } catch { return fb; } }

const openPack = handle(async (req, res) => {
  const userId = req.user.id;
  await requireActivePlayer(userId);
  const settings = await S.getSettings();
  if (!settings.enabled.packs) throw new CardError('A loja de pacotes está fechada no momento.');
  const pack = await prisma.cardPack.findUnique({ where: { id: req.params.id } });
  if (!pack || !pack.active) throw new CardError('Pacote não encontrado.', 404);
  if (pack.availableUntil && new Date(pack.availableUntil).getTime() <= Date.now()) throw new CardError('Esse pacote não está mais à venda.');
  const currency = req.body?.currency === 'gems' ? 'gems' : 'coins';
  const allActive = await prisma.cardPack.findMany({ where: { active: true }, select: { id: true, active: true } });
  const pct = packDiscount(pack, dailyDealId(allActive, S.dayKey()), settings);
  const price = discounted(currency === 'gems' ? pack.priceGems : pack.priceCoins, pct);
  if (price === null || price === undefined || price < 0) throw new CardError('Esse pacote não é vendido nessa moeda.');
  const catalog = await S.getCatalog();
  const owned = await S.ownedMap(userId);
  const cards = S.drawPack(pack, catalog);
  // Cada carta tem uma chance de vir brilhante (foil).
  const foilPct = Math.max(0, Math.min(100, Number(settings.economy.foilChance) || 0));
  // Dourada: bem mais rara (por mil). Uma carta dourada não conta como brilhante.
  const goldPm = Math.max(0, Math.min(1000, Number(settings.extras?.goldenChance) || 0));
  const goldens = cards.map(() => crypto.randomInt(0, 100000) < goldPm * 100);
  const foils = cards.map((_, i) => !goldens[i] && crypto.randomInt(0, 10000) < foilPct * 100);
  const today = S.dayKey();
  await prisma.$transaction(async (tx) => {
    if (pack.dailyLimit) {
      const n = await tx.cardPackOpen.count({ where: { userId, packId: pack.id, dayKey: today } });
      if (n >= pack.dailyLimit) throw new CardError(`Limite diário deste pacote atingido (${pack.dailyLimit}).`);
    }
    if (price > 0) {
      const r = await tx.user.updateMany({ where: { id: userId, [currency]: { gte: price } }, data: { [currency]: { decrement: price } } });
      if (r.count === 0) throw new CardError(currency === 'gems' ? 'Gemas insuficientes.' : 'Moedas insuficientes.');
    }
    await S.grantCards(tx, userId, cards.map((c) => c.id), cards.filter((_, i) => foils[i]).map((c) => c.id), cards.filter((_, i) => goldens[i]).map((c) => c.id));
    await tx.cardPackOpen.create({ data: { userId, packId: pack.id, dayKey: today, cards: JSON.stringify(cards.map((c) => c.id)), paidCoins: currency === 'coins' ? price : 0, paidGems: currency === 'gems' ? price : 0 } });
    await tx.cardPlayer.upsert({ where: { userId }, update: { packsOpened: { increment: 1 } }, create: { userId, packsOpened: 1 } });
  });
  if (price > 0) ledger().recordTransaction(userId, { kind: 'CARDS', label: `Jogo de Cartas: ${pack.name}`, [currency]: -price });
  S.afterActivity(userId, [['CARDS_PACK', 1]], req.app.get('io'));
  require('../cards/progress').addPassXpFor(userId, 'pack').catch(() => {});
  const seen = new Set();
  const result = cards.map((c, i) => {
    const isNew = !(owned.get(c.id)?.quantity > 0) && !seen.has(c.id);
    seen.add(c.id);
    return { ...S.shapeCard(c), isNew, foil: foils[i], golden: goldens[i] };
  });
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true, gems: true } });
  res.json({ cards: result, wallet: me });
});

// ---------- Baralhos ----------
const listDecks = handle(async (req, res) => {
  const settings = await S.getSettings();
  const catalog = await S.getCatalog();
  const owned = await S.ownedMap(req.user.id);
  const rows = await prisma.cardDeck.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'asc' } });
  res.json({
    decks: rows.map((d) => {
      const cards = S.parseDeckCards(d.cards);
      const v = S.validateDeck(cards, owned, catalog, settings.rules);
      return { id: d.id, name: d.name, active: d.active, cards, valid: v.ok, errors: v.errors, total: v.total };
    }),
    rules: settings.rules,
  });
});

const MAX_DECKS = 10;
const saveDeck = handle(async (req, res) => {
  const userId = req.user.id;
  const settings = await S.getSettings();
  const catalog = await S.getCatalog();
  const owned = await S.ownedMap(userId);
  const name = String(req.body?.name || 'Meu baralho').trim().slice(0, 40) || 'Meu baralho';
  const cards = S.parseDeckCards(req.body?.cards);
  const v = S.validateDeck(cards, owned, catalog, settings.rules);
  if (!v.ok) throw new CardError(v.errors[0]);
  let deck;
  if (req.params.id) {
    const ex = await prisma.cardDeck.findFirst({ where: { id: req.params.id, userId } });
    if (!ex) throw new CardError('Baralho não encontrado.', 404);
    deck = await prisma.cardDeck.update({ where: { id: ex.id }, data: { name, cards: JSON.stringify(cards) } });
  } else {
    const n = await prisma.cardDeck.count({ where: { userId } });
    if (n >= MAX_DECKS) throw new CardError(`Máximo de ${MAX_DECKS} baralhos.`);
    deck = await prisma.cardDeck.create({ data: { userId, name, cards: JSON.stringify(cards), active: n === 0 } });
  }
  res.json({ deck: { id: deck.id, name: deck.name, active: deck.active, cards, valid: true, errors: [], total: v.total } });
});

const deleteDeck = handle(async (req, res) => {
  const r = await prisma.cardDeck.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
  if (!r.count) throw new CardError('Baralho não encontrado.', 404);
  res.json({ ok: true });
});

const activateDeck = handle(async (req, res) => {
  const userId = req.user.id;
  const ex = await prisma.cardDeck.findFirst({ where: { id: req.params.id, userId } });
  if (!ex) throw new CardError('Baralho não encontrado.', 404);
  await prisma.$transaction([
    prisma.cardDeck.updateMany({ where: { userId }, data: { active: false } }),
    prisma.cardDeck.update({ where: { id: ex.id }, data: { active: true } }),
  ]);
  res.json({ ok: true });
});

const suggestDeck = handle(async (req, res) => {
  const settings = await S.getSettings();
  const catalog = await S.getCatalog();
  const owned = await S.ownedMap(req.user.id);
  const cards = S.autoDeck(owned, catalog, settings.rules);
  res.json({ cards, total: cards.reduce((s, c) => s + c.copies, 0) });
});

// ---------- Partidas ----------
async function pendingChallengesFor(userId) {
  const since = new Date(Date.now() - 5 * 60_000);
  const rows = await prisma.cardMatch.findMany({
    where: { mode: 'PVP', status: 'PENDING', createdAt: { gte: since }, OR: [{ p1Id: userId }, { p2Id: userId }] },
    orderBy: { createdAt: 'desc' }, take: 20,
  });
  const ids = [...new Set(rows.flatMap((r) => [r.p1Id, r.p2Id]).filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: PUBLIC_USER_FIELDS }) : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  return rows.map((r) => ({ id: r.id, incoming: r.p2Id === userId, from: byId[r.p1Id] || null, to: byId[r.p2Id] || null, createdAt: r.createdAt }));
}

// Registro de ações para o replay (limitado para não crescer sem fim).
function appendActions(raw, more) {
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  list.push(...more);
  return JSON.stringify(list.slice(0, 1500));
}

// Lado de cada jogador: 1v1 → p1 = 0, p2 = 1. 2v2 → p1 e p3 = time 0, p2 e p4 = time 1.
function seatOf(m, userId) {
  if (!userId) return -1;
  if (m.p1Id === userId || m.p3Id === userId) return 0;
  if (m.p2Id === userId || m.p4Id === userId) return 1;
  return -1;
}
const playersOf = (m) => [m.p1Id, m.p2Id, m.p3Id, m.p4Id].filter(Boolean);
function rewardFor(m, userId, seat) {
  const i = [m.p1Id, m.p2Id, m.p3Id, m.p4Id].indexOf(userId);
  if (i >= 0) return [m.reward1, m.reward2, m.reward3, m.reward4][i] || 0;
  return seat === 0 ? m.reward1 : m.reward2;
}

function payload(m, seat, state, extra = {}) {
  const { viewer = null, ...rest } = extra;
  return {
    id: m.id, mode: m.mode, difficulty: m.difficulty, status: m.status, version: m.version, format: m.format || '1V1', custom: !!m.custom,
    turnDeadline: m.turnDeadline, reward: rewardFor(m, viewer, seat), boardId: m.boardId || null, lobbyId: m.lobbyId || null,
    spectators: spectatorCount(m.id), kind: m.kind || null, emotes: recentEmotes(m.id),
    view: state ? viewFor(state, seat, viewer) : null, ...rest,
  };
}

// Bots jogam enquanto for a vez deles (PvE e 2v2 com bot).
function runBots(state, m) {
  const events = [];
  const actions = [];
  let guard = 0;
  while (!state.over && state.players[state.active].isBot && guard < 8) {
    guard += 1;
    const seat = state.active;
    const r = playTurn(state, seat, state.players[seat].difficulty || m.difficulty || 'MEDIO');
    state = r.state;
    events.push(...r.events);
    actions.push(...r.actions.map((a) => ({ s: seat, a })));
  }
  return { state, events, actions };
}
const timedMatch = (m) => m.mode === 'PVP';
function notifyOthers(req, m, exceptId, event, data) {
  for (const uid of playersOf(m)) if (uid !== exceptId) notify(req, uid, event, data);
}

function notify(req, userId, event, data) {
  if (userId) req.app.get('io')?.notifyUser?.(userId, event, data);
}

async function playerSeatInfo(userId) {
  const [u, cosmetics] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true, avatarUrl: true } }),
    require('../cards/progress').cosmeticsFor(userId).catch(() => null),
  ]);
  return { userId, name: u?.displayName || 'Jogador', avatarUrl: u?.avatarUrl || null, cosmetics };
}

const BOT_NAMES = { FACIL: 'Aprendiz Pip', MEDIO: 'Duelista Nora', DIFICIL: 'Mestre Kael', LENDARIO: 'Arquimaga Vex' };

// Cria partida contra bot (normal ou fase da campanha). Guarda o estado
// inicial e o registro de ações para o replay.
async function newPveMatch(userId, { difficulty, botName, botHp, botDeck, campaignStageId = null, boardId = null, kind = null, rulesExtra = null, playerDeck = null }) {
  const settings = await S.getSettings();
  const busyPvp = await prisma.cardMatch.findFirst({ where: { mode: 'PVP', status: 'ACTIVE', OR: [{ p1Id: userId }, { p2Id: userId }, { p3Id: userId }, { p4Id: userId }] } });
  if (busyPvp) throw new CardError('Termine sua partida PvP antes de começar outra.');
  const deck = playerDeck || await S.resolvePlayerDeck(userId, settings);
  const bot = botDeck ? { deck: botDeck, hp: botHp } : await S.botDeck(difficulty, settings);
  // Só uma partida contra bot por vez: a antiga é abandonada (sem recompensa).
  await prisma.cardMatch.updateMany({ where: { p1Id: userId, mode: 'PVE', status: 'ACTIVE' }, data: { status: 'CANCELLED', endReason: 'abandoned', endedAt: new Date() } });
  const me = await playerSeatInfo(userId);
  const chosenBoard = await S.pickBoardId(boardId);
  const rules = await S.matchRules(settings, chosenBoard, rulesExtra || {});
  const heroHp = rulesExtra?.startHp || null;
  let state = createGame({
    players: [{ ...me, deck, ...(heroHp ? { hp: heroHp } : {}) }, { userId: null, name: botName || BOT_NAMES[difficulty], isBot: true, difficulty, hp: heroHp || botHp || bot.hp, deck: bot.deck }],
    rules, seed: crypto.randomInt(1, 2 ** 31), first: crypto.randomInt(2),
  });
  const initialState = JSON.stringify(state);
  let events = [];
  let actions = [];
  if (state.active === 1) { const r = playTurn(state, 1, difficulty); state = r.state; events = r.events; actions = r.actions.map((a) => ({ s: 1, a })); }
  const m = await prisma.cardMatch.create({ data: { mode: 'PVE', difficulty, p1Id: userId, status: 'ACTIVE', state: JSON.stringify(state), initialState, actions: JSON.stringify(actions), campaignStageId, boardId: chosenBoard, kind } });
  return payload(m, 0, state, { events: eventsFor(events, 0), viewer: userId });
}

const startPve = handle(async (req, res) => {
  const userId = req.user.id;
  await requireActivePlayer(userId);
  const settings = await S.getSettings();
  if (!settings.enabled.pve) throw new CardError('Partidas contra bots estão desativadas.');
  const difficulty = DIFFICULTIES[req.body?.difficulty] ? req.body.difficulty : 'MEDIO';
  res.json(await newPveMatch(userId, { difficulty }));
});

// Cria partida PvP já ativa (desafio aceito, partida rápida ou torneio).
async function newPvpMatch(p1Id, p2Id, { pendingId = null, tournamentId = null } = {}) {
  const settings = await S.getSettings();
  let d1;
  try { d1 = await S.resolvePlayerDeck(p1Id, settings); } catch { throw new CardError('O baralho de um dos jogadores não é válido.'); }
  const d2 = await S.resolvePlayerDeck(p2Id, settings);
  const [a, b] = await Promise.all([playerSeatInfo(p1Id), playerSeatInfo(p2Id)]);
  const boardId = await S.pickBoardId();
  const rules = await S.matchRules(settings, boardId);
  const state = createGame({ players: [{ ...a, deck: d1 }, { ...b, deck: d2 }], rules, seed: crypto.randomInt(1, 2 ** 31), first: crypto.randomInt(2) });
  const data = { status: 'ACTIVE', boardId, state: JSON.stringify(state), initialState: JSON.stringify(state), actions: '[]', turnDeadline: new Date(Date.now() + settings.rules.turnSeconds * 1000), version: 1 };
  if (pendingId) {
    const r = await prisma.cardMatch.updateMany({ where: { id: pendingId, status: 'PENDING' }, data });
    if (r.count === 0) throw new CardError('Esse desafio não está mais disponível.');
    return { match: await prisma.cardMatch.findUnique({ where: { id: pendingId } }), state };
  }
  const match = await prisma.cardMatch.create({ data: { mode: 'PVP', p1Id, p2Id, tournamentId, ...data } });
  return { match, state };
}

const challenge = handle(async (req, res) => {
  const userId = req.user.id;
  await requireActivePlayer(userId);
  const settings = await S.getSettings();
  if (!settings.enabled.pvp) throw new CardError('Partidas PvP estão desativadas.');
  const targetId = String(req.body?.userId || '');
  if (!targetId || targetId === userId) throw new CardError('Escolha outra pessoa para desafiar.');
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: PUBLIC_USER_FIELDS });
  if (!target) throw new CardError('Usuário não encontrado.', 404);
  const tp = await S.getPlayer(targetId);
  if (tp.banned) throw new CardError('Essa pessoa não pode jogar agora.');
  // Valida o próprio baralho já no desafio (evita desafio impossível).
  await S.resolvePlayerDeck(userId, settings);
  const since = new Date(Date.now() - 5 * 60_000);
  const dup = await prisma.cardMatch.findFirst({ where: { mode: 'PVP', status: 'PENDING', p1Id: userId, p2Id: targetId, createdAt: { gte: since } } });
  if (dup) return res.json({ id: dup.id, status: 'PENDING' });
  const mine = await prisma.cardMatch.count({ where: { mode: 'PVP', status: 'PENDING', p1Id: userId, createdAt: { gte: since } } });
  if (mine >= 5) throw new CardError('Você tem desafios demais pendentes. Espere alguns minutos.');
  const m = await prisma.cardMatch.create({ data: { mode: 'PVP', p1Id: userId, p2Id: targetId, status: 'PENDING' } });
  notify(req, targetId, 'cards:challenge', { id: m.id, from: { id: req.user.id, displayName: req.user.displayName, avatarUrl: req.user.avatarUrl } });
  res.json({ id: m.id, status: 'PENDING' });
});

const respondChallenge = (accept) => handle(async (req, res) => {
  const userId = req.user.id;
  const m = await prisma.cardMatch.findUnique({ where: { id: req.params.id } });
  if (!m || m.mode !== 'PVP') throw new CardError('Desafio não encontrado.', 404);
  if (m.status !== 'PENDING') throw new CardError('Esse desafio não está mais disponível.');
  if (Date.now() - new Date(m.createdAt).getTime() > 5 * 60_000) {
    await prisma.cardMatch.updateMany({ where: { id: m.id, status: 'PENDING' }, data: { status: 'CANCELLED', endReason: 'expired' } });
    throw new CardError('Esse desafio expirou.');
  }
  if (!accept) {
    if (m.p1Id !== userId && m.p2Id !== userId) throw new CardError('Desafio não encontrado.', 404);
    await prisma.cardMatch.updateMany({ where: { id: m.id, status: 'PENDING' }, data: { status: m.p1Id === userId ? 'CANCELLED' : 'DECLINED', endedAt: new Date() } });
    notify(req, m.p1Id === userId ? m.p2Id : m.p1Id, 'cards:match', { id: m.id });
    return res.json({ ok: true });
  }
  if (m.p2Id !== userId) throw new CardError('Só quem foi desafiado pode aceitar.', 403);
  await requireActivePlayer(userId);
  const settings = await S.getSettings();
  const busy = await prisma.cardMatch.findFirst({ where: { mode: 'PVP', status: 'ACTIVE', OR: [{ p1Id: { in: [m.p1Id, m.p2Id] } }, { p2Id: { in: [m.p1Id, m.p2Id] } }] } });
  if (busy) throw new CardError('Um de vocês já está em outra partida PvP.');
  void settings;
  const { match: fresh, state } = await newPvpMatch(m.p1Id, m.p2Id, { pendingId: m.id });
  notify(req, m.p1Id, 'cards:match', { id: m.id, started: true });
  res.json(payload(fresh, 1, state, { viewer: userId }));
});

// Resolve prazo de turno estourado (PvP). Qualquer leitura ou ação chama isto.
async function applyTimeoutIfNeeded(req, m) {
  if (m.mode !== 'PVP' || m.status !== 'ACTIVE' || !m.turnDeadline) return m;
  if (Date.now() < new Date(m.turnDeadline).getTime() + 1500) return m;
  const settings = await S.getSettings();
  let state = JSON.parse(m.state);
  const timedOut = state.active;
  const r = reduce(state, state.active, { type: 'TIMEOUT' });
  state = r.state;
  const bots = runBots(state, m);
  state = bots.state;
  const log = appendActions(m.actions, [{ s: timedOut, a: { type: 'TIMEOUT' } }, ...bots.actions]);
  const turnSecs = state.rules?.turnSeconds || settings.rules.turnSeconds;
  const upd = await prisma.cardMatch.updateMany({
    where: { id: m.id, version: m.version, status: 'ACTIVE' },
    data: { state: JSON.stringify(state), actions: log, version: { increment: 1 }, turnDeadline: state.over ? null : new Date(Date.now() + turnSecs * 1000) },
  });
  if (upd.count) {
    if (state.over) await S.finalizeMatch(m, state, settings, req.app.get('io'));
    notifyOthers(req, m, null, 'cards:match', { id: m.id });
  }
  return prisma.cardMatch.findUnique({ where: { id: m.id } });
}

const getMatch = handle(async (req, res) => {
  let m = await prisma.cardMatch.findUnique({ where: { id: req.params.id } });
  const seat = m ? seatOf(m, req.user.id) : -1;
  if (!m || seat < 0) throw new CardError('Partida não encontrada.', 404);
  m = await applyTimeoutIfNeeded(req, m);
  const state = m.state ? JSON.parse(m.state) : null;
  const oppId = seat === 0 ? m.p2Id : m.p1Id;
  const opponent = oppId ? await prisma.user.findUnique({ where: { id: oppId }, select: PUBLIC_USER_FIELDS }) : null;
  res.json(payload(m, seat, state, { opponent, viewer: req.user.id }));
});

const action = handle(async (req, res) => {
  const userId = req.user.id;
  let m = await prisma.cardMatch.findUnique({ where: { id: req.params.id } });
  const seat = m ? seatOf(m, userId) : -1;
  if (!m || seat < 0) throw new CardError('Partida não encontrada.', 404);
  m = await applyTimeoutIfNeeded(req, m);
  if (m.status !== 'ACTIVE') return res.json(payload(m, seat, m.state ? JSON.parse(m.state) : null, { events: [], viewer: userId }));
  const settings = await S.getSettings();
  const body = req.body || {};
  const act = {
    type: ['PLAY', 'ATTACK', 'END_TURN', 'SURRENDER', 'POWER'].includes(body.type) ? body.type : 'INVALID',
    uid: typeof body.uid === 'string' ? body.uid.slice(0, 20) : undefined,
    target: typeof body.target === 'string' ? body.target.slice(0, 20) : undefined,
  };
  let state = JSON.parse(m.state);
  // 2v2: só o membro da vez joga (desistir vale pelo time a qualquer hora).
  if (state.players[seat].bench?.length && act.type !== 'SURRENDER' && state.players[seat].userId !== userId) {
    throw new CardError('É a vez do seu parceiro. Acompanhe e ajude na estratégia!');
  }
  const before = `${state.active}:${state.players[state.active].userId}`;
  const r = reduce(state, seat, act); // EngineError → 400
  state = r.state;
  const events = [...r.events];
  const newActions = [{ s: seat, a: act }];
  const bot = runBots(state, m);
  state = bot.state;
  events.push(...bot.events);
  newActions.push(...bot.actions);
  const turnChanged = `${state.active}:${state.players[state.active].userId}` !== before;
  const turnSecs = state.rules?.turnSeconds || settings.rules.turnSeconds;
  const upd = await prisma.cardMatch.updateMany({
    where: { id: m.id, version: m.version, status: 'ACTIVE' },
    data: {
      state: JSON.stringify(state), actions: appendActions(m.actions, newActions), version: { increment: 1 },
      ...(timedMatch(m) ? { turnDeadline: state.over ? null : (turnChanged ? new Date(Date.now() + turnSecs * 1000) : m.turnDeadline) } : {}),
    },
  });
  if (upd.count === 0) throw new CardError('A partida mudou enquanto você jogava. Atualizando…', 409);
  let result = null;
  if (state.over) result = await S.finalizeMatch(m, state, settings, req.app.get('io'));
  const fresh = await prisma.cardMatch.findUnique({ where: { id: m.id } });
  if (m.mode === 'PVP') notifyOthers(req, m, userId, 'cards:match', { id: m.id, version: fresh.version });
  res.json(payload(fresh, seat, state, { events: eventsFor(events, seat), result, viewer: userId }));
});

const history = handle(async (req, res) => {
  const userId = req.user.id;
  const rows = await prisma.cardMatch.findMany({
    where: { status: 'FINISHED', OR: [{ p1Id: userId }, { p2Id: userId }, { p3Id: userId }, { p4Id: userId }] },
    orderBy: { endedAt: 'desc' }, take: 20,
    select: { id: true, mode: true, difficulty: true, p1Id: true, p2Id: true, p3Id: true, p4Id: true, format: true, custom: true, winnerId: true, reward1: true, reward2: true, reward3: true, reward4: true, endReason: true, endedAt: true },
  });
  const ids = [...new Set(rows.flatMap((r) => [r.p1Id, r.p2Id]).filter((x) => x && x !== userId))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: PUBLIC_USER_FIELDS }) : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  res.json({
    matches: rows.map((r) => {
      const seat = seatOf(r, userId);
      const oppId = seat === 0 ? r.p2Id : r.p1Id;
      const winSeat = r.winnerId ? seatOf(r, r.winnerId) : -1;
      const duo = r.format === '2V2';
      return {
        id: r.id, mode: r.mode, difficulty: r.difficulty, format: r.format, custom: r.custom, won: duo ? winSeat === seat : r.winnerId === userId, reward: rewardFor(r, userId, seat), endReason: r.endReason, endedAt: r.endedAt,
        opponent: duo ? { displayName: `Time de ${byId[oppId]?.displayName || 'Bots'}`, ...(byId[oppId] ? { avatarUrl: byId[oppId].avatarUrl, id: oppId } : { bot: true }) } : oppId ? byId[oppId] || null : { displayName: BOT_NAMES[r.difficulty] || 'Bot', bot: true },
      };
    }),
  });
});

const ranking = handle(async (req, res) => {
  const by = ['wins', 'season'].includes(req.query.by) ? req.query.by : 'rating';
  const where = by === 'season'
    ? { banned: false, seasonKey: S.seasonKeyOf(), OR: [{ seasonWins: { gt: 0 } }, { seasonLosses: { gt: 0 } }] }
    : { banned: false, ...(by === 'rating' ? { OR: [{ pvpWins: { gt: 0 } }, { pvpLosses: { gt: 0 } }] } : { wins: { gt: 0 } }) };
  const orderBy = by === 'season' ? [{ seasonRating: 'desc' }, { seasonWins: 'desc' }] : by === 'rating' ? [{ rating: 'desc' }, { pvpWins: 'desc' }] : [{ wins: 'desc' }];
  // Ranking só entre amigos (inclui você).
  const friendsOnly = req.query.amigos === '1';
  if (friendsOnly) {
    const fr = await prisma.friendship.findMany({ where: { status: 'ACCEPTED', OR: [{ requesterId: req.user.id }, { addresseeId: req.user.id }] }, select: { requesterId: true, addresseeId: true }, take: 1000 });
    const ids = new Set([req.user.id]);
    for (const f of fr) ids.add(f.requesterId === req.user.id ? f.addresseeId : f.requesterId);
    where.userId = { in: [...ids] };
  }
  const rows = await prisma.cardPlayer.findMany({ where, orderBy, take: 50 });
  const users = rows.length ? await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: PUBLIC_USER_FIELDS }) : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  res.json({ by, friends: friendsOnly, players: rows.filter((r) => byId[r.userId]).map((r, i) => ({ rank: i + 1, user: byId[r.userId], ...publicPlayer(r) })) });
});

// ---------- Trocas ----------
function parseItems(raw) {
  if (!Array.isArray(raw)) return [];
  const merged = new Map();
  for (const it of raw.slice(0, 20)) {
    const id = typeof it?.cardId === 'string' ? it.cardId : null;
    const q = Math.max(0, Math.min(50, parseInt(it?.qty, 10) || 0));
    const key = `${id}|${it?.foil === true ? 1 : 0}`;
    if (id && q) merged.set(key, (merged.get(key) || 0) + q);
  }
  return [...merged].map(([k, qty]) => { const [cardId, f] = k.split('|'); return { cardId, qty, ...(f === '1' ? { foil: true } : {}) }; }).slice(0, 10);
}

async function shapeTrades(rows, userId) {
  const catalog = await S.getCatalog();
  const ids = [...new Set(rows.flatMap((r) => [r.fromId, r.toId]))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: PUBLIC_USER_FIELDS }) : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const items = (raw) => safeJson(raw, []).map((i) => ({ ...i, card: catalog.byId.get(i.cardId) ? S.shapeCard(catalog.byId.get(i.cardId)) : null }));
  return rows.map((r) => ({
    id: r.id, status: r.status, message: r.message, createdAt: r.createdAt, resolvedAt: r.resolvedAt,
    incoming: r.toId === userId, from: byId[r.fromId] || null, to: byId[r.toId] || null,
    offer: items(r.offer), request: items(r.request), offerCoins: r.offerCoins, requestCoins: r.requestCoins,
  }));
}

const listTrades = handle(async (req, res) => {
  const userId = req.user.id;
  const rows = await prisma.cardTrade.findMany({ where: { OR: [{ fromId: userId }, { toId: userId }] }, orderBy: { createdAt: 'desc' }, take: 40 });
  res.json({ trades: await shapeTrades(rows, userId) });
});

const createTrade = handle(async (req, res) => {
  const userId = req.user.id;
  await requireActivePlayer(userId);
  const settings = await S.getSettings();
  if (!settings.enabled.trades) throw new CardError('As trocas estão desativadas no momento.');
  const toId = String(req.body?.toId || '');
  if (!toId || toId === userId) throw new CardError('Escolha outra pessoa para trocar.');
  const to = await prisma.user.findUnique({ where: { id: toId }, select: { id: true } });
  if (!to) throw new CardError('Usuário não encontrado.', 404);
  const tp = await S.getPlayer(toId);
  if (tp.banned) throw new CardError('Essa pessoa não pode trocar agora.');
  const offer = parseItems(req.body?.offer);
  const request = parseItems(req.body?.request);
  const maxCoins = settings.economy.tradeMaxCoins;
  const offerCoins = Math.max(0, Math.min(maxCoins, parseInt(req.body?.offerCoins, 10) || 0));
  const requestCoins = Math.max(0, Math.min(maxCoins, parseInt(req.body?.requestCoins, 10) || 0));
  if (!offer.length && !offerCoins) throw new CardError('Ofereça pelo menos uma carta ou moedas.');
  if (!request.length && !requestCoins) throw new CardError('Peça pelo menos uma carta ou moedas.');
  const open = await prisma.cardTrade.count({ where: { fromId: userId, status: 'PENDING' } });
  if (open >= settings.economy.maxOpenTrades) throw new CardError(`Você já tem ${open} trocas abertas.`);
  const catalog = await S.getCatalog();
  const [mine, theirs] = await Promise.all([S.ownedMap(userId), S.ownedMap(toId)]);
  const need = (list) => { const m = new Map(); for (const it of list) { const k = it.cardId; const cur = m.get(k) || { q: 0, f: 0 }; cur.q += it.qty; if (it.foil) cur.f += it.qty; m.set(k, cur); } return m; };
  for (const [cardId, n] of need(offer)) {
    const c = catalog.byId.get(cardId);
    if (!c) throw new CardError('Carta inválida na oferta.');
    const row = mine.get(cardId);
    if ((row?.quantity || 0) < n.q) throw new CardError(`Você não tem ${n.q}x ${c.name}.`);
    if ((row?.foil || 0) < n.f) throw new CardError(`Você não tem ${n.f}x ${c.name} brilhante.`);
  }
  for (const [cardId, n] of need(request)) {
    const c = catalog.byId.get(cardId);
    if (!c) throw new CardError('Carta inválida no pedido.');
    const row = theirs.get(cardId);
    if ((row?.quantity || 0) < n.q) throw new CardError(`A outra pessoa não tem ${n.q}x ${c.name}.`);
    if ((row?.foil || 0) < n.f) throw new CardError(`A outra pessoa não tem ${n.f}x ${c.name} brilhante.`);
  }
  const t = await prisma.cardTrade.create({
    data: { fromId: userId, toId, offer: JSON.stringify(offer), request: JSON.stringify(request), offerCoins, requestCoins, message: String(req.body?.message || '').trim().slice(0, 180) || null },
  });
  notify(req, toId, 'cards:trade', { id: t.id });
  const [shaped] = await shapeTrades([t], userId);
  res.json({ trade: shaped });
});

// Move cartas com checagem atômica de posse (falha = rollback de tudo).
async function moveCards(tx, fromId, toId, items) {
  for (const it of items) {
    const f = it.foil ? it.qty : 0;
    const r = await tx.userCard.updateMany({
      where: { userId: fromId, cardId: it.cardId, quantity: { gte: it.qty }, ...(f ? { foil: { gte: f } } : {}) },
      data: { quantity: { decrement: it.qty }, ...(f ? { foil: { decrement: f } } : {}) },
    });
    if (r.count === 0) throw new CardError('Alguém não tem mais as cartas da troca. A troca foi cancelada.');
    if (!f) await S.clampFoil(tx, fromId, it.cardId);
    await tx.userCard.upsert({ where: { userId_cardId: { userId: toId, cardId: it.cardId } }, update: { quantity: { increment: it.qty }, ...(f ? { foil: { increment: f } } : {}) }, create: { userId: toId, cardId: it.cardId, quantity: it.qty, foil: f } });
  }
}
async function moveCoins(tx, fromId, toId, coins) {
  if (!coins) return;
  const r = await tx.user.updateMany({ where: { id: fromId, coins: { gte: coins } }, data: { coins: { decrement: coins } } });
  if (r.count === 0) throw new CardError('Moedas insuficientes para concluir a troca.');
  await tx.user.update({ where: { id: toId }, data: { coins: { increment: coins } } });
}

const respondTrade = (kind) => handle(async (req, res) => {
  const userId = req.user.id;
  const t = await prisma.cardTrade.findUnique({ where: { id: req.params.id } });
  if (!t || (t.fromId !== userId && t.toId !== userId)) throw new CardError('Troca não encontrada.', 404);
  if (t.status !== 'PENDING') throw new CardError('Essa troca já foi resolvida.');
  if (kind === 'cancel' && t.fromId !== userId) throw new CardError('Só quem propôs pode cancelar.', 403);
  if ((kind === 'accept' || kind === 'decline') && t.toId !== userId) throw new CardError('Só quem recebeu pode responder.', 403);
  if (kind !== 'accept') {
    await prisma.cardTrade.updateMany({ where: { id: t.id, status: 'PENDING' }, data: { status: kind === 'cancel' ? 'CANCELLED' : 'DECLINED', resolvedAt: new Date() } });
    notify(req, kind === 'cancel' ? t.toId : t.fromId, 'cards:trade', { id: t.id });
    return res.json({ ok: true });
  }
  await requireActivePlayer(userId);
  const fromP = await S.getPlayer(t.fromId);
  if (fromP.banned) throw new CardError('A outra pessoa não pode trocar agora.');
  const settings = await S.getSettings();
  if (!settings.enabled.trades) throw new CardError('As trocas estão desativadas no momento.');
  try {
    await prisma.$transaction(async (tx) => {
      const lock = await tx.cardTrade.updateMany({ where: { id: t.id, status: 'PENDING' }, data: { status: 'ACCEPTED', resolvedAt: new Date() } });
      if (lock.count === 0) throw new CardError('Essa troca já foi resolvida.');
      await moveCards(tx, t.fromId, t.toId, safeJson(t.offer, []));
      await moveCards(tx, t.toId, t.fromId, safeJson(t.request, []));
      await moveCoins(tx, t.fromId, t.toId, t.offerCoins);
      await moveCoins(tx, t.toId, t.fromId, t.requestCoins);
    });
  } catch (e) {
    if (e instanceof CardError && !/já foi resolvida/.test(e.message)) {
      await prisma.cardTrade.updateMany({ where: { id: t.id, status: 'PENDING' }, data: { status: 'FAILED', resolvedAt: new Date() } });
    }
    throw e;
  }
  if (t.offerCoins) { ledger().recordTransaction(t.fromId, { kind: 'CARDS', label: 'Jogo de Cartas: troca', coins: -t.offerCoins }); ledger().recordTransaction(t.toId, { kind: 'CARDS', label: 'Jogo de Cartas: troca', coins: t.offerCoins }); }
  if (t.requestCoins) { ledger().recordTransaction(t.toId, { kind: 'CARDS', label: 'Jogo de Cartas: troca', coins: -t.requestCoins }); ledger().recordTransaction(t.fromId, { kind: 'CARDS', label: 'Jogo de Cartas: troca', coins: t.requestCoins }); }
  notify(req, t.fromId, 'cards:trade', { id: t.id, accepted: true });
  S.afterActivity(t.fromId, [['CARDS_TRADE', 1]], req.app.get('io'));
  S.afterActivity(t.toId, [['CARDS_TRADE', 1]], req.app.get('io'));
  res.json({ ok: true });
});

module.exports = {
  newPveMatch, newPvpMatch, playerSeatInfo, notify, payload, seatOf, playersOf, runBots, notifyOthers, appendActions, applyTimeoutIfNeeded, requireActivePlayer, handle, BOT_NAMES, safeJson,
  home, claimStarter, collection, userCollection, profileSummary, sellCard, levelUp,
  listPacks, openPack, listDecks, saveDeck, deleteDeck, activateDeck, suggestDeck,
  startPve, challenge, acceptChallenge: respondChallenge(true), declineChallenge: respondChallenge(false),
  getMatch, action, history, ranking, listTrades, createTrade,
  acceptTrade: respondTrade('accept'), declineTrade: respondTrade('decline'), cancelTrade: respondTrade('cancel'),
  abilityText,
};
