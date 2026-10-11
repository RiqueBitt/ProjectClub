// Jogo de Cartas — regras de negócio no servidor (configuração, catálogo,
// baralhos, pacotes, recompensas). O motor da batalha fica em engine.js.
const crypto = require('crypto');
const prisma = require('../config/prisma');
const {
  RARITIES, DIFFICULTIES, mergeSettings, cardPower,
} = require('./config');
const { SEED_CARDS, SEED_PACKS } = require('./seed');

class CardError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (d = new Date()) => DAY_FMT.format(d);
const rankOf = (r) => Math.max(0, RARITIES.indexOf(r));
const randInt = (n) => (n <= 1 ? 0 : crypto.randomInt(n));
const randFloat = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

// ---------- Configuração (cache curto) ----------
let settingsCache = null;
let settingsAt = 0;
async function getSettings(force = false) {
  if (!force && settingsCache && Date.now() - settingsAt < 30_000) return settingsCache;
  const row = await prisma.cardGameSettings.findUnique({ where: { id: 'singleton' } }).catch(() => null);
  let saved = null;
  try { saved = row?.data ? JSON.parse(row.data) : null; } catch { saved = null; }
  settingsCache = mergeSettings(saved);
  settingsAt = Date.now();
  return settingsCache;
}
function invalidateSettings() { settingsCache = null; }

// ---------- Catálogo inicial ----------
let seeded = false;
let seedPromise = null;
// Uma vez só por processo, mesmo com várias requisições chegando juntas
// (antes duas requisições simultâneas tentavam inserir o catálogo e o banco
// acusava deadlock).
async function doSeed() {
  try {
    if ((await prisma.cardDef.count()) === 0) await prisma.cardDef.createMany({ data: SEED_CARDS, skipDuplicates: true });
  } catch (err) {
    if ((await prisma.cardDef.count().catch(() => 0)) === 0) throw err; // outro processo já inseriu = tudo certo
  }
  try {
    if ((await prisma.cardPack.count()) === 0) {
      for (const p of SEED_PACKS) await prisma.cardPack.create({ data: { ...p, weights: JSON.stringify(p.weights) } });
    }
  } catch (err) {
    if ((await prisma.cardPack.count().catch(() => 0)) === 0) throw err;
  }
  seeded = true;
}
function ensureSeed() {
  if (seeded) return Promise.resolve();
  if (!seedPromise) seedPromise = doSeed().finally(() => { seedPromise = null; });
  return seedPromise;
}

let catalogCache = null;
let catalogAt = 0;
async function getCatalog(force = false) {
  if (!force && catalogCache && Date.now() - catalogAt < 20_000) return catalogCache;
  await ensureSeed();
  const all = await prisma.cardDef.findMany({ orderBy: [{ cost: 'asc' }, { name: 'asc' }] });
  catalogCache = { all, byId: new Map(all.map((c) => [c.id, c])), enabled: all.filter((c) => c.enabled) };
  catalogAt = Date.now();
  return catalogCache;
}
function invalidateCatalog() { catalogCache = null; }

function shapeCard(c, owned) {
  return {
    id: c.id, slug: c.slug, name: c.name, description: c.description, flavor: c.flavor, imageUrl: c.imageUrl,
    rarity: c.rarity, element: c.element, collection: c.collection, cost: c.cost, attack: c.attack, health: c.health,
    ability: c.ability, abilityValue: c.abilityValue, enabled: c.enabled,
    power: cardPower(c, owned?.level || 1),
    ...(owned !== undefined ? { quantity: owned?.quantity || 0, level: owned?.level || 1 } : {}),
  };
}

async function getPlayer(userId) {
  return prisma.cardPlayer.upsert({ where: { userId }, update: {}, create: { userId } });
}

async function ownedMap(userId, tx = prisma) {
  const rows = await tx.userCard.findMany({ where: { userId } });
  return new Map(rows.map((r) => [r.cardId, r]));
}

// Dá cartas (soma na quantidade). Dentro de transação quando possível.
async function grantCards(tx, userId, cardIds) {
  const counts = new Map();
  for (const id of cardIds) counts.set(id, (counts.get(id) || 0) + 1);
  for (const [cardId, qty] of counts) {
    await tx.userCard.upsert({
      where: { userId_cardId: { userId, cardId } },
      update: { quantity: { increment: qty } },
      create: { userId, cardId, quantity: qty },
    });
  }
}

