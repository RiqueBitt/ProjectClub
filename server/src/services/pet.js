// Mascote pinguim do perfil (Fase 8).
//
// Cada pessoa tem um pinguim (model PetPenguin) que evolui de estágio
// conforme participa da plataforma:
//   pontuação = XP do pinguim (cuidados diários) + nível da conta × 20
//   filhote (0) → jovem (150) → adulto (500) → lendário (1200)
// O estágio guardado é o MAIOR já alcançado: o pinguim nunca "desevolui".
//
// "Cuidar do pinguim" vale uma vez por dia (dia de Brasília): dá um pouco de
// XP pro pinguim (mais com sequência de dias seguidos) e um pouquinho de XP
// de conta. Acessórios são cosméticos comprados com moedas (catálogo aqui
// no código), um por espaço (cabeça, rosto, pescoço, mão).
//
// Tudo que mexe no banco recebe `db` injetável (testes) e só carrega o
// Prisma de verdade quando precisa.
const getPrisma = () => require('../config/prisma');

const TIME_ZONE = 'America/Sao_Paulo';

const STAGES = [
  { index: 0, key: 'filhote', label: 'Filhote', minScore: 0 },
  { index: 1, key: 'jovem', label: 'Jovem', minScore: 150 },
  { index: 2, key: 'adulto', label: 'Adulto', minScore: 500 },
  { index: 3, key: 'lendario', label: 'Lendário', minScore: 1200 },
];
const LEVEL_WEIGHT = 20;

// Cuidado diário.
const CARE_PET_XP = 15;
const CARE_STREAK_BONUS = 3; // por dia de sequência, até o teto abaixo
const CARE_STREAK_CAP = 7;
const CARE_ACCOUNT_XP = 10;

const COLORS = ['blue', 'red', 'green', 'yellow', 'pink', 'purple', 'orange', 'black'];
const SLOTS = ['cabeca', 'rosto', 'pescoco', 'mao'];

// Catálogo de acessórios (cosméticos). minStage = estágio mínimo pra usar.
const ACCESSORIES = [
  { id: 'gorro', name: 'Gorro de lã', slot: 'cabeca', price: 60, minStage: 0 },
  { id: 'laco', name: 'Laço', slot: 'cabeca', price: 50, minStage: 0 },
  { id: 'fone', name: 'Fone de ouvido', slot: 'cabeca', price: 140, minStage: 1 },
  { id: 'cartola', name: 'Cartola', slot: 'cabeca', price: 220, minStage: 2 },
  { id: 'coroa', name: 'Coroa', slot: 'cabeca', price: 600, minStage: 3 },
  { id: 'oculos', name: 'Óculos redondos', slot: 'rosto', price: 80, minStage: 0 },
  { id: 'oculos-sol', name: 'Óculos escuros', slot: 'rosto', price: 120, minStage: 1 },
  { id: 'cachecol', name: 'Cachecol', slot: 'pescoco', price: 70, minStage: 0 },
  { id: 'gravata', name: 'Gravata-borboleta', slot: 'pescoco', price: 90, minStage: 1 },
  { id: 'peixe', name: 'Peixinho', slot: 'mao', price: 40, minStage: 0 },
  { id: 'balao', name: 'Balão', slot: 'mao', price: 100, minStage: 1 },
];
const ACCESSORY_BY_ID = new Map(ACCESSORIES.map((a) => [a.id, a]));

const dayKey = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const previousDayKey = (now = new Date()) => dayKey(new Date(now.getTime() - 86_400_000));

function petScore(petXp, accountLevel) {
  return Math.max(0, Math.trunc(petXp) || 0) + Math.max(0, Math.trunc(accountLevel) || 0) * LEVEL_WEIGHT;
}

function stageForScore(score) {
  let st = STAGES[0];
  for (const s of STAGES) if (score >= s.minScore) st = s;
  return st;
}

// Estágio efetivo: o maior entre o guardado e o calculado agora.
function resolveStage(storedStage, score) {
  const calc = stageForScore(score).index;
  return Math.max(Math.min(STAGES.length - 1, Math.max(0, Math.trunc(storedStage) || 0)), calc);
}

function nextStageInfo(stageIndex, score) {
  const next = STAGES[stageIndex + 1];
  if (!next) return null;
  const cur = STAGES[stageIndex];
  const span = Math.max(1, next.minScore - cur.minScore);
  return { key: next.key, label: next.label, minScore: next.minScore, missing: Math.max(0, next.minScore - score), progress: Math.max(0, Math.min(100, Math.round(((score - cur.minScore) / span) * 100))) };
}

