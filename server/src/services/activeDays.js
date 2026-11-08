const prisma = require('../config/prisma');

// Quem usou o Project Club em cada dia (pro painel de números da staff:
// ativos por dia, por semana, retenção). Grava no máximo 1 linha por pessoa
// por dia; o cache em memória evita ir no banco a cada requisição.
const seen = new Set();
let seenDay = '';

const dayKey = (d = new Date()) => {
  // Dia no horário de Brasília (UTC-3), que é o "hoje" da comunidade.
  const t = new Date(d.getTime() - 3 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
};

function markActive(userId) {
  if (!userId) return;
  const day = dayKey();
  if (day !== seenDay) { seen.clear(); seenDay = day; }
  const k = `${userId}`;
  if (seen.has(k)) return;
  seen.add(k);
  prisma.userActiveDay.createMany({ data: [{ userId, day }], skipDuplicates: true }).catch(() => seen.delete(k));
}

module.exports = { markActive, dayKey };
