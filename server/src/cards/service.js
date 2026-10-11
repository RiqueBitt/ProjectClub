// Jogo de Cartas — regras de negócio no servidor (configuração, catálogo,
// baralhos, pacotes, recompensas). O motor da batalha fica em engine.js.
const crypto = require('crypto');
const prisma = require('../config/prisma');
const {
  RARITIES, DIFFICULTIES, mergeSettings, cardPower, divisionOf,
} = require('./config');
const { SEED_CARDS, SEED_CARDS_V2, SEED_PACKS, SEED_CAMPAIGN } = require('./seed');

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

// Grava campos no JSON salvo (sem perder o que a staff já configurou).
async function patchSavedSettings(patch) {
  const row = await prisma.cardGameSettings.findUnique({ where: { id: 'singleton' } }).catch(() => null);
  let saved = {};
  try { saved = row?.data ? JSON.parse(row.data) : {}; } catch { saved = {}; }
  const data = JSON.stringify({ ...saved, ...patch });
  await prisma.cardGameSettings.upsert({ where: { id: 'singleton' }, update: { data }, create: { id: 'singleton', data } });
  invalidateSettings();
}

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
  // Conteúdo novo (v2: feitiços/novas habilidades) entra uma vez só — se a
  // staff excluir alguma carta depois, ela não volta sozinha.
  try {
    const st = await getSettings(true);
    if ((st.seedVersion || 1) < 2) {
      await prisma.cardDef.createMany({ data: SEED_CARDS_V2, skipDuplicates: true });
      await patchSavedSettings({ seedVersion: 2 });
      invalidateCatalog();
    }
    if ((await prisma.cardCampaignStage.count()) === 0) await prisma.cardCampaignStage.createMany({ data: SEED_CAMPAIGN });
  } catch (err) { console.error('[cards] seed v2 falhou:', err?.message || err); }
  // v3: mesas de batalha editáveis (as 5 cenas ilustradas viram registros).
  try {
    const st = await getSettings(true);
    if ((st.seedVersion || 1) < 3) {
      if ((await prisma.cardBoard.count()) === 0) await prisma.cardBoard.createMany({ data: SEED_BOARDS });
      await patchSavedSettings({ seedVersion: 3 });
    }
  } catch (err) { console.error('[cards] seed v3 falhou:', err?.message || err); }
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

// Baralho aleatório com TODAS as cartas (partidas personalizadas).
function randomDeck(catalog, settings, level = 1) {
  const pool = catalog.enabled;
  const deck = [];
  const count = new Map();
  let guard = 0;
  while (deck.length < settings.rules.deckSize && guard < 5000 && pool.length) {
    guard += 1;
    const c = pool[randInt(pool.length)];
    const cap = rankOf(c.rarity) >= rankOf('LENDARIA') ? settings.rules.maxCopiesLegendary : settings.rules.maxCopies;
    if ((count.get(c.id) || 0) >= cap && guard < 4000) continue;
    count.set(c.id, (count.get(c.id) || 0) + 1);
    deck.push({ card: c, level: Math.max(1, Math.min(settings.rules.levelCap || 5, level | 0)) });
  }
  return deck;
}

// ---------- Mesas (fundos de batalha) ----------
const BOARD_THEMES = ['floresta', 'vulcao', 'templo', 'abismo', 'oceano', 'gelo', 'noite'];
const SEED_BOARDS = [
  { name: 'Floresta Antiga', theme: 'floresta', accent: '#62c24a', sort: 0 },
  { name: 'Forja do Vulcão', theme: 'vulcao', accent: '#ff7a3c', sort: 1 },
  { name: 'Templo Dourado', theme: 'templo', accent: '#ffd34d', sort: 2 },
  { name: 'Abismo Eterno', theme: 'abismo', accent: '#a46bff', sort: 3 },
  { name: 'Recife Profundo', theme: 'oceano', accent: '#3aa0ff', sort: 4 },
];
let boardsCache = null;
let boardsAt = 0;
async function getBoards(force = false) {
  if (!force && boardsCache && Date.now() - boardsAt < 30_000) return boardsCache;
  await ensureSeed();
  boardsCache = await prisma.cardBoard.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
  boardsAt = Date.now();
  return boardsCache;
}
function invalidateBoards() { boardsCache = null; }
const shapeBoard = (b) => ({ id: b.id, name: b.name, theme: b.theme, imageUrl: b.imageUrl || null, dim: b.dim, accent: b.accent });
// Sorteia uma mesa ativa (respeita o peso definido pela staff).
async function pickBoardId(preferred = null) {
  const boards = (await getBoards().catch(() => [])).filter((b) => b.active);
  if (preferred && boards.some((b) => b.id === preferred)) return preferred;
  const total = boards.reduce((n, b) => n + Math.max(0, b.weight | 0), 0);
  if (!total) return boards[0]?.id || null;
  let r = randInt(total);
  for (const b of boards) { r -= Math.max(0, b.weight | 0); if (r < 0) return b.id; }
  return boards[0]?.id || null;
}