// Humor depende de há quanto tempo ninguém cuida do pinguim.
function moodFor(lastCaredAt, now = new Date()) {
  if (!lastCaredAt) return 'carente';
  const hours = (now.getTime() - new Date(lastCaredAt).getTime()) / 3_600_000;
  if (hours < 24) return 'feliz';
  if (hours < 72) return 'tranquilo';
  return 'carente';
}

// Regra do cuidado diário (pura): devolve o que muda ou { already: true }.
function computeCare(pet, now = new Date()) {
  const today = dayKey(now);
  if (pet.lastCareDay === today) return { already: true, today };
  const streak = pet.lastCareDay === previousDayKey(now) ? (pet.streak || 0) + 1 : 1;
  const petXp = CARE_PET_XP + Math.min(CARE_STREAK_CAP, streak - 1) * CARE_STREAK_BONUS;
  return {
    already: false, today, streak, petXp,
    bestStreak: Math.max(pet.bestStreak || 0, streak),
    accountXp: CARE_ACCOUNT_XP,
  };
}

function parseEquipped(raw) {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    const out = {};
    for (const slot of SLOTS) if (typeof obj?.[slot] === 'string' && ACCESSORY_BY_ID.get(obj[slot])?.slot === slot) out[slot] = obj[slot];
    return out;
  } catch { return {}; }
}

// Nome do pinguim: letras, números, espaço, _ e -; 2 a 20 caracteres.
function sanitizePetName(raw) {
  const name = String(raw || '').replace(/[^\p{L}\p{N} _-]+/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20).trim();
  return name.length >= 2 ? name : null;
}

class PetError extends Error {
  constructor(message, status = 400, code = 'PET_ERROR') { super(message); this.status = status; this.code = code; }
}

// Valida se pode equipar (puro).
function checkEquip({ accessoryId, ownedIds, stage }) {
  const acc = ACCESSORY_BY_ID.get(accessoryId);
  if (!acc) throw new PetError('Acessório não encontrado.', 404, 'NOT_FOUND');
  if (!ownedIds.includes(accessoryId)) throw new PetError('Você ainda não tem esse acessório.', 403, 'NOT_OWNED');
  if (stage < acc.minStage) throw new PetError(`Seu pinguim precisa ser ${STAGES[acc.minStage].label.toLowerCase()} pra usar isso.`, 403, 'STAGE');
  return acc;
}

function shapePet(row, { accountLevel = 1, ownedIds = [], now = new Date() } = {}) {
  const score = petScore(row.xp, accountLevel);
  const stage = resolveStage(row.stage, score);
  const today = dayKey(now);
  return {
    userId: row.userId,
    name: row.name,
    color: COLORS.includes(row.color) ? row.color : 'blue',
    stage, stageKey: STAGES[stage].key, stageLabel: STAGES[stage].label,
    xp: row.xp, score, next: nextStageInfo(stage, score),
    streak: row.lastCareDay === today || row.lastCareDay === previousDayKey(now) ? row.streak : 0,
    bestStreak: row.bestStreak, careCount: row.careCount || 0,
    caredToday: row.lastCareDay === today,
    mood: moodFor(row.lastCaredAt, now),
    equipped: parseEquipped(row.equipped),
    owned: ownedIds,
  };
}

async function loadContext(db, userId) {
  const [user, owned] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { accountLevel: true, coins: true } }),
    db.petAccessoryOwned.findMany({ where: { userId }, select: { accessoryId: true } }),
  ]);
  return { accountLevel: user?.accountLevel || 1, coins: user?.coins ?? 0, ownedIds: owned.map((o) => o.accessoryId) };
}

// Garante que o pinguim existe (cria com padrão na primeira vez) e acerta o
// estágio guardado se a pessoa já subiu (nível de conta também conta).
async function getOrCreatePet(userId, { db = getPrisma(), now = new Date() } = {}) {
  let row = await db.petPenguin.findUnique({ where: { userId } });
  if (!row) {
    row = await db.petPenguin.upsert({ where: { userId }, create: { userId }, update: {} });
  }
  const ctx = await loadContext(db, userId);
  const shaped = shapePet(row, { ...ctx, now });
  if (shaped.stage > row.stage) {
    await db.petPenguin.update({ where: { userId }, data: { stage: shaped.stage } }).catch(() => null);
  }
  return { pet: shaped, coins: ctx.coins };
}

// Pinguim de outra pessoa (só leitura; null se ela nunca abriu o dela).
async function getPublicPet(userId, { db = getPrisma(), now = new Date() } = {}) {
  const row = await db.petPenguin.findUnique({ where: { userId } });
  if (!row) return null;
  const user = await db.user.findUnique({ where: { id: userId }, select: { accountLevel: true } });
  const { owned, ...rest } = shapePet(row, { accountLevel: user?.accountLevel || 1, now }); // eslint-disable-line no-unused-vars
  return rest;
}

