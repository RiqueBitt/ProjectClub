// Quiz do Pingu: a equipe começa um quiz num canal (Painel → Pingu, ou
// "@pingu quiz") ou ele roda sozinho uma vez por dia no horário escolhido.
// O Pingu posta uma pergunta do banco (PinguQuizQuestion, revisado pela
// equipe); a primeira resposta certa dentro do tempo ganha moedas e XP.
//
// - A IA é opcional: só serve pra SUGERIR perguntas novas no painel, que
//   entram como "pendentes" até alguém da equipe aprovar.
// - Resposta certa: sem acento, sem maiúsculas, ignorando "acho que é…".
// - Prêmio uma vez só: trava em memória na hora + updateMany no banco
//   (winnerId ainda vazio), então dois acertos ao mesmo tempo não pagam duas vezes.
// - Anti-spam: até MAX_ATTEMPTS tentativas por pessoa por rodada e um
//   intervalo mínimo entre tentativas (o que vier antes é ignorado).
const { normalize, editDistance, clip } = require('./text');

const MAX_ATTEMPTS = 5;
const MIN_GAP_MS = 1500;
const TIME_ZONE = 'America/Sao_Paulo';
const FILLER = new Set(['acho', 'que', 'e', 'eh', 'seria', 'resposta', 'o', 'a', 'os', 'as', 'um', 'uma', 'talvez', 'sao', 'sera']);

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ---------------- respostas (puro) ----------------

/** Resposta "limpa": sem acento, sem pontuação e sem palavras de enchimento. */
function normalizeAnswer(text) {
  return normalize(text).split(' ').filter((w) => w && !FILLER.has(w)).join(' ');
}

function parseAnswers(raw) {
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch { list = raw.split('|'); } }
  return (Array.isArray(list) ? list : []).map((a) => String(a || '').trim()).filter(Boolean).slice(0, 10);
}

/** A tentativa bate com alguma resposta aceita? */
function isCorrect(guess, answers) {
  const g = normalizeAnswer(guess);
  if (!g || g.length > 80) return false;
  return parseAnswers(answers).some((ans) => {
    const a = normalizeAnswer(ans) || normalize(ans);
    if (!a) return false;
    if (g === a) return true;
    // Um errinho de digitação em respostas compridas (não em números).
    if (a.length >= 6 && !/^\d+$/.test(a) && editDistance(g, a, 1) <= 1) return true;
    return false;
  });
}

/** Lê a sugestão da IA no formato "PERGUNTA: … / RESPOSTA: a | b". */
function parseGenerated(text) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const q = t.match(/PERGUNTA\s*:\s*(.+)/i);
  const r = t.match(/RESPOSTAS?\s*:\s*(.+)/i);
  if (!q || !r) return null;
  const question = clip(q[1].replace(/\*\*/g, '').trim(), 300);
  const answers = r[1].replace(/\*\*/g, '').split(/\s*[|;/]\s*/).map((a) => a.trim().replace(/[.]$/, '')).filter(Boolean).slice(0, 5);
  if (question.length < 8 || !answers.length) return null;
  return { question, answers };
}

/** Data e hora de Brasília (dia "AAAA-MM-DD" e hora 0–23). */
function brNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// ---------------- motor das rodadas ----------------

/**
 * deps: { getConfig, pickQuestion(id?), createRound(data), claimRound(id, userId) → bool,
 *         award(userId, xp, opts), economyOff() → bool, post(channelId, text, opts),
 *         botId() → id, now(), setTimer(fn, ms), clearTimer(t) }
 */
