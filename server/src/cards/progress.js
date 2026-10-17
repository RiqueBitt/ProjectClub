// Jogo de Cartas — progressão: passe da temporada, baú de vitórias,
// sequência de dias, pó de criação, cosméticos e cartas douradas.
// Tudo atômico no banco (updateMany com condição) pra não pagar duas vezes.
const prisma = require('../config/prisma');
const S = require('./service');

const { CardError } = S;

// ---------- Pó de criação ----------
const DUST_VALUES = { COMUM: 5, INCOMUM: 20, RARA: 50, EPICA: 200, LENDARIA: 800, MITICA: 1600 };
const CRAFT_COSTS = { COMUM: 40, INCOMUM: 100, RARA: 300, EPICA: 1000, LENDARIA: 3000, MITICA: 6000 };

// ---------- Cosméticos (seed) ----------
const SEED_COSMETICS = [
  { key: 'back:classico', kind: 'BACK', name: 'Clássico', rarity: 'COMUM', source: 'FREE', sort: 0 },
  { key: 'back:aurora', kind: 'BACK', name: 'Aurora', rarity: 'RARA', priceGems: 40, sort: 1 },
  { key: 'back:vulcanico', kind: 'BACK', name: 'Vulcânico', rarity: 'RARA', priceGems: 40, sort: 2 },
  { key: 'back:oceano', kind: 'BACK', name: 'Abissal', rarity: 'RARA', priceGems: 40, sort: 3 },
  { key: 'back:galaxia', kind: 'BACK', name: 'Galáxia', rarity: 'EPICA', priceGems: 80, sort: 4 },
  { key: 'back:sombrio', kind: 'BACK', name: 'Sombrio', rarity: 'EPICA', source: 'PASS', sort: 5 },
  { key: 'back:dourado', kind: 'BACK', name: 'Dourado', rarity: 'LENDARIA', source: 'PASS', sort: 6 },
  { key: 'frame:padrao', kind: 'FRAME', name: 'Padrão', rarity: 'COMUM', source: 'FREE', sort: 10 },
  { key: 'frame:chamas', kind: 'FRAME', name: 'Chamas', rarity: 'RARA', priceGems: 50, sort: 11 },
  { key: 'frame:gelo', kind: 'FRAME', name: 'Gelo Eterno', rarity: 'RARA', priceGems: 50, sort: 12 },
  { key: 'frame:neon', kind: 'FRAME', name: 'Neon', rarity: 'EPICA', priceGems: 80, sort: 13 },
  { key: 'frame:real', kind: 'FRAME', name: 'Coroa Real', rarity: 'LENDARIA', source: 'PASS', sort: 14 },
];

// ---------- Passe ----------
const PASS_COSMETICS = { 10: 'back:sombrio', 20: 'frame:real', 30: 'back:dourado' };
function passReward(level) {
  if (PASS_COSMETICS[level]) return { cosmetic: PASS_COSMETICS[level], gems: level === 30 ? 25 : level === 20 ? 15 : 10 };
  if (level % 5 === 0) return { pack: 5, gems: 5 };
  return { coins: 40 + level * 5 };
}
const passLevelOf = (xp, per, max) => Math.min(max, Math.floor(Math.max(0, xp) / Math.max(1, per)));

async function addPassXp(userId, amount) {
  const n = Math.max(0, Math.trunc(amount || 0));
  if (!userId || !n) return null;
  const seasonKey = S.seasonKeyOf();
  return prisma.cardPass.upsert({
    where: { userId_seasonKey: { userId, seasonKey } },
    update: { xp: { increment: n } },
    create: { userId, seasonKey, xp: n, claimed: '[]' },
  }).catch(() => null);
}
async function addPassXpFor(userId, source) {
  const X = (await S.getSettings()).extras;
  const amount = { win: X.passXpWin, loss: X.passXpLoss, mission: X.passXpMission, pack: X.passXpPack }[source] || 0;
  return addPassXp(userId, amount);
}

async function passState(userId) {
  const X = (await S.getSettings()).extras;
  const seasonKey = S.seasonKeyOf();
  const row = await prisma.cardPass.findUnique({ where: { userId_seasonKey: { userId, seasonKey } } });
  const xp = row?.xp || 0;
  const per = Math.max(10, X.passXpPerLevel | 0);
  const max = Math.max(5, X.passLevels | 0);
  const level = passLevelOf(xp, per, max);
  let claimed = [];
  try { claimed = JSON.parse(row?.claimed || '[]'); } catch { claimed = []; }
  const cos = await prisma.cardCosmetic.findMany({ where: { key: { in: Object.values(PASS_COSMETICS) } } });
  const names = Object.fromEntries(cos.map((c) => [c.key, c.name]));
  const levels = Array.from({ length: max }, (_, i) => {
    const lv = i + 1;
    const rw = passReward(lv);
    return { level: lv, reward: { ...rw, cosmeticName: rw.cosmetic ? names[rw.cosmetic] || rw.cosmetic : undefined }, unlocked: lv <= level, claimed: claimed.includes(lv) };
  });
  const now = new Date();
  return { seasonKey, xp, level, perLevel: per, max, intoLevel: xp - level * per, levels, endsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 3)) };
}