async function careForPet(userId, { db = getPrisma(), now = new Date(), awardXp = (...a) => require('./xp').awardXp(...a) } = {}) {
  const { pet } = await getOrCreatePet(userId, { db, now });
  const row = await db.petPenguin.findUnique({ where: { userId } });
  const care = computeCare(row, now);
  if (care.already) throw new PetError('Você já cuidou do seu pinguim hoje. Volte amanhã!', 409, 'ALREADY_CARED');
  // Condicional no dia: dois cliques ao mesmo tempo não contam duas vezes.
  const upd = await db.petPenguin.updateMany({
    where: { userId, OR: [{ lastCareDay: null }, { lastCareDay: { not: care.today } }] },
    data: { lastCareDay: care.today, lastCaredAt: now, streak: care.streak, bestStreak: care.bestStreak, xp: { increment: care.petXp }, careCount: { increment: 1 } },
  });
  if (!upd.count) throw new PetError('Você já cuidou do seu pinguim hoje. Volte amanhã!', 409, 'ALREADY_CARED');
  let levelUp = null;
  try { levelUp = await awardXp(userId, care.accountXp, { kind: 'PET_CARE', label: `Cuidou do pinguim ${pet.name}` }); } catch { /* XP é bônus */ }
  const after = await getOrCreatePet(userId, { db, now });
  return { ...after, gained: { petXp: care.petXp, accountXp: care.accountXp, streak: care.streak }, evolved: after.pet.stage > pet.stage, levelUp };
}

async function updatePet(userId, { name, color } = {}, { db = getPrisma() } = {}) {
  await getOrCreatePet(userId, { db });
  const data = {};
  if (name !== undefined) {
    const clean = sanitizePetName(name);
    if (!clean) throw new PetError('O nome precisa ter de 2 a 20 letras ou números.');
    data.name = clean;
  }
  if (color !== undefined) {
    if (!COLORS.includes(color)) throw new PetError('Cor inválida.');
    data.color = color;
  }
  if (Object.keys(data).length) await db.petPenguin.update({ where: { userId }, data });
  return getOrCreatePet(userId, { db });
}

// Compra atômica: desconta as moedas só se o saldo ainda cobre o preço e a
// chave composta de PetAccessoryOwned impede comprar duas vezes.
async function buyAccessory(userId, accessoryId, { db = getPrisma(), ledger = () => require('./economyLedger') } = {}) {
  const acc = ACCESSORY_BY_ID.get(accessoryId);
  if (!acc) throw new PetError('Acessório não encontrado.', 404, 'NOT_FOUND');
  await getOrCreatePet(userId, { db });
  await db.$transaction(async (tx) => {
    const has = await tx.petAccessoryOwned.findUnique({ where: { userId_accessoryId: { userId, accessoryId } } });
    if (has) throw new PetError('Você já tem esse acessório.', 409, 'ALREADY_OWNED');
    const paid = await tx.user.updateMany({ where: { id: userId, coins: { gte: acc.price } }, data: { coins: { decrement: acc.price } } });
    if (!paid.count) throw new PetError('Moedas insuficientes.', 402, 'NO_COINS');
    await tx.petAccessoryOwned.create({ data: { userId, accessoryId, pricePaid: acc.price } });
  });
  ledger().recordTransaction(userId, { kind: 'PET_SHOP', label: `Acessório do pinguim: ${acc.name}`, coins: -acc.price });
  return getOrCreatePet(userId, { db });
}

async function equipAccessory(userId, { slot, accessoryId }, { db = getPrisma() } = {}) {
  if (!SLOTS.includes(slot)) throw new PetError('Espaço inválido.');
  const { pet } = await getOrCreatePet(userId, { db });
  const equipped = { ...pet.equipped };
  if (!accessoryId) delete equipped[slot];
  else {
    const acc = checkEquip({ accessoryId, ownedIds: pet.owned, stage: pet.stage });
    if (acc.slot !== slot) throw new PetError('Esse acessório não vai nesse espaço.');
    equipped[slot] = accessoryId;
  }
  await db.petPenguin.update({ where: { userId }, data: { equipped: JSON.stringify(equipped) } });
  return getOrCreatePet(userId, { db });
}

module.exports = {
  STAGES, ACCESSORIES, COLORS, SLOTS, LEVEL_WEIGHT,
  CARE_PET_XP, CARE_STREAK_BONUS, CARE_STREAK_CAP, CARE_ACCOUNT_XP,
  PetError, dayKey, previousDayKey, petScore, stageForScore, resolveStage, nextStageInfo, moodFor,
  computeCare, parseEquipped, sanitizePetName, checkEquip, shapePet,
  getOrCreatePet, getPublicPet, careForPet, updatePet, buyAccessory, equipAccessory,
};