function createQuiz(deps) {
  const rounds = new Map(); // channelId -> rodada ativa

  async function expire(channelId, roundId) {
    const a = rounds.get(channelId);
    if (!a || a.roundId !== roundId || a.winnerId) return;
    rounds.delete(channelId);
    await deps.post(channelId, `⏰ Tempo esgotado! Ninguém acertou. A resposta era: ${a.display}. 🐧`).catch(() => {});
  }

  async function startRound(io, { channelId, startedBy = null, questionId = null }) {
    if (!channelId) throw bad('Escolha o canal do quiz.');
    if (rounds.has(channelId)) throw bad('Já tem um quiz rolando neste canal.', 409);
    rounds.set(channelId, { pending: true }); // reserva o canal enquanto prepara
    try {
      const cfg = deps.getConfig();
      const q = await deps.pickQuestion(questionId);
      if (!q) throw bad('Não tem nenhuma pergunta aprovada no banco do quiz.');
      const answers = parseAnswers(q.answers);
      if (!answers.length) throw bad('Essa pergunta está sem resposta cadastrada.');
      const windowSec = cfg.quizWindowSec || 60;
      const off = await deps.economyOff().catch(() => false);
      const coins = off ? 0 : (cfg.quizCoins || 0);
      const xp = off ? 0 : (cfg.quizXp || 0);
      const endsAt = new Date(deps.now() + windowSec * 1000);
      const round = await deps.createRound({ channelId, questionId: q.id || null, question: q.question, startedBy, coins, xp, endsAt });
      const prize = coins || xp ? ` Quem acertar primeiro ganha ${[coins ? `${coins} moedas` : null, xp ? `${xp} XP` : null].filter(Boolean).join(' e ')}!` : ' Quem acertar primeiro leva a glória!';
      await deps.post(channelId, `🧠 Quiz do Pingu! ${q.question}\nResponda aqui no canal em até ${windowSec} segundos.${prize}`);
      const active = {
        roundId: round.id, channelId, answers, display: answers[0], endsAt: endsAt.getTime(),
        coins, xp, winnerId: null, attempts: new Map(), timer: null,
      };
      active.timer = deps.setTimer(() => { expire(channelId, round.id).catch(() => {}); }, windowSec * 1000);
      rounds.set(channelId, active);
      return { roundId: round.id, question: q.question, endsAt };
    } catch (err) {
      rounds.delete(channelId);
      throw err;
    }
  }

  async function claim(a, message) {
    try {
      const won = await deps.claimRound(a.roundId, message.authorId);
      if (!won) return false;
      if (a.coins || a.xp) await deps.award(message.authorId, a.xp, { coins: a.coins, kind: 'QUIZ', label: 'Quiz do Pingu' }).catch(() => null);
      const who = message.author?.username ? `@${message.author.username}` : (message.author?.displayName || 'Alguém');
      const prize = a.coins || a.xp ? ` +${[a.coins ? `${a.coins} moedas` : null, a.xp ? `${a.xp} XP` : null].filter(Boolean).join(' e ')}.` : '';
      await deps.post(message.channelId, `🎉 ${who} acertou! A resposta era: ${a.display}.${prize}`, {
        replyToId: message.id, mentions: [{ targetType: 'USER', targetId: message.authorId }],
      }).catch(() => {});
      return true;
    } catch (err) {
      console.warn('[pingu] quiz: falha ao premiar:', err?.message || err);
      return false;
    }
  }

  /**
   * Toda mensagem de canal passa aqui (barato quando não tem quiz no canal).
   * Devolve Promise<boolean> (true = foi a resposta vencedora).
   */
  function onMessage(io, message) {
    const a = message && rounds.get(message.channelId);
    if (!a || a.pending || a.winnerId || !message.content || message.threadId) return Promise.resolve(false);
    const t = deps.now();
    if (t > a.endsAt) return Promise.resolve(false);
    if (message.authorId === deps.botId()) return Promise.resolve(false);
    const att = a.attempts.get(message.authorId) || { count: 0, last: 0 };
    if (att.count >= MAX_ATTEMPTS || t - att.last < MIN_GAP_MS) return Promise.resolve(false);
    att.count += 1;
    att.last = t;
    a.attempts.set(message.authorId, att);
    if (!isCorrect(message.content, a.answers)) return Promise.resolve(false);
    // Trava na hora (antes de qualquer await): só o primeiro acerto segue.
    a.winnerId = message.authorId;
    deps.clearTimer(a.timer);
    rounds.delete(message.channelId);
    return claim(a, message);
  }

  return {
    startRound, onMessage,
    activeRound: (channelId) => {
      const a = rounds.get(channelId);
      return a && !a.pending ? { roundId: a.roundId, endsAt: new Date(a.endsAt) } : null;
    },
    _rounds: rounds,
  };
}