function shapeCard(c, owned) {
  return {
    id: c.id, slug: c.slug, name: c.name, description: c.description, flavor: c.flavor, imageUrl: c.imageUrl,
    rarity: c.rarity, element: c.element, collection: c.collection, cost: c.cost, attack: c.attack, health: c.health,
    ability: c.ability, abilityValue: c.abilityValue, enabled: c.enabled, kind: c.kind || 'UNIT',
    power: cardPower(c, owned?.level || 1),
    ...(owned !== undefined ? { quantity: owned?.quantity || 0, level: owned?.level || 1, foil: Math.min(owned?.foil || 0, owned?.quantity || 0) } : {}),
  };
}

// Temporada = mês (America/Sao_Paulo). Na primeira atividade de um mês novo,
// paga a recompensa da divisão alcançada no mês anterior e faz o reset suave.
const seasonKeyOf = (d = new Date()) => dayKey(d).slice(0, 7);
async function ensureSeason(p) {
  const cur = seasonKeyOf();
  if (p.seasonKey === cur) return p;
  const settings = await getSettings();
  let reward = null;
  if (p.seasonKey && p.seasonWins + p.seasonLosses >= settings.season.minGames) {
    const div = divisionOf(p.seasonRating);
    reward = { season: p.seasonKey, division: div.key, label: div.label, coins: settings.season.rewards[div.key] || 0, gems: settings.season.gems[div.key] || 0 };
  }
  const r = await prisma.cardPlayer.updateMany({
    where: { userId: p.userId, seasonKey: p.seasonKey },
    data: {
      seasonKey: cur, seasonWins: 0, seasonLosses: 0,
      seasonRating: p.seasonKey ? 1000 + Math.round((p.seasonRating - 1000) / 2) : 1000,
      lastSeasonReward: reward ? JSON.stringify(reward) : null,
    },
  });
  if (r.count && reward && (reward.coins || reward.gems)) {
    await prisma.user.update({ where: { id: p.userId }, data: { coins: { increment: reward.coins }, gems: { increment: reward.gems } } });
    require('../services/economyLedger').recordTransaction(p.userId, { kind: 'CARDS', label: `Arena de Cartas: temporada ${reward.season} (${reward.label})`, coins: reward.coins, gems: reward.gems });
  }
  return prisma.cardPlayer.findUnique({ where: { userId: p.userId } });
}

async function getPlayer(userId) {
  const p = await prisma.cardPlayer.upsert({ where: { userId }, update: {}, create: { userId } });
  return ensureSeason(p);
}

async function ownedMap(userId, tx = prisma) {
  const rows = await tx.userCard.findMany({ where: { userId } });
  return new Map(rows.map((r) => [r.cardId, r]));
}

// Dá cartas (soma na quantidade). Dentro de transação quando possível.
async function grantCards(tx, userId, cardIds, foilIds = []) {
  const counts = new Map();
  const foils = new Map();
  for (const id of cardIds) counts.set(id, (counts.get(id) || 0) + 1);
  for (const id of foilIds) foils.set(id, (foils.get(id) || 0) + 1);
  for (const [cardId, qty] of counts) {
    const f = foils.get(cardId) || 0;
    await tx.userCard.upsert({
      where: { userId_cardId: { userId, cardId } },
      update: { quantity: { increment: qty }, ...(f ? { foil: { increment: f } } : {}) },
      create: { userId, cardId, quantity: qty, foil: f },
    });
  }
}