// Resgata um nível do passe (uma vez só; trava pela lista de resgatados).
async function claimPass(userId, level) {
  const st = await passState(userId);
  const lv = parseInt(level, 10);
  const item = st.levels.find((x) => x.level === lv);
  if (!item) throw new CardError('Nível inválido.');
  if (!item.unlocked) throw new CardError('Você ainda não chegou nesse nível do passe.');
  if (item.claimed) throw new CardError('Esse prêmio já foi resgatado.');
  const row = await prisma.cardPass.findUnique({ where: { userId_seasonKey: { userId, seasonKey: st.seasonKey } } });
  const before = row.claimed || '[]';
  let list = [];
  try { list = JSON.parse(before); } catch { list = []; }
  list.push(lv);
  const lock = await prisma.cardPass.updateMany({ where: { id: row.id, claimed: before }, data: { claimed: JSON.stringify(list) } });
  if (!lock.count) throw new CardError('Tente de novo.', 409);
  const rw = passReward(lv);
  const out = { level: lv, coins: rw.coins || 0, gems: rw.gems || 0, cards: [], cosmetic: null };
  await prisma.$transaction(async (tx) => {
    if (out.coins || out.gems) await tx.user.update({ where: { id: userId }, data: { coins: { increment: out.coins }, gems: { increment: out.gems } } });
    if (rw.pack) {
      const catalog = await S.getCatalog();
      const cards = S.drawPack({ cardsPerPack: rw.pack, guaranteed: 'RARA', poolMode: 'ALL', weights: JSON.stringify({ COMUM: 45, INCOMUM: 32, RARA: 16, EPICA: 5.5, LENDARIA: 1.3, MITICA: 0.2 }) }, catalog);
      await S.grantCards(tx, userId, cards.map((c) => c.id));
      out.cards = cards.map((c) => S.shapeCard(c));
    }
    if (rw.cosmetic) {
      const c = await tx.cardCosmetic.findUnique({ where: { key: rw.cosmetic } });
      if (c) {
        await tx.userCardCosmetic.upsert({ where: { userId_cosmeticId: { userId, cosmeticId: c.id } }, update: {}, create: { userId, cosmeticId: c.id } });
        out.cosmetic = { key: c.key, name: c.name, kind: c.kind };
      }
    }
  });
  require('../services/economyLedger').recordTransaction(userId, { kind: 'CARDS', label: `Passe da Guerra das Cartas: nível ${lv}`, coins: out.coins, gems: out.gems });
  return out;
}

// ---------- Depois de cada partida (não personalizada) ----------
const yesterdayKey = () => S.dayKey(new Date(Date.now() - 86400000));
async function afterMatch(userId, won, settings) {
  if (!userId) return null;
  const X = settings.extras;
  const today = S.dayKey();
  const out = {};
  await addPassXp(userId, won ? X.passXpWin : X.passXpLoss);
  // Sequência: a primeira partida do dia paga um bônus que cresce por dia seguido.
  const p = await prisma.cardPlayer.findUnique({ where: { userId } });
  if (p && p.lastPlayDay !== today) {
    const days = p.lastPlayDay === yesterdayKey() ? p.streakDays + 1 : 1;
    const lock = await prisma.cardPlayer.updateMany({ where: { userId, OR: [{ lastPlayDay: null }, { lastPlayDay: { not: today } }] }, data: { lastPlayDay: today, streakDays: days } });
    if (lock.count) {
      const table = Array.isArray(X.streakCoins) && X.streakCoins.length ? X.streakCoins : [20];
      const coins = Math.max(0, table[Math.min(days, table.length) - 1] | 0);
      if (coins) {
        await prisma.user.update({ where: { id: userId }, data: { coins: { increment: coins } } });
        require('../services/economyLedger').recordTransaction(userId, { kind: 'CARDS', label: `Guerra das Cartas: sequência de ${days} dia(s)`, coins });
      }
      out.daily = { days, coins };
    }
  }
  // Baú: conta vitórias do dia.
  if (won) {
    const q = await prisma.cardPlayer.findUnique({ where: { userId } });
    if (q.chestDay !== today) await prisma.cardPlayer.update({ where: { userId }, data: { chestDay: today, chestWins: 1, chestsOpened: 0 } });
    else await prisma.cardPlayer.update({ where: { userId }, data: { chestWins: { increment: 1 } } });
    const st = await chestState(userId, settings);
    if (st.ready > 0) out.chest = { ready: st.ready };
  }
  return out;
}

