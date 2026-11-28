// "Primeiros passos": checklist de boas-vindas com recompensa em moedas.
//
// Regras (o cliente nunca é a fonte da verdade):
//  - Cada passo tem um VERIFICADOR no servidor. Passos de "estado" (foto de
//    perfil, primeira mensagem, reação, tema do perfil, notificações) são
//    conferidos direto no banco na hora do resgate. O passo de voz não
//    deixa rastro no banco, então é marcado pelo PRÓPRIO servidor quando a
//    entrada na sala acontece de verdade (sockets/index.js → markEvent).
//  - A recompensa sai uma vez só por passo: o resgate faz updateMany com
//    claimedAt: null dentro de uma transação junto com o incremento das
//    moedas — dois cliques, duas abas ou duas instâncias resgatando ao mesmo
//    tempo pagam no máximo uma vez.
//  - Anti-abuso: só contas novas (ONBOARDING_MAX_ACCOUNT_AGE_DAYS, padrão
//    30) podem resgatar; reação conta só em mensagem de OUTRA pessoa;
//    mensagem tem que ter texto de verdade (≥ 2 caracteres); resgates por
//    pessoa têm limite de ritmo; contas banidas/suspensas nem chegam aqui
//    (requireAuth).
const { recordTransaction } = require('./economyLedger');

const STEPS = [
  {
    key: 'PROFILE', coins: 50, title: 'Coloque uma foto de perfil',
    description: 'Escolha uma foto para todo mundo te reconhecer.', action: 'profile',
  },
  {
    key: 'FIRST_MESSAGE', coins: 30, title: 'Mande sua primeira mensagem',
    description: 'Diga um oi em qualquer canal ou conversa.', action: 'chat',
  },
  {
    key: 'JOIN_VOICE', coins: 40, title: 'Entre em um canal de voz',
    description: 'Clique em um canal de voz para entrar na call.', action: 'voice',
  },
  {
    key: 'REACT', coins: 20, title: 'Reaja a uma mensagem',
    description: 'Passe o mouse numa mensagem de alguém e escolha um emoji.', action: 'chat',
  },
  {
    key: 'PROFILE_THEME', coins: 30, title: 'Personalize seu perfil',
    description: 'Troque a cor do perfil, o estilo do nome ou coloque um banner.', action: 'profileTheme',
  },
  {
    key: 'NOTIFICATIONS', coins: 30, title: 'Ative as notificações',
    description: 'Receba aviso de menções e mensagens mesmo com o app fechado.', action: 'notifications',
  },
];
const STEP_KEYS = new Set(STEPS.map((s) => s.key));
// Passos sem recompensa, só estado da interface.
const META_STEPS = new Set(['TOUR', 'DISMISS']);
// Passos que só o servidor marca (por evento), nunca a partir do banco.
const EVENT_STEPS = new Set(['JOIN_VOICE']);

const DEFAULT_PROFILE = {
  profileColor: '#1877F2', profileNameFont: 'NORMAL', profileNameEffect: 'SOLID', profileNameColor: '#1877F2',
};

const DAY_MS = 24 * 60 * 60 * 1000;
function maxAccountAgeDays(env = process.env) {
  const n = Number(env.ONBOARDING_MAX_ACCOUNT_AGE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 30;
}
function isEligible(user, now = Date.now(), env = process.env) {
  if (!user?.createdAt) return false;
  return now - new Date(user.createdAt).getTime() <= maxAccountAgeDays(env) * DAY_MS;
}

function httpError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  if (extra) Object.assign(e, extra);
  return e;
}

let prismaRef = null;
function getPrisma() {
  if (!prismaRef) prismaRef = require('../config/prisma');
  return prismaRef;
}

