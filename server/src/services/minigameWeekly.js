// Ranking SEMANAL dos Mini-Jogos com prêmio em moedas.
//
// Semana = segunda 00:00 a domingo 23:59 no horário de Brasília (UTC-3),
// chave "AAAA-Www" (ISO). O ranking da semana é calculado na hora a partir
// das partidas (MinigameScore: melhor placar de cada pessoa na janela).
// Quando a semana vira, os 3 primeiros de cada jogo ganham moedas: a linha
// MinigameWeeklyPrize é criada uma vez (unique), e a pessoa resgata em
// /minijogos (botão) — moedas + lançamento no extrato.
const prisma = require('../config/prisma');
const { recordTransaction } = require('./economyLedger');

const TZ_OFFSET_MIN = -180; // Brasília
const PRIZES = [
  Number(process.env.MINIGAME_WEEKLY_PRIZE_1) || 200,
  Number(process.env.MINIGAME_WEEKLY_PRIZE_2) || 120,
  Number(process.env.MINIGAME_WEEKLY_PRIZE_3) || 60,
];
const TOP_N = 20;

// Limites da semana (UTC) que contém `now`, segunda 00:00 Brasília.
function weekBounds(now = Date.now()) {
  const local = new Date(now + TZ_OFFSET_MIN * 60000); // relógio local em UTC "deslocado"
  const dow = (local.getUTCDay() + 6) % 7; // 0 = segunda
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dow);
  const start = new Date(startLocal - TZ_OFFSET_MIN * 60000);
  const end = new Date(start.getTime() + 7 * 86400000);
  // Chave ISO: ano/semana da quinta-feira dessa semana.
  const thu = new Date(startLocal + 3 * 86400000);
  const y = thu.getUTCFullYear();
  const jan4 = Date.UTC(y, 0, 4);
  const jan4dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Start = jan4 - jan4dow * 86400000;
  const week = Math.floor((startLocal - week1Start) / (7 * 86400000)) + 1;
  return { key: `${y}-W${String(week).padStart(2, '0')}`, start, end };
}

function previousWeekBounds(now = Date.now()) {
  const cur = weekBounds(now);
  return weekBounds(cur.start.getTime() - 86400000);
}

// Melhor placar por pessoa num jogo dentro da janela, ordenado.
async function standings(game, { start, end }, take = TOP_N) {
  const rows = await prisma.minigameScore.groupBy({
    by: ['userId'], where: { game, createdAt: { gte: start, lt: end }, score: { gt: 0 } },
    _max: { score: true }, orderBy: { _max: { score: 'desc' } }, take,
  });
  return rows.map((r, i) => ({ rank: i + 1, userId: r.userId, score: r._max.score }));
}

async function myWeekly(game, userId, { start, end }) {
  const agg = await prisma.minigameScore.aggregate({ where: { game, userId, createdAt: { gte: start, lt: end } }, _max: { score: true }, _count: { _all: true } });
  const best = agg._max.score || 0;
  if (!best) return { best: 0, plays: agg._count._all || 0, rank: null };
  const aboveRows = await prisma.minigameScore.groupBy({ by: ['userId'], where: { game, createdAt: { gte: start, lt: end }, score: { gt: best } }, _max: { score: true } });
  return { best, plays: agg._count._all || 0, rank: aboveRows.length + 1 };
}

// Fecha uma semana pra um jogo: cria os prêmios (idempotente). Devolve as
// linhas criadas/existentes.
async function settleWeek(game, bounds) {
  const top = await standings(game, bounds, PRIZES.length);
  const out = [];
  for (const row of top) {
    const coins = PRIZES[row.rank - 1];
    if (!coins) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      out.push(await prisma.minigameWeeklyPrize.create({ data: { weekKey: bounds.key, game, userId: row.userId, rank: row.rank, score: row.score, coins } }));
    } catch (err) {
      if (err && err.code === 'P2002') {
        // eslint-disable-next-line no-await-in-loop
        const existing = await prisma.minigameWeeklyPrize.findUnique({ where: { weekKey_game_userId: { weekKey: bounds.key, game, userId: row.userId } } });
        if (existing) out.push(existing);
      } else throw err;
    }
  }
  return out;
}

// Garante que a semana PASSADA está fechada pra todos os jogos com placar
// (lazy: roda quando alguém abre /minijogos; barato depois da 1ª vez).
async function settlePreviousWeek(games, now = Date.now()) {
  const prev = previousWeekBounds(now);
  const marker = await prisma.minigameWeeklyPrize.findFirst({ where: { weekKey: prev.key }, select: { id: true } });
  if (marker) return prev;
  // Quais jogos tiveram partidas na semana passada?
  const played = await prisma.minigameScore.groupBy({ by: ['game'], where: { createdAt: { gte: prev.start, lt: prev.end }, score: { gt: 0 } } });
  for (const { game } of played) {
    if (!games.includes(game)) continue;
    // eslint-disable-next-line no-await-in-loop
    await settleWeek(game, prev);
  }
  return prev;
}

async function myUnclaimedPrizes(userId) {
  return prisma.minigameWeeklyPrize.findMany({ where: { userId, claimedAt: null }, orderBy: [{ weekKey: 'desc' }, { rank: 'asc' }], take: 50 });
}

// Resgate: marca claimedAt (atômico) e credita as moedas + extrato.
async function claimPrize(userId, id) {
  const claimed = await prisma.minigameWeeklyPrize.updateMany({ where: { id, userId, claimedAt: null }, data: { claimedAt: new Date() } });
  if (claimed.count !== 1) return null;
  const prize = await prisma.minigameWeeklyPrize.findUnique({ where: { id } });
  await prisma.user.update({ where: { id: userId }, data: { coins: { increment: prize.coins } } });
  await recordTransaction(userId, { kind: 'MINIGAME_WEEKLY', label: `Ranking semanal · ${prize.game} · ${prize.rank}º lugar (${prize.weekKey})`, coins: prize.coins });
  return prize;
}

module.exports = { weekBounds, previousWeekBounds, standings, myWeekly, settleWeek, settlePreviousWeek, myUnclaimedPrizes, claimPrize, PRIZES, TOP_N };