// ---------- Baú de vitórias ----------
async function chestState(userId, settings) {
  const X = (settings || await S.getSettings()).extras;
  const p = await S.getPlayer(userId);
  const today = S.dayKey();
  const every = Math.max(1, X.chestEvery | 0);
  const wins = p.chestDay === today ? p.chestWins : 0;
  const opened = p.chestDay === today ? p.chestsOpened : 0;
  const earned = Math.min(3, Math.floor(wins / every));
  return { wins, every, opened, earned, ready: Math.max(0, earned - opened), max: 3, toNext: earned >= 3 ? 0 : every - (wins % every), coins: X.chestCoins, cards: X.chestCards };
}
async function openChest(userId) {
  const settings = await S.getSettings();
  const st = await chestState(userId, settings);
  if (st.ready <= 0) throw new CardError(st.earned >= 3 ? 'Você já abriu os baús de hoje. Volte amanhã!' : `Vença mais ${st.toNext} partida(s) para liberar um baú.`);
  const today = S.dayKey();
  const lock = await prisma.cardPlayer.updateMany({ where: { userId, chestDay: today, chestsOpened: st.opened }, data: { chestsOpened: { increment: 1 } } });
  if (!lock.count) throw new CardError('Tente de novo.', 409);
  const X = settings.extras;
  const catalog = await S.getCatalog();
  const n = Math.max(0, Math.min(10, X.chestCards | 0));
  const cards = n ? S.drawPack({ cardsPerPack: n, guaranteed: null, poolMode: 'ALL', weights: JSON.stringify({ COMUM: 55, INCOMUM: 30, RARA: 12, EPICA: 2.6, LENDARIA: 0.35, MITICA: 0.05 }) }, catalog) : [];
  await prisma.$transaction(async (tx) => {
    if (X.chestCoins > 0) await tx.user.update({ where: { id: userId }, data: { coins: { increment: X.chestCoins | 0 } } });
    if (cards.length) await S.grantCards(tx, userId, cards.map((c) => c.id));
  });
  require('../services/economyLedger').recordTransaction(userId, { kind: 'CARDS', label: 'Guerra das Cartas: baú de vitórias', coins: X.chestCoins | 0 });
  return { coins: X.chestCoins | 0, cards: cards.map((c) => S.shapeCard(c)) };
}

// ---------- Pó: desmanchar / criar ----------
async function disenchant(userId, cardId, qty, golden = false) {
  const catalog = await S.getCatalog();
  const card = catalog.byId.get(cardId);
  if (!card) throw new CardError('Carta não encontrada.', 404);
  const n = Math.max(1, Math.min(50, parseInt(qty, 10) || 1));
  const each = (DUST_VALUES[card.rarity] || 5) * (golden ? 4 : 1);
  const gained = each * n;
  await prisma.$transaction(async (tx) => {
    // Sempre sobra pelo menos 1 cópia (desmanchar só repetidas).
    const where = golden
      ? { userId, cardId, quantity: { gte: n + 1 }, golden: { gte: n } }
      : { userId, cardId, quantity: { gte: n + 1 } };
    const r = await tx.userCard.updateMany({ where, data: { quantity: { decrement: n }, ...(golden ? { golden: { decrement: n } } : {}) } });
    if (!r.count) throw new CardError('Você só pode desmanchar cópias repetidas (fica pelo menos 1).');
    await S.clampFoil(tx, userId, cardId);
    await clampGolden(tx, userId, cardId);
    await tx.cardPlayer.upsert({ where: { userId }, update: { dust: { increment: gained } }, create: { userId, dust: gained } });
  });
  return { dust: gained, total: (await prisma.cardPlayer.findUnique({ where: { userId } })).dust };
}
async function craft(userId, cardId) {
  const catalog = await S.getCatalog();
  const card = catalog.byId.get(cardId);
  if (!card || !card.enabled) throw new CardError('Carta não encontrada.', 404);
  const cost = CRAFT_COSTS[card.rarity] || 100;
  await prisma.$transaction(async (tx) => {
    await tx.cardPlayer.upsert({ where: { userId }, update: {}, create: { userId } });
    const r = await tx.cardPlayer.updateMany({ where: { userId, dust: { gte: cost } }, data: { dust: { decrement: cost } } });
    if (!r.count) throw new CardError(`Pó insuficiente: precisa de ${cost}.`);
    await S.grantCards(tx, userId, [cardId]);
  });
  return { cost, card: S.shapeCard(card), total: (await prisma.cardPlayer.findUnique({ where: { userId } })).dust };
}
async function clampGolden(tx, userId, cardId) {
  const r = await tx.userCard.findUnique({ where: { userId_cardId: { userId, cardId } } });
  if (r && r.golden > r.quantity) await tx.userCard.update({ where: { id: r.id }, data: { golden: Math.max(0, r.quantity) } });
}