// ---------- Baralhos ----------
function copiesCap(card, rules) {
  return rankOf(card.rarity) >= rankOf('LENDARIA') ? rules.maxCopiesLegendary : rules.maxCopies;
}

function parseDeckCards(raw) {
  let arr = raw;
  if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { arr = []; } }
  if (!Array.isArray(arr)) return [];
  const merged = new Map();
  for (const it of arr.slice(0, 60)) {
    const id = typeof it?.cardId === 'string' ? it.cardId : null;
    const n = Math.max(0, Math.min(10, parseInt(it?.copies, 10) || 0));
    if (id && n) merged.set(id, (merged.get(id) || 0) + n);
  }
  return [...merged].map(([cardId, copies]) => ({ cardId, copies }));
}

// Valida baralho contra a coleção ATUAL do jogador (nunca confia no cliente).
function validateDeck(cards, owned, catalog, rules) {
  const errors = [];
  let total = 0;
  for (const { cardId, copies } of cards) {
    const card = catalog.byId.get(cardId);
    if (!card || !card.enabled) { errors.push('Há uma carta que não existe mais no baralho.'); continue; }
    const have = owned.get(cardId)?.quantity || 0;
    if (copies > have) errors.push(`Você só tem ${have}x ${card.name}.`);
    const cap = copiesCap(card, rules);
    if (copies > cap) errors.push(`Máximo de ${cap} cópia(s) de ${card.name}.`);
    total += copies;
  }
  if (total !== rules.deckSize) errors.push(`O baralho precisa ter exatamente ${rules.deckSize} cartas (tem ${total}).`);
  return { ok: errors.length === 0, errors, total };
}

// Monta o melhor baralho possível com a coleção (curva de custo equilibrada).
function autoDeck(owned, catalog, rules) {
  const pool = [];
  for (const [cardId, row] of owned) {
    const card = catalog.byId.get(cardId);
    if (!card || !card.enabled || row.quantity <= 0) continue;
    const n = Math.min(row.quantity, copiesCap(card, rules));
    for (let i = 0; i < n; i += 1) pool.push({ card, level: row.level, score: cardPower(card, row.level) / Math.max(1, card.cost) + cardPower(card, row.level) / 40 });
  }
  pool.sort((a, b) => b.score - a.score);
  const picked = [];
  const curve = { hi: 0, mid: 0 };
  for (const p of pool) {
    if (picked.length >= rules.deckSize) break;
    if (p.card.cost >= 7 && curve.hi >= 3) continue;
    if (p.card.cost >= 5 && curve.mid >= 7) continue;
    if (p.card.cost >= 7) curve.hi += 1;
    if (p.card.cost >= 5) curve.mid += 1;
    picked.push(p);
  }
  // Completa ignorando a curva se faltou.
  for (const p of pool) { if (picked.length >= rules.deckSize) break; if (!picked.includes(p)) picked.push(p); }
  const counts = new Map();
  for (const p of picked) counts.set(p.card.id, (counts.get(p.card.id) || 0) + 1);
  return [...counts].map(([cardId, copies]) => ({ cardId, copies }));
}

// Baralho de jogo pronto pro motor: [{ card, level }]
async function resolvePlayerDeck(userId, settings) {
  const catalog = await getCatalog();
  const owned = await ownedMap(userId);
  const deckRow = await prisma.cardDeck.findFirst({ where: { userId, active: true } });
  let cards = deckRow ? parseDeckCards(deckRow.cards) : null;
  if (!cards || !validateDeck(cards, owned, catalog, settings.rules).ok) cards = autoDeck(owned, catalog, settings.rules);
  const v = validateDeck(cards, owned, catalog, settings.rules);
  if (!v.ok) throw new CardError(`Você precisa de pelo menos ${settings.rules.deckSize} cartas jogáveis. Pegue o pacote inicial ou abra pacotes.`);
  const out = [];
  for (const { cardId, copies } of cards) {
    const card = catalog.byId.get(cardId);
    for (let i = 0; i < copies; i += 1) out.push({ card, level: owned.get(cardId)?.level || 1 });
  }
  return out;
}

