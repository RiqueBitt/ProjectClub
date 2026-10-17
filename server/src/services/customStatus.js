const prisma = require('../config/prisma');

// Status personalizado (emoji + texto + "limpar depois de").
//
// Expiração: além da limpeza "preguiçosa" ao ler o usuário
// (clearIfExpired, abaixo), uma varredura a cada minuto limpa os status
// vencidos e avisa todo mundo em tempo real (presence:update +
// user:update) — antes o status vencido continuava aparecendo pros outros
// na lista de membros/DMs até a pessoa recarregar algo.
function clearIfExpired(user) {
  if (!user) return user;
  if (user.customStatusExpiresAt && new Date(user.customStatusExpiresAt) <= new Date()) {
    const cleared = { ...user, customStatus: null, customStatusEmoji: null, customStatusExpiresAt: null };
    prisma.user.update({
      where: { id: user.id },
      data: { customStatus: null, customStatusEmoji: null, customStatusExpiresAt: null },
    }).catch(() => {});
    return cleared;
  }
  return user;
}

// Opções do modal: 30 min, 1 h, 4 h, hoje (fim do dia NO FUSO DA PESSOA —
// o cliente manda o horário exato em `expiresAt`) e nunca (null).
const MAX_STATUS_MS = 8 * 24 * 60 * 60 * 1000;
const MAX_DURATION_MIN = 7 * 24 * 60;

// Puro: { expiresAt: Date|null } ou { error } pra devolver 400.
function computeStatusExpiry({ durationMinutes, expiresAt, now = Date.now() } = {}) {
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
    const at = new Date(expiresAt);
    if (Number.isNaN(at.getTime())) return { error: 'Data de expiração inválida.' };
    if (at.getTime() <= now) return { error: 'A expiração precisa ser no futuro.' };
    if (at.getTime() - now > MAX_STATUS_MS) return { error: 'A expiração pode ser de no máximo 7 dias.' };
    return { expiresAt: at };
  }
  if (durationMinutes === undefined || durationMinutes === null || durationMinutes === '' || durationMinutes === 0 || durationMinutes === '0') {
    return { expiresAt: null };
  }
  const min = Number(durationMinutes);
  if (!Number.isFinite(min) || min <= 0) return { error: 'Duração inválida.' };
  if (min > MAX_DURATION_MIN) return { error: 'A expiração pode ser de no máximo 7 dias.' };
  return { expiresAt: new Date(now + Math.round(min * 60 * 1000)) };
}

const SWEEP_BATCH = 200;
async function sweepExpiredStatuses(io, now = new Date()) {
  const rows = await prisma.user.findMany({
    where: { customStatusExpiresAt: { not: null, lte: now } },
    select: { id: true, status: true },
    take: SWEEP_BATCH,
  });
  if (!rows.length) return 0;
  await prisma.user.updateMany({
    // Confere de novo a data: se a pessoa trocou o status entre a busca e
    // aqui (nova expiração no futuro), não apaga o novo.
    where: { id: { in: rows.map((r) => r.id) }, customStatusExpiresAt: { lte: now } },
    data: { customStatus: null, customStatusEmoji: null, customStatusExpiresAt: null },
  });
  if (io) {
    for (const r of rows) {
      const patch = { id: r.id, customStatus: null, customStatusEmoji: null, customStatusExpiresAt: null };
      io.emitPresenceUpdate?.({ id: r.id, status: r.status, customStatus: null, customStatusEmoji: null });
      io.to('community').to(`user:${r.id}`).emit('user:update', patch);
    }
  }
  return rows.length;
}

let timer = null;
function startCustomStatusSweep(io, intervalMs = 60 * 1000) {
  if (timer) return;
  const run = () => sweepExpiredStatuses(io).catch((err) => console.error('[status] varredura falhou:', err?.message || err));
  timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 15 * 1000).unref?.();
}

module.exports = { clearIfExpired, computeStatusExpiry, sweepExpiredStatuses, startCustomStatusSweep, MAX_DURATION_MIN };