// ---------- Verificadores (servidor) ----------
const VERIFIERS = {
  async PROFILE(prisma, userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });
    return !!(u?.avatarUrl && String(u.avatarUrl).trim());
  },
  async FIRST_MESSAGE(prisma, userId) {
    const rows = await prisma.message.findMany({
      where: { authorId: userId }, select: { content: true }, take: 20, orderBy: { createdAt: 'asc' },
    });
    return rows.some((m) => String(m.content || '').trim().length >= 2);
  },
  async REACT(prisma, userId) {
    const r = await prisma.reaction.findFirst({
      where: { userId, message: { authorId: { not: userId } } }, select: { id: true },
    });
    return !!r;
  },
  async PROFILE_THEME(prisma, userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { profileColor: true, profileNameFont: true, profileNameEffect: true, profileNameColor: true, bannerUrl: true },
    });
    if (!u) return false;
    if (u.bannerUrl) return true;
    return Object.entries(DEFAULT_PROFILE).some(([k, v]) => u[k] && String(u[k]).toUpperCase() !== v.toUpperCase());
  },
  async NOTIFICATIONS(prisma, userId) {
    const [web, native] = await Promise.all([
      prisma.webPushSubscription ? prisma.webPushSubscription.count({ where: { userId } }).catch(() => 0) : 0,
      prisma.pushToken ? prisma.pushToken.count({ where: { userId } }).catch(() => 0) : 0,
    ]);
    return web + native > 0;
  },
};

async function verifyStep(prisma, userId, step, row) {
  if (EVENT_STEPS.has(step)) return !!row?.completedAt;
  const fn = VERIFIERS[step];
  if (!fn) return false;
  try { return !!(await fn(prisma, userId)); } catch { return false; }
}

// ---------- Estado ----------
async function getState(userId, { prisma = getPrisma(), now = Date.now(), env = process.env } = {}) {
  const [user, rows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
    prisma.userOnboardingStep.findMany({ where: { userId } }),
  ]);
  const byStep = new Map(rows.map((r) => [r.step, r]));
  const steps = await Promise.all(STEPS.map(async (s) => {
    const row = byStep.get(s.key);
    const claimed = !!row?.claimedAt;
    const done = claimed || (await verifyStep(prisma, userId, s.key, row));
    return {
      key: s.key, title: s.title, description: s.description, action: s.action,
      coins: s.coins, done, claimed,
    };
  }));
  const totalCoins = STEPS.reduce((a, s) => a + s.coins, 0);
  const earnedCoins = steps.filter((s) => s.claimed).reduce((a, s) => a + s.coins, 0);
  return {
    eligible: isEligible(user, now, env),
    accountCreatedAt: user?.createdAt || null,
    tourSeenAt: byStep.get('TOUR')?.completedAt || null,
    dismissedAt: byStep.get('DISMISS')?.completedAt || null,
    steps,
    totalCoins,
    earnedCoins,
    allClaimed: steps.every((s) => s.claimed),
  };
}

// ---------- Ritmo de resgate (anti-abuso) ----------
const CLAIM_WINDOW_MS = 60 * 1000;
const CLAIM_MAX_PER_WINDOW = 10;
const claimHits = new Map(); // userId -> [timestamps]
function claimRateOk(userId, now = Date.now()) {
  const list = (claimHits.get(userId) || []).filter((t) => now - t < CLAIM_WINDOW_MS);
  if (list.length >= CLAIM_MAX_PER_WINDOW) { claimHits.set(userId, list); return false; }
  list.push(now);
  claimHits.set(userId, list);
  if (claimHits.size > 5000) claimHits.clear();
  return true;
}

// Resgata a recompensa de um passo. Idempotente: a segunda chamada
// devolve 409 sem pagar de novo.
async function claimStep(userId, stepKey, { prisma = getPrisma(), now = Date.now(), env = process.env, io = null } = {}) {
  const step = STEPS.find((s) => s.key === stepKey);
  if (!step) throw httpError(404, 'Passo não encontrado.');
  if (!claimRateOk(userId, now)) throw httpError(429, 'Calma! Tente de novo em alguns segundos.');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  if (!isEligible(user, now, env)) throw httpError(403, 'Os primeiros passos são só para contas novas.');

  const where = { userId_step: { userId, step: step.key } };
  const existing = await prisma.userOnboardingStep.findUnique({ where });
  if (existing?.claimedAt) throw httpError(409, 'Você já resgatou esse passo.', { code: 'already-claimed' });
  const ok = await verifyStep(prisma, userId, step.key, existing);
  if (!ok) throw httpError(400, 'Esse passo ainda não foi concluído.', { code: 'not-done' });

  const at = new Date(now);
  // Garante a linha (sem pagar ainda) — corrida entre dois resgates cai no
  // updateMany abaixo, que só deixa um passar.
  if (!existing) {
    try {
      await prisma.userOnboardingStep.create({ data: { userId, step: step.key, completedAt: at } });
    } catch (err) {
      if (err?.code !== 'P2002') throw err;
    }
  }
  const balance = await prisma.$transaction(async (tx) => {
    const r = await tx.userOnboardingStep.updateMany({
      where: { userId, step: step.key, claimedAt: null },
      data: { claimedAt: at, coins: step.coins, ...(existing?.completedAt ? {} : { completedAt: at }) },
    });
    if (r.count === 0) throw httpError(409, 'Você já resgatou esse passo.', { code: 'already-claimed' });
    return tx.user.update({ where: { id: userId }, data: { coins: { increment: step.coins } }, select: { coins: true, gems: true } });
  });
  recordTransaction(userId, { kind: 'ONBOARDING', label: `Primeiros passos: ${step.title}`, coins: step.coins });
  io?.notifyUser?.(userId, 'onboarding:update', { step: step.key, claimed: true });
  return { step: step.key, coins: step.coins, balance };
}