// ---------- Cosméticos ----------
let cosSeeded = false;
async function ensureCosmetics() {
  if (cosSeeded) return;
  try {
    if ((await prisma.cardCosmetic.count()) === 0) await prisma.cardCosmetic.createMany({ data: SEED_COSMETICS, skipDuplicates: true });
    cosSeeded = true;
  } catch { /* outro processo semeou */ cosSeeded = true; }
}
async function listCosmetics(userId) {
  await ensureCosmetics();
  const [all, mine, p] = await Promise.all([
    prisma.cardCosmetic.findMany({ where: { active: true }, orderBy: [{ sort: 'asc' }] }),
    prisma.userCardCosmetic.findMany({ where: { userId } }),
    S.getPlayer(userId),
  ]);
  const owned = new Set(mine.map((m) => m.cosmeticId));
  return {
    // Molduras do herói não são mais vendidas: só aparecem para quem já tem
    // (continuam valendo e podem ser equipadas). Versos são vendidos na Loja.
    items: all.filter((c) => c.kind !== 'FRAME' || c.source === 'FREE' || owned.has(c.id)).map((c) => ({
      id: c.id, key: c.key, kind: c.kind, name: c.name, rarity: c.rarity, priceGems: c.kind === 'FRAME' ? null : c.priceGems,
      source: c.kind === 'FRAME' && c.source === 'SHOP' ? 'RETIRED' : c.source, owned: c.source === 'FREE' || owned.has(c.id), createdAt: c.createdAt,
    })),
    equipped: { back: p.equippedBack || 'back:classico', frame: p.equippedFrame || 'frame:padrao' },
  };
}
async function buyCosmetic(userId, id) {
  await ensureCosmetics();
  const c = await prisma.cardCosmetic.findUnique({ where: { id } });
  if (!c || !c.active) throw new CardError('Item não encontrado.', 404);
  if (c.source !== 'SHOP' || !c.priceGems) throw new CardError(c.source === 'PASS' ? 'Esse item só sai no passe da temporada.' : 'Esse item é grátis.');
  if (c.kind === 'FRAME') throw new CardError('As molduras de herói não são mais vendidas.');
  await prisma.$transaction(async (tx) => {
    const has = await tx.userCardCosmetic.findUnique({ where: { userId_cosmeticId: { userId, cosmeticId: c.id } } });
    if (has) throw new CardError('Você já tem esse item.');
    const r = await tx.user.updateMany({ where: { id: userId, gems: { gte: c.priceGems } }, data: { gems: { decrement: c.priceGems } } });
    if (!r.count) throw new CardError('Gemas insuficientes.');
    await tx.userCardCosmetic.create({ data: { userId, cosmeticId: c.id } });
  });
  require('../services/economyLedger').recordTransaction(userId, { kind: 'CARDS', label: `Guerra das Cartas: verso ${c.name}`, gems: -c.priceGems });
  return { ok: true };
}
async function equipCosmetic(userId, key) {
  await ensureCosmetics();
  const c = await prisma.cardCosmetic.findUnique({ where: { key: String(key || '') } });
  if (!c) throw new CardError('Item não encontrado.', 404);
  if (c.source !== 'FREE') {
    const has = await prisma.userCardCosmetic.findUnique({ where: { userId_cosmeticId: { userId, cosmeticId: c.id } } });
    if (!has) throw new CardError('Você ainda não tem esse item.');
  }
  await prisma.cardPlayer.upsert({ where: { userId }, update: c.kind === 'BACK' ? { equippedBack: c.key } : { equippedFrame: c.key }, create: { userId, ...(c.kind === 'BACK' ? { equippedBack: c.key } : { equippedFrame: c.key }) } });
  return { ok: true };
}
async function cosmeticsFor(userId) {
  if (!userId) return null;
  const p = await prisma.cardPlayer.findUnique({ where: { userId }, select: { equippedBack: true, equippedFrame: true } }).catch(() => null);
  return { back: p?.equippedBack || 'back:classico', frame: p?.equippedFrame || 'frame:padrao' };
}

module.exports = {
  DUST_VALUES, CRAFT_COSTS, SEED_COSMETICS, passReward, passState, claimPass, addPassXp, addPassXpFor, afterMatch,
  chestState, openChest, disenchant, craft, clampGolden, listCosmetics, buyCosmetic, equipCosmetic, cosmeticsFor, ensureCosmetics,
};
