// Peças compartilhadas pelos sistemas da Fase 4 (comunidade e economia).
//
// Tudo aqui carrega o Prisma/avisos/extrato só na hora de usar (lazy) — os
// testes passam um banco falso (`db`) e funções falsas de aviso/extrato, sem
// precisar do cliente Prisma gerado.
const getPrisma = () => require('../../config/prisma');

function httpError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

// Dependências padrão de um serviço; `over` substitui qualquer uma (testes).
function deps(over = {}) {
  return {
    db: over.db || getPrisma(),
    io: over.io || null,
    now: over.now ? new Date(over.now) : new Date(),
    notify: over.notify || ((io, userId, notice) => require('../notices').createNotice(io, userId, notice)),
    ledger: over.ledger || ((userId, tx) => require('../economyLedger').recordTransaction(userId, tx)),
    random: over.random || null,
  };
}

// Economia desligada pela staff (Admin → Sistemas → "economia"): nenhum
// sistema novo paga moedas. Cache de 1 min (mesma ideia de voiceRewards).
let economyCache = { at: 0, off: false };
async function economyDisabled(db, { fresh = false } = {}) {
  if (!fresh && Date.now() - economyCache.at < 60_000) return economyCache.off;
  let off = false;
  try {
    const s = await db.platformSettings.findUnique({ where: { id: 'singleton' }, select: { disabledSystems: true } });
    off = JSON.parse(s?.disabledSystems || '[]').includes('economia');
  } catch { off = false; }
  economyCache = { at: Date.now(), off };
  return off;
}
function resetEconomyCache() { economyCache = { at: 0, off: false }; }

// Dá moedas (fora de transação) + lançamento no extrato. Nunca negativo.
async function grantCoins(d, userId, coins, { kind, label }) {
  const n = Math.max(0, Math.trunc(coins) || 0);
  if (!userId || n <= 0) return 0;
  await d.db.user.update({ where: { id: userId }, data: { coins: { increment: n } } });
  try { d.ledger(userId, { kind, label, coins: n }); } catch { /* extrato é só registro */ }
  return n;
}

// Paga UMA vez só por (key, pessoa): cria a RewardGrant e dá as moedas na
// mesma transação — se a linha já existe (P2002), não paga de novo.
// Devolve as moedas pagas (0 = já tinha recebido).
async function grantOnce(d, key, userId, coins, { kind, label }) {
  const n = Math.max(0, Math.trunc(coins) || 0);
  if (!userId || !key) return 0;
  try {
    await d.db.$transaction(async (tx) => {
      await tx.rewardGrant.create({ data: { key: String(key).slice(0, 64), userId, coins: n } });
      if (n > 0) await tx.user.update({ where: { id: userId }, data: { coins: { increment: n } } });
    });
  } catch (err) {
    if (err?.code === 'P2002') return 0;
    throw err;
  }
  if (n > 0) { try { d.ledger(userId, { kind, label, coins: n }); } catch { /* só registro */ } }
  return n;
}

// Trava de tarefa agendada: só UMA instância roda cada chave. Se a tarefa
// começou e não terminou (queda no meio) por mais de `staleMs`, pode ser
// retomada — por isso cada tarefa também precisa ser idempotente por linha.
// `settled`: chaves que já sabemos que terminaram (evita ir ao banco a cada
// minuto só pra descobrir de novo que não há nada a fazer).
const settled = new Set();
async function claimJob(db, key, { staleMs = 60 * 60 * 1000, now = new Date() } = {}) {
  if (settled.has(key)) return false;
  try {
    await db.jobRun.create({ data: { key, startedAt: now } });
    return true;
  } catch (err) {
    if (err?.code !== 'P2002') throw err;
  }
  const r = await db.jobRun.updateMany({
    where: { key, doneAt: null, startedAt: { lt: new Date(now.getTime() - staleMs) } },
    data: { startedAt: now },
  });
  if (r.count === 1) return true;
  const row = await db.jobRun.findUnique({ where: { key } }).catch(() => null);
  if (row?.doneAt) {
    if (settled.size > 5000) settled.clear();
    settled.add(key);
  }
  return false;
}
function _resetSettled() { settled.clear(); }
async function jobDone(db, key) {
  const row = await db.jobRun.findUnique({ where: { key } }).catch(() => null);
  return !!row?.doneAt;
}
async function finishJob(db, key, info = null) {
  await db.jobRun.update({ where: { key }, data: { doneAt: new Date(), info: info ? String(info).slice(0, 500) : null } }).catch(() => {});
}

const isStaff = (user) => ['ADMIN', 'MODERATOR'].includes(user?.platformRole);

// Inteiro dentro de [min, max] ou null.
function intIn(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

const PUBLIC_MINI = { id: true, displayName: true, username: true, avatarUrl: true, avatarDecoration: true, profileColor: true };

// Converte erro com `status` em resposta HTTP; o resto segue pro handler geral.
function route(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err?.status) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
      return next(err);
    }
  };
}

module.exports = {
  getPrisma, httpError, deps, economyDisabled, resetEconomyCache, grantCoins, grantOnce,
  claimJob, finishJob, jobDone, isStaff, intIn, PUBLIC_MINI, route, _resetSettled,
};