// Evento confirmado pelo servidor (ex.: entrou de verdade numa sala de voz).
// Nunca lança e só grava uma vez por pessoa (memória + banco).
const markedMemo = new Set();
async function markEvent(userId, stepKey, io = null, { prisma = getPrisma() } = {}) {
  try {
    if (!userId || !EVENT_STEPS.has(stepKey)) return false;
    const memo = `${userId}|${stepKey}`;
    if (markedMemo.has(memo)) return false;
    if (markedMemo.size > 50000) markedMemo.clear();
    markedMemo.add(memo);
    const where = { userId_step: { userId, step: stepKey } };
    const existing = await prisma.userOnboardingStep.findUnique({ where });
    if (existing?.completedAt) return false;
    if (existing) {
      await prisma.userOnboardingStep.updateMany({ where: { userId, step: stepKey, completedAt: null }, data: { completedAt: new Date() } });
    } else {
      try {
        await prisma.userOnboardingStep.create({ data: { userId, step: stepKey, completedAt: new Date() } });
      } catch (err) { if (err?.code !== 'P2002') throw err; }
    }
    io?.notifyUser?.(userId, 'onboarding:update', { step: stepKey, done: true });
    return true;
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') console.error('[primeiros-passos] falha ao marcar evento:', err?.message || err);
    return false;
  }
}

// Atividade normal do app (mensagem/reação) — só avisa o cliente pra
// atualizar o checklist; a verificação continua sendo no resgate.
const nudged = new Set();
function nudge(userId, stepKey, io) {
  if (!userId || !io?.notifyUser) return;
  const k = `${userId}|${stepKey}`;
  if (nudged.has(k)) return;
  if (nudged.size > 50000) nudged.clear();
  nudged.add(k);
  io.notifyUser(userId, 'onboarding:update', { step: stepKey, done: true });
}

// TOUR (visto) / DISMISS (checklist escondido): estado de interface, sem moedas.
async function setMeta(userId, key, on = true, { prisma = getPrisma() } = {}) {
  if (!META_STEPS.has(key)) throw httpError(400, 'Opção inválida.');
  const where = { userId_step: { userId, step: key } };
  if (!on) {
    await prisma.userOnboardingStep.deleteMany({ where: { userId, step: key } });
    return { [key]: null };
  }
  const at = new Date();
  const { safeUpsert } = require('../utils/prismaSafe');
  await safeUpsert(prisma.userOnboardingStep, { where, create: { userId, step: key, completedAt: at }, update: { completedAt: at } });
  return { [key]: at };
}

// ---------- HTTP ----------
async function getMine(req, res, next) {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await getState(req.user.id));
  } catch (err) { next(err); }
}
async function postClaim(req, res, next) {
  try {
    const step = String(req.params.step || '').toUpperCase();
    const out = await claimStep(req.user.id, step, { io: req.app.get('io') });
    res.json({ ok: true, ...out });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
}
async function postMeta(req, res, next) {
  try {
    const key = String(req.params.key || '').toUpperCase();
    const on = req.body?.on !== false;
    res.json({ ok: true, ...(await setMeta(req.user.id, key, on)) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

function _resetForTests() { claimHits.clear(); markedMemo.clear(); nudged.clear(); prismaRef = null; }
function _setPrismaForTests(p) { prismaRef = p; }

module.exports = {
  STEPS, STEP_KEYS, EVENT_STEPS, META_STEPS, VERIFIERS,
  isEligible, maxAccountAgeDays, getState, claimStep, markEvent, nudge, setMeta,
  getMine, postClaim, postMeta,
  _resetForTests, _setPrismaForTests,
};