// ---------------- dependências reais ----------------

const db = () => require('../../config/prisma');
const bot = () => require('../pinguBot');

async function pickQuestion(questionId) {
  if (questionId) return db().pinguQuizQuestion.findFirst({ where: { id: questionId, status: 'APPROVED' } });
  // Entre as 10 menos usadas, uma ao acaso.
  const options = await db().pinguQuizQuestion.findMany({
    where: { status: 'APPROVED' }, orderBy: [{ timesAsked: 'asc' }, { createdAt: 'asc' }], take: 10,
  });
  if (!options.length) return null;
  const q = options[Math.floor(Math.random() * options.length)];
  await db().pinguQuizQuestion.update({ where: { id: q.id }, data: { timesAsked: { increment: 1 }, lastAskedAt: new Date() } }).catch(() => {});
  return q;
}

let economyCache = { at: 0, off: false };
async function economyOff() {
  if (Date.now() - economyCache.at < 60_000) return economyCache.off;
  let off = false;
  try {
    const s = await db().platformSettings.findUnique({ where: { id: 'singleton' }, select: { disabledSystems: true } });
    off = JSON.parse(s?.disabledSystems || '[]').includes('economia');
  } catch { off = false; }
  economyCache = { at: Date.now(), off };
  return off;
}

const engine = createQuiz({
  getConfig: () => require('./config').getConfig(),
  pickQuestion,
  createRound: (data) => db().pinguQuizRound.create({ data }),
  claimRound: async (id, userId) => {
    const r = await db().pinguQuizRound.updateMany({ where: { id, winnerId: null }, data: { winnerId: userId, answeredAt: new Date() } });
    return r.count === 1;
  },
  award: (userId, xp, opts) => require('../xp').awardXp(userId, xp, opts),
  economyOff,
  post: (channelId, text, opts) => bot().postAsPingu(channelId, text, opts),
  botId: () => bot().getPinguId(),
  now: () => Date.now(),
  setTimer: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clearTimer: (t) => clearTimeout(t),
});