async function botDeck(difficulty, settings) {
  const catalog = await getCatalog();
  const diff = DIFFICULTIES[difficulty] || DIFFICULTIES.MEDIO;
  const pool = catalog.enabled.filter((c) => rankOf(c.rarity) <= rankOf(diff.maxRarity));
  if (!pool.length) throw new CardError('Nenhuma carta disponível para o bot.');
  const counts = new Map();
  const out = [];
  let guard = 0;
  // Bots fortes preferem cartas melhores (amostragem ponderada por força).
  const weight = (c) => (difficulty === 'FACIL' ? 1 : cardPower(c, diff.level) ** (difficulty === 'LENDARIO' ? 1.6 : 1));
  const total = pool.reduce((s, c) => s + weight(c), 0);
  while (out.length < settings.rules.deckSize && guard < 2000) {
    guard += 1;
    let r = randFloat() * total;
    let pick = pool[pool.length - 1];
    for (const c of pool) { r -= weight(c); if (r <= 0) { pick = c; break; } }
    const n = counts.get(pick.id) || 0;
    if (n >= copiesCap(pick, settings.rules) && guard < 1500) continue;
    counts.set(pick.id, n + 1);
    out.push({ card: pick, level: diff.level });
  }
  return { deck: out, hp: diff.heroHp };
}

// ---------- Pacotes ----------
function packPool(pack, catalog) {
  if (pack.poolMode === 'COLLECTION' && pack.poolCollection) return catalog.enabled.filter((c) => c.collection === pack.poolCollection);
  if (pack.poolMode === 'LIST') {
    let ids = [];
    try { ids = JSON.parse(pack.poolCardIds || '[]'); } catch { ids = []; }
    const set = new Set(ids);
    return catalog.enabled.filter((c) => set.has(c.id));
  }
  return catalog.enabled;
}

function drawPack(pack, catalog) {
  const pool = packPool(pack, catalog);
  if (!pool.length) throw new CardError('Este pacote está sem cartas disponíveis.');
  let weights = {};
  try { weights = JSON.parse(pack.weights || '{}'); } catch { weights = {}; }
  const byRarity = new Map();
  for (const c of pool) { if (!byRarity.has(c.rarity)) byRarity.set(c.rarity, []); byRarity.get(c.rarity).push(c); }
  const avail = RARITIES.filter((r) => byRarity.has(r) && Number(weights[r]) > 0);
  const rollRarity = (minRank = 0) => {
    const opts = avail.filter((r) => rankOf(r) >= minRank);
    // Sem chance configurada acima do mínimo: usa qualquer raridade do pool
    // que atenda a garantia (a garantia vale mais que os pesos).
    const above = RARITIES.filter((r) => byRarity.has(r) && rankOf(r) >= minRank);
    const list = opts.length ? opts : (above.length ? above : [...byRarity.keys()]);
    const total = list.reduce((s, r) => s + (Number(weights[r]) > 0 ? Number(weights[r]) : 1), 0);
    let roll = randFloat() * total;
    for (const r of list) { roll -= Number(weights[r]) > 0 ? Number(weights[r]) : 1; if (roll <= 0) return r; }
    return list[list.length - 1];
  };
  const n = Math.max(1, Math.min(15, pack.cardsPerPack | 0));
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const isLast = i === n - 1;
    const guaranteeRank = isLast && pack.guaranteed ? rankOf(pack.guaranteed) : 0;
    const already = out.some((c) => rankOf(c.rarity) >= guaranteeRank);
    const r = rollRarity(guaranteeRank && !already ? guaranteeRank : 0);
    const list = byRarity.get(r);
    out.push(list[randInt(list.length)]);
  }
  return out.sort((a, b) => rankOf(a.rarity) - rankOf(b.rarity));
}

