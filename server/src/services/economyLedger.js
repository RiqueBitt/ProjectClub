const prisma = require('../config/prisma');

// Registro interno da carteira (moedas/gemas/XP) — usado pelo painel da
// staff e pela exportação de dados; a aba "Histórico" saiu da Economia
// (nov/2026). Só registro, nunca altera saldo. Sempre "best-effort": se a tabela ainda não existir ou o banco
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

module.exports = { recordTransaction };
