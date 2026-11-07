const prisma = require('../config/prisma');

// Histórico da carteira (moedas/gemas/XP) — só registro, nunca altera
// saldo. Sempre "best-effort": se a tabela ainda não existir ou o banco
// falhar, a operação principal (compra, baú, missão) segue normal.
function recordTransaction(userId, { kind, label, coins = 0, gems = 0, xp = 0 }) {
  if (!userId || (!coins && !gems && !xp)) return Promise.resolve(null);
  try {
    return prisma.economyTransaction.create({
      data: {
        userId, kind: String(kind || 'OTHER').slice(0, 32), label: String(label || '').slice(0, 180),
        coins: Math.trunc(coins) || 0, gems: Math.trunc(gems) || 0, xp: Math.trunc(xp) || 0,
      },
    }).catch(() => null);
  } catch { return Promise.resolve(null); }
}

async function listTransactions(userId, { limit = 40, before } = {}) {
  const take = Math.max(1, Math.min(100, parseInt(limit, 10) || 40));
  const where = { userId };
  if (before) {
    const d = new Date(before);
    if (!Number.isNaN(d.getTime())) where.createdAt = { lt: d };
  }
  const rows = await prisma.economyTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, take });
  return { transactions: rows, hasMore: rows.length === take };
}

module.exports = { recordTransaction, listTransactions };
