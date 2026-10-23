// Faxina diária do banco — linhas que só ocupam espaço (e deixam índice e
// backup maiores) depois de um tempo:
//   - RefreshToken vencido há mais de 30 dias, ou revogado há mais de 30
//     dias E já vencido (revogado ainda dentro da validade fica: é ele que
//     detecta reuso de token roubado em authController.refresh)
//   - PasswordResetToken / EmailVerificationCode vencidos há mais de 7 dias
//   - TwoFactorRecoveryCode JÁ USADO há mais de 90 dias
//   - ActivityEvent com mais de 90 dias
//   - UserNotice JÁ LIDO com mais de 90 dias (não lido fica)
//   - ErrorLog sem ocorrência nova há mais de 30 dias
//
// Roda 5 min depois do boot e depois a cada 24h. Com mais de uma instância,
// um lock no Redis (SET NX) garante que só uma faz a faxina por rodada.
// Apaga em lotes pequenos pra não segurar lock de tabela por muito tempo.
const DAY = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
const INTERVAL_MS = DAY;
const LOCK_KEY = 'lock:cleanup-jobs';
const LOCK_TTL_SECONDS = 30 * 60;
const BATCH = 5000;
const MAX_BATCHES = 40; // teto de 200k linhas por tabela por rodada

let timer = null;
let firstTimer = null;

function buildTasks(now = Date.now()) {
  const ago = (days) => new Date(now - days * DAY);
  const nowDate = new Date(now);
  return [
    {
      name: 'RefreshToken', model: 'refreshToken',
      where: {
        OR: [
          { expiresAt: { lt: ago(30) } },
          { revoked: true, revokedAt: { lt: ago(30) }, expiresAt: { lt: nowDate } },
        ],
      },
    },
    { name: 'PasswordResetToken', model: 'passwordResetToken', where: { expiresAt: { lt: ago(7) } } },
    { name: 'EmailVerificationCode', model: 'emailVerificationCode', where: { expiresAt: { lt: ago(7) } } },
    { name: 'TwoFactorRecoveryCode', model: 'twoFactorRecoveryCode', where: { usedAt: { lt: ago(90) } } },
    { name: 'ActivityEvent', model: 'activityEvent', where: { createdAt: { lt: ago(90) } } },
    { name: 'UserNotice', model: 'userNotice', where: { readAt: { not: null }, createdAt: { lt: ago(90) } } },
    { name: 'ErrorLog', model: 'errorLog', where: { lastSeen: { lt: ago(30) } } },
  ];
}

// deleteMany do Prisma não tem LIMIT: busca ids em lote e apaga por id.
async function deleteInBatches(delegate, where) {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await delegate.findMany({ where, select: { id: true }, take: BATCH });
    if (!rows.length) break;
    // eslint-disable-next-line no-await-in-loop
    const { count } = await delegate.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    total += count;
    if (rows.length < BATCH) break;
  }
  return total;
}

async function acquireLock(redis) {
  if (!redis) return true;
  try {
    const ok = await redis.set(LOCK_KEY, String(process.pid), 'EX', LOCK_TTL_SECONDS, 'NX');
    return ok === 'OK';
  } catch {
    // Redis fora do ar: roda mesmo assim (as exclusões são idempotentes —
    // duas instâncias rodando juntas só repetem trabalho).
    return true;
  }
}

async function runCleanup({ prisma = require('../config/prisma'), redis, now = Date.now(), log = console.log } = {}) {
  let redisClient = redis;
  if (redisClient === undefined) {
    try { redisClient = require('../config/redis').redis; } catch { redisClient = null; }
  }
  if (!(await acquireLock(redisClient))) return { skipped: true };

  const counts = {};
  const started = Date.now();
  for (const task of buildTasks(now)) {
    const delegate = prisma[task.model];
    if (!delegate) continue; // client antigo sem a tabela
    try {
      // eslint-disable-next-line no-await-in-loop
      counts[task.name] = await deleteInBatches(delegate, task.where);
    } catch (err) {
      counts[task.name] = `erro: ${err?.message || err}`;
    }
  }
  const summary = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ');
  log(`[limpeza] ${summary} (${Date.now() - started}ms)`);
  return { counts };
}

function startCleanupJobs() {
  if (timer || firstTimer) return;
  const safeRun = () => runCleanup().catch((err) => console.error('[limpeza] falhou:', err?.message || err));
  firstTimer = setTimeout(() => { firstTimer = null; safeRun(); }, FIRST_RUN_DELAY_MS);
  firstTimer.unref?.();
  timer = setInterval(safeRun, INTERVAL_MS);
  timer.unref?.();
}

module.exports = { startCleanupJobs, runCleanup, buildTasks, deleteInBatches };