// ---------- Recompensas ----------
// Paga a recompensa de UMA partida, uma vez só (o update condicional em
// status=ACTIVE garante isso mesmo com requisições simultâneas).
async function finalizeMatch(match, state, settings) {
  const winnerSeat = state.winner;
  const seats = [match.p1Id, match.p2Id];
  const winnerId = winnerSeat === 0 || winnerSeat === 1 ? seats[winnerSeat] : null;
  const R = settings.rewards;
  const today = dayKey();
  const rewards = [0, 0];
  const turnsOk = state.turn >= R.minTurnsForReward;

  return prisma.$transaction(async (tx) => {
    const done = await tx.cardMatch.updateMany({
      where: { id: match.id, status: 'ACTIVE' },
      data: { status: 'FINISHED', winnerId: winnerId || (match.mode === 'PVE' && winnerSeat === 1 ? 'BOT' : null), endedAt: new Date(), endReason: state.endReason || null, state: JSON.stringify(state), turnDeadline: null },
    });
    if (done.count === 0) return null; // outro processo já finalizou

    for (let s = 0; s < 2; s += 1) {
      const uid = seats[s];
      if (!uid) continue; // bot
      const p = await tx.cardPlayer.upsert({ where: { userId: uid }, update: {}, create: { userId: uid } });
      const won = s === winnerSeat;
      const isNewDay = p.rewardDay !== today;
      const rewardsToday = isNewDay ? 0 : p.rewardsToday;
      let coins = 0;
      const surrenderedEarly = state.endReason === 'surrender' && !turnsOk;
      if (turnsOk && !surrenderedEarly && rewardsToday < R.dailyRewardedMatches && !p.banned) {
        if (match.mode === 'PVE') {
          coins = won ? (R[match.difficulty] || 0) : R.pveLoss;
        } else {
          // PvP: limite de vitórias pagas contra o MESMO oponente por dia (anti-farm combinado).
          const opp = seats[1 - s];
          const start = new Date(); start.setHours(start.getHours() - 24);
          const paidVsOpp = await tx.cardMatch.count({
            where: {
              mode: 'PVP', status: 'FINISHED', endedAt: { gte: start }, id: { not: match.id },
              OR: [{ p1Id: uid, p2Id: opp, reward1: { gt: 0 } }, { p2Id: uid, p1Id: opp, reward2: { gt: 0 } }],
            },
          });
          if (paidVsOpp < R.pvpRewardsPerOpponentPerDay) coins = won ? R.pvpWin : R.pvpLoss;
        }
        if (won && coins > 0 && p.streak > 0) coins += Math.min(R.streakBonusMax, p.streak * R.streakBonus);
      }
      coins = Math.max(0, Math.trunc(coins));
      rewards[s] = coins;
      const streak = won ? p.streak + 1 : 0;
      const data = {
        rewardDay: today,
        rewardsToday: rewardsToday + (coins > 0 ? 1 : 0),
        streak, bestStreak: Math.max(p.bestStreak, streak),
        coinsEarned: { increment: coins },
        ...(match.mode === 'PVP'
          ? (won ? { pvpWins: { increment: 1 } } : { pvpLosses: { increment: 1 } })
          : (won ? { wins: { increment: 1 } } : { losses: { increment: 1 } })),
      };
      await tx.cardPlayer.update({ where: { userId: uid }, data });
      if (coins > 0) await tx.user.update({ where: { id: uid }, data: { coins: { increment: coins } } });
    }
    // Rating Elo só no PvP.
    if (match.mode === 'PVP' && winnerId) {
      const [a, b] = await Promise.all(seats.map((id) => tx.cardPlayer.findUnique({ where: { userId: id } })));
      const ea = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
      const k = 32;
      const sa = winnerSeat === 0 ? 1 : 0;
      const da = Math.round(k * (sa - ea));
      await tx.cardPlayer.update({ where: { userId: seats[0] }, data: { rating: Math.max(100, a.rating + da) } });
      await tx.cardPlayer.update({ where: { userId: seats[1] }, data: { rating: Math.max(100, b.rating - da) } });
    }
    await tx.cardMatch.update({ where: { id: match.id }, data: { reward1: rewards[0], reward2: rewards[1] } });
    return { rewards, winnerId };
  }).then((r) => {
    if (r) {
      const ledger = require('../services/economyLedger');
      for (let s = 0; s < 2; s += 1) {
        if (r.rewards[s] > 0) ledger.recordTransaction(seats[s], { kind: 'CARDS', label: match.mode === 'PVP' ? 'Jogo de Cartas: partida PvP' : `Jogo de Cartas: partida contra bot (${DIFFICULTIES[match.difficulty]?.label || ''})`, coins: r.rewards[s] });
      }
    }
    return r;
  });
}

module.exports = {
  CardError, dayKey, rankOf, randInt, getSettings, invalidateSettings, ensureSeed, getCatalog, invalidateCatalog,
  shapeCard, getPlayer, ownedMap, grantCards, parseDeckCards, validateDeck, autoDeck, resolvePlayerDeck, botDeck,
  drawPack, packPool, finalizeMatch, copiesCap,
};