/** Placar: quem mais acertou (todas as rodadas). */
async function scoreboard(limit = 10) {
  const rows = await db().pinguQuizRound.groupBy({
    by: ['winnerId'], where: { winnerId: { not: null } },
    _count: { _all: true }, _sum: { coins: true, xp: true },
    orderBy: { _count: { winnerId: 'desc' } }, take: Math.min(50, limit),
  });
  const users = await db().user.findMany({
    where: { id: { in: rows.map((r) => r.winnerId) } },
    select: { id: true, username: true, displayName: true, avatarUrl: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => ({ user: byId.get(r.winnerId) || { id: r.winnerId }, wins: r._count._all, coins: r._sum.coins || 0, xp: r._sum.xp || 0 }));
}

// ---------------- banco de perguntas (painel) ----------------

const shapeQuestion = (q) => ({ ...q, answers: parseAnswers(q.answers) });

function validateQuestion(body, { partial = false } = {}) {
  const data = {};
  if (!partial || body.question !== undefined) {
    const question = String(body.question || '').replace(/\s+/g, ' ').trim();
    if (question.length < 8 || question.length > 300) throw bad('A pergunta precisa ter de 8 a 300 caracteres.');
    data.question = question;
  }
  if (!partial || body.answers !== undefined) {
    const answers = parseAnswers(Array.isArray(body.answers) ? body.answers : String(body.answers || '').split(/\s*[|\n]\s*/))
      .map((a) => a.slice(0, 80));
    if (!answers.length) throw bad('Coloque pelo menos uma resposta aceita.');
    data.answers = JSON.stringify(answers);
  }
  if (body.category !== undefined || !partial) data.category = String(body.category || 'Geral').trim().slice(0, 40) || 'Geral';
  if (body.status !== undefined) {
    if (!['APPROVED', 'PENDING'].includes(body.status)) throw bad('Situação inválida.');
    data.status = body.status;
  }
  return data;
}

async function listQuestions({ status } = {}) {
  const where = status ? { status } : {};
  const rows = await db().pinguQuizQuestion.findMany({ where, orderBy: [{ status: 'desc' }, { createdAt: 'desc' }], take: 500 });
  return rows.map(shapeQuestion);
}

async function createQuestion(body, userId) {
  const data = validateQuestion(body);
  return shapeQuestion(await db().pinguQuizQuestion.create({ data: { ...data, status: data.status || 'APPROVED', source: 'STAFF', createdBy: userId || null } }));
}

async function updateQuestion(id, body) {
  const data = validateQuestion(body, { partial: true });
  const exists = await db().pinguQuizQuestion.findUnique({ where: { id } });
  if (!exists) throw bad('Pergunta não encontrada.', 404);
  return shapeQuestion(await db().pinguQuizQuestion.update({ where: { id }, data }));
}

async function deleteQuestion(id) {
  await db().pinguQuizQuestion.delete({ where: { id } }).catch(() => { throw bad('Pergunta não encontrada.', 404); });
  return { ok: true };
}

/** A IA sugere uma pergunta nova — entra PENDENTE, a equipe revisa. */
async function generateQuestion({ topic, userId } = {}) {
  const subject = clip(String(topic || '').replace(/\s+/g, ' ').trim(), 80) || 'conhecimentos gerais, games ou Brasil';
  const res = await bot().askModel([
    { role: 'system', content: 'Você cria perguntas de quiz curtas em português do Brasil, com resposta de uma a três palavras. Responda exatamente em duas linhas:\nPERGUNTA: <pergunta>\nRESPOSTA: <resposta> | <outra forma aceita>' },
    { role: 'user', content: `Crie uma pergunta sobre: ${subject}` },
  ], { priority: bot().PRIORITY.BACKGROUND, numPredict: 80, temperature: 0.8 });
  const parsed = parseGenerated(res.text);
  if (!parsed) throw bad('A IA não respondeu no formato certo. Tenta de novo.', 422);
  return shapeQuestion(await db().pinguQuizQuestion.create({
    data: { question: parsed.question, answers: JSON.stringify(parsed.answers), category: clip(subject, 40), status: 'PENDING', source: 'IA', createdBy: userId || null },
  }));
}

async function ensureSeed() {
  if (await db().pinguQuizQuestion.count() > 0) return;
  const { QUIZ_BANK } = require('../../data/pinguQuizBank');
  await db().pinguQuizQuestion.createMany({
    data: QUIZ_BANK.map((q) => ({ question: q.question, answers: JSON.stringify(q.answers), category: q.category, status: 'APPROVED', source: 'SEED' })),
  });
  console.log(`[pingu] quiz: ${QUIZ_BANK.length} perguntas iniciais`);
}

// ---------------- quiz diário ----------------

let schedTimer = null;
async function dailyTick(io) {
  const cfg = require('./config').getConfig();
  if (!cfg.quizDailyEnabled || !cfg.quizChannelId) return;
  const { day, hour } = brNow();
  if (hour !== cfg.quizHour) return;
  // Reserva o dia no banco (vale mesmo com reinício/mais de uma instância).
  const r = await db().pinguConfig.updateMany({
    where: { id: 'singleton', OR: [{ quizLastDailyDay: null }, { quizLastDailyDay: { not: day } }] },
    data: { quizLastDailyDay: day },
  });
  if (r.count !== 1) return;
  await engine.startRound(io, { channelId: cfg.quizChannelId, startedBy: null })
    .catch((err) => console.warn('[pingu] quiz diário:', err?.message || err));
}

function startScheduler(io) {
  if (schedTimer) return;
  schedTimer = setInterval(() => { dailyTick(io).catch(() => {}); }, 60_000);
  schedTimer.unref?.();
}

module.exports = {
  startRound: engine.startRound,
  onMessage: engine.onMessage,
  activeRound: engine.activeRound,
  scoreboard, listQuestions, createQuestion, updateQuestion, deleteQuestion, generateQuestion,
  ensureSeed, startScheduler,
  createQuiz, isCorrect, normalizeAnswer, parseAnswers, parseGenerated, brNow, MAX_ATTEMPTS, MIN_GAP_MS,
};