// Depois de tirar cópias comuns, as brilhantes nunca passam do total.
async function clampFoil(tx, userId, cardId) {
  const r = await tx.userCard.findUnique({ where: { userId_cardId: { userId, cardId } } });
  if (r && r.foil > r.quantity) await tx.userCard.update({ where: { id: r.id }, data: { foil: Math.max(0, r.quantity) } });
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
    const row = owned.get(cardId);
    for (let i = 0; i < copies; i += 1) out.push({ card: i < (row?.foil || 0) ? { ...card, foil: true } : card, level: row?.level || 1 });
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
// Partida personalizada: só encerra (ninguém ganha moedas, rating, missões).
async function finalizeCustom(match, state) {
  const winnerSeat = state.winner;
  const winnerId = winnerSeat === 0 ? match.p1Id : winnerSeat === 1 ? (match.p2Id || 'BOT') : null;
  const done = await prisma.cardMatch.updateMany({
    where: { id: match.id, status: 'ACTIVE' },
    data: { status: 'FINISHED', winnerId, endedAt: new Date(), endReason: state.endReason || null, state: JSON.stringify(state), turnDeadline: null },
  });
  if (!done.count) return null;
  for (const uid of [match.p1Id, match.p2Id, match.p3Id, match.p4Id].filter(Boolean)) {
    await prisma.cardPlayer.upsert({ where: { userId: uid }, update: { customPlayed: { increment: 1 } }, create: { userId: uid, customPlayed: 1 } }).catch(() => {});
  }
  return { rewards: [0, 0, 0, 0], winnerId, custom: true };
}

// 2v2: os dois do time vencedor ganham como no PvP (com os mesmos limites
// diários). Sem rating. Com bot em algum lugar = sem recompensa.
async function finalizeDuo(match, state, settings, io = null) {
  const winnerSeat = state.winner;
  const ids = [match.p1Id, match.p2Id, match.p3Id, match.p4Id];
  const teamOf = (i) => i % 2; // p1,p3 = time 0; p2,p4 = time 1
  const winnerId = winnerSeat === 0 ? match.p1Id : winnerSeat === 1 ? match.p2Id : null;
  const R = settings.rewards;
  const today = dayKey();
  const turnsOk = state.turn >= R.minTurnsForReward;
  const hasBot = state.players.some((p) => p.isBot || p.bench?.some((b) => b.isBot));
  const rewards = [0, 0, 0, 0];
  const r = await prisma.$transaction(async (tx) => {
    const done = await tx.cardMatch.updateMany({
      where: { id: match.id, status: 'ACTIVE' },
      data: { status: 'FINISHED', winnerId, endedAt: new Date(), endReason: state.endReason || null, state: JSON.stringify(state), turnDeadline: null },
    });
    if (!done.count) return null;
    for (let i = 0; i < 4; i += 1) {
      const uid = ids[i];
      if (!uid) continue;
      const won = teamOf(i) === winnerSeat;
      const p = await tx.cardPlayer.upsert({ where: { userId: uid }, update: {}, create: { userId: uid } });
      const rewardsToday = p.rewardDay !== today ? 0 : p.rewardsToday;
      let coins = 0;
      if (!hasBot && turnsOk && !(state.endReason === 'surrender' && !turnsOk) && rewardsToday < R.dailyRewardedMatches && !p.banned) coins = won ? R.pvpWin : R.pvpLoss;
      coins = Math.max(0, Math.trunc(coins));
      rewards[i] = coins;
      await tx.cardPlayer.update({ where: { userId: uid }, data: { rewardDay: today, rewardsToday: rewardsToday + (coins > 0 ? 1 : 0), coinsEarned: { increment: coins }, ...(won ? { duoWins: { increment: 1 } } : { duoLosses: { increment: 1 } }) } });
      if (coins > 0) await tx.user.update({ where: { id: uid }, data: { coins: { increment: coins } } });
    }
    await tx.cardMatch.update({ where: { id: match.id }, data: { reward1: rewards[0], reward2: rewards[1], reward3: rewards[2], reward4: rewards[3] } });
    return { rewards, winnerId };
  });
  if (r) {
    const ledger = require('../services/economyLedger');
    for (let i = 0; i < 4; i += 1) {
      if (!ids[i]) continue;
      if (rewards[i] > 0) ledger.recordTransaction(ids[i], { kind: 'CARDS', label: 'Jogo de Cartas: partida 2 vs 2', coins: rewards[i] });
      afterActivity(ids[i], [['CARDS_PLAY', 1], ...(teamOf(i) === winnerSeat ? [['CARDS_WIN', 1]] : [])], io);
    }
  }
  return r;
}

async function finalizeMatch(match, state, settings, io = null) {
  if (match.custom) return finalizeCustom(match, state);
  if (match.format === '2V2') return finalizeDuo(match, state, settings, io);
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
    // Rating Elo só no PvP (geral e da temporada).
    if (match.mode === 'PVP' && winnerId) {
      const [a, b] = await Promise.all(seats.map((id) => tx.cardPlayer.findUnique({ where: { userId: id } })));
      const k = 32;
      const sa = winnerSeat === 0 ? 1 : 0;
      const elo = (ra, rb) => Math.round(k * (sa - 1 / (1 + 10 ** ((rb - ra) / 400))));
      const da = elo(a.rating, b.rating);
      const ds = elo(a.seasonRating, b.seasonRating);
      await tx.cardPlayer.update({ where: { userId: seats[0] }, data: { rating: Math.max(100, a.rating + da), seasonRating: Math.max(100, a.seasonRating + ds), ...(sa ? { seasonWins: { increment: 1 } } : { seasonLosses: { increment: 1 } }) } });
      await tx.cardPlayer.update({ where: { userId: seats[1] }, data: { rating: Math.max(100, b.rating - da), seasonRating: Math.max(100, b.seasonRating - ds), ...(sa ? { seasonLosses: { increment: 1 } } : { seasonWins: { increment: 1 } }) } });
    }
    // Campanha: primeira vitória numa fase libera a próxima e dá o prêmio.
    let campaign = null;
    if (match.campaignStageId && winnerSeat === 0 && seats[0]) {
      const stage = await tx.cardCampaignStage.findUnique({ where: { id: match.campaignStageId } });
      const ordered = await tx.cardCampaignStage.findMany({ where: { enabled: true }, orderBy: { position: 'asc' }, select: { id: true } });
      const idx = ordered.findIndex((x) => x.id === match.campaignStageId);
      if (stage && idx >= 0) {
        const adv = await tx.cardPlayer.updateMany({ where: { userId: seats[0], campaignStage: idx }, data: { campaignStage: idx + 1 } });
        if (adv.count) {
          campaign = { stage: stage.name, coins: stage.rewardCoins || 0, cardId: stage.rewardCardId || null, next: idx + 1 };
          if (campaign.coins) { await tx.user.update({ where: { id: seats[0] }, data: { coins: { increment: campaign.coins } } }); rewards[0] += campaign.coins; }
          if (campaign.cardId && (await tx.cardDef.findUnique({ where: { id: campaign.cardId } }))) await grantCards(tx, seats[0], [campaign.cardId]);
        }
      }
    }
    // Estatísticas por carta (para o equilíbrio do jogo).
    for (let s = 0; s < 2; s += 1) {
      if (!seats[s]) continue;
      const used = [...new Set((state.played?.[s] || []).filter(Boolean))].slice(0, 40);
      for (const cardId of used) {
        await tx.cardStat.upsert({ where: { cardId }, update: { played: { increment: 1 }, ...(s === winnerSeat ? { wins: { increment: 1 } } : {}) }, create: { cardId, played: 1, wins: s === winnerSeat ? 1 : 0 } });
      }
    }
    await tx.cardMatch.update({ where: { id: match.id }, data: { reward1: rewards[0], reward2: rewards[1] } });
    return { rewards, winnerId, campaign };
  }).then((r) => {
    if (r) {
      const ledger = require('../services/economyLedger');
      for (let s = 0; s < 2; s += 1) {
        if (r.rewards[s] > 0) ledger.recordTransaction(seats[s], { kind: 'CARDS', label: match.mode === 'PVP' ? 'Jogo de Cartas: partida PvP' : `Jogo de Cartas: partida contra bot (${DIFFICULTIES[match.difficulty]?.label || ''})`, coins: r.rewards[s] });
      }
      // Missões e conquistas (não bloqueiam a resposta).
      for (let s = 0; s < 2; s += 1) {
        const uid = seats[s];
        if (!uid) continue;
        afterActivity(uid, [['CARDS_PLAY', 1], ...(s === winnerSeat ? [['CARDS_WIN', 1]] : []), ...(s === winnerSeat && match.mode === 'PVP' ? [['CARDS_PVP_WIN', 1]] : [])], io);
      }
      if (match.tournamentId) {
        try { require('./tournaments').onMatchFinished(match, r.winnerId, io).catch((e) => console.error('[cards] torneio:', e?.message)); } catch { /* ignora */ }
      }
    }
    return r;
  });
}

// Missões (tipos CARDS_*) e conquistas da Arena — sempre em segundo plano.
function afterActivity(userId, events, io = null) {
  setImmediate(async () => {
    try {
      const missions = require('../services/missions');
      for (const [type, n] of events) await missions.track(userId, type, n, io).catch(() => {});
      await require('../services/achievements').checkAndUnlock(userId, io).catch(() => {});
    } catch { /* ignora */ }
  });
}

module.exports = {
  afterActivity, patchSavedSettings, seasonKeyOf, ensureSeason, clampFoil,
  CardError, dayKey, rankOf, randInt, getSettings, invalidateSettings, ensureSeed, getCatalog, invalidateCatalog,
  shapeCard, getPlayer, ownedMap, grantCards, parseDeckCards, validateDeck, autoDeck, resolvePlayerDeck, botDeck,
  drawPack, packPool, finalizeMatch, copiesCap,
  getBoards, invalidateBoards, shapeBoard, pickBoardId, BOARD_THEMES, randomDeck,
};
