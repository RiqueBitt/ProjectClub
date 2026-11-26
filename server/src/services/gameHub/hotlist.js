// Game Hub → Hotlist: os 5 jogos mais jogados no Project Club no mês
// (horas somadas de todo mundo, pela detecção do app do PC — GamePlayDay).
// Só números agregados (horas e quantas pessoas); quem deixou a biblioteca
// em "ninguém" fica de fora da conta. Mês no horário de Brasília.
const getPrisma = () => require('../../config/prisma');
const { dayKey } = require('../../utils/gameKeys');

const TOP = 5;
const TTL = 10 * 60 * 1000;
let memo = null; // { at, month, value }

const monthStartKey = (now = Date.now()) => `${dayKey(now).slice(0, 8)}01`;

async function computeHotlist({ db = getPrisma(), now = Date.now() } = {}) {
  const from = monthStartKey(now);
  const hidden = await db.userSettings.findMany({ where: { gamesVisibility: 'nobody' }, select: { userId: true } });
  const where = { day: { gte: from }, seconds: { gt: 0 }, ...(hidden.length ? { userId: { notIn: hidden.map((h) => h.userId) } } : {}) };
  const rows = await db.gamePlayDay.groupBy({ by: ['gameKey'], where, _sum: { seconds: true }, orderBy: { _sum: { seconds: 'desc' } }, take: TOP });
  const keys = rows.map((r) => r.gameKey);
  if (!keys.length) return { month: from.slice(0, 7), games: [] };
  const [pairs, meta] = await Promise.all([
    db.gamePlayDay.groupBy({ by: ['gameKey', 'userId'], where: { ...where, gameKey: { in: keys } } }),
    db.gamePlaytime.findMany({ where: { gameKey: { in: keys } }, select: { gameKey: true, name: true, steamAppId: true, iconUrl: true }, distinct: ['gameKey'] }),
  ]);
  const players = new Map();
  for (const p of pairs) players.set(p.gameKey, (players.get(p.gameKey) || 0) + 1);
  const byKey = new Map(meta.map((m) => [m.gameKey, m]));
  return {
    month: from.slice(0, 7),
    games: rows.map((r, i) => ({
      position: i + 1, gameKey: r.gameKey, name: byKey.get(r.gameKey)?.name || r.gameKey,
      steamAppId: byKey.get(r.gameKey)?.steamAppId || null, iconUrl: byKey.get(r.gameKey)?.iconUrl || null,
      seconds: r._sum.seconds || 0, players: players.get(r.gameKey) || 0,
    })),
  };
}

async function getHotlist(deps = {}) {
  const now = deps.now || Date.now();
  const month = monthStartKey(now);
  if (!deps.db && memo && memo.month === month && now - memo.at < TTL) return memo.value;
  const value = await computeHotlist({ ...deps, now });
  if (!deps.db) memo = { at: now, month, value };
  return value;
}

module.exports = { getHotlist, computeHotlist, monthStartKey };
