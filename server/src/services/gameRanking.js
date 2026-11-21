// Ranking por jogo (item "Ranking por jogo"): horas jogadas (detecção do app
// de PC — GamePlaytime) entre quem deixou a biblioteca visível pra você:
// "todos" + seus amigos (menos quem escolheu "ninguém") + você.
const getPrisma = () => require('../config/prisma');
const TOP_GAMES = 12;
const TOP_PLAYERS = 20;

async function visibleUserIds(viewerId, { db = getPrisma() } = {}) {
  const [everyone, nobody, friends] = await Promise.all([
    db.userSettings.findMany({ where: { gamesVisibility: 'everyone' }, select: { userId: true } }),
    db.userSettings.findMany({ where: { gamesVisibility: 'nobody' }, select: { userId: true } }),
    db.friendship.findMany({ where: { status: 'ACCEPTED', OR: [{ requesterId: viewerId }, { addresseeId: viewerId }] }, select: { requesterId: true, addresseeId: true } }),
  ]);
  const hidden = new Set(nobody.map((r) => r.userId));
  const ids = new Set(everyone.map((r) => r.userId));
  for (const f of friends) {
    const other = f.requesterId === viewerId ? f.addresseeId : f.requesterId;
    if (!hidden.has(other)) ids.add(other);
  }
  ids.add(viewerId);
  return [...ids];
}

async function topGames(viewerId, { db = getPrisma() } = {}) {
  const ids = await visibleUserIds(viewerId, { db });
  const rows = await db.gamePlaytime.groupBy({
    by: ['gameKey'], where: { userId: { in: ids }, totalSeconds: { gt: 0 } },
    _sum: { totalSeconds: true }, _count: { userId: true }, orderBy: { _sum: { totalSeconds: 'desc' } }, take: TOP_GAMES,
  });
  const meta = await db.gamePlaytime.findMany({ where: { gameKey: { in: rows.map((r) => r.gameKey) } }, select: { gameKey: true, name: true, iconUrl: true, steamAppId: true }, distinct: ['gameKey'] });
  const byKey = new Map(meta.map((m) => [m.gameKey, m]));
  return rows.map((r) => ({
    gameKey: r.gameKey, name: byKey.get(r.gameKey)?.name || r.gameKey, iconUrl: byKey.get(r.gameKey)?.iconUrl || null,
    steamAppId: byKey.get(r.gameKey)?.steamAppId || null, totalSeconds: r._sum.totalSeconds || 0, players: r._count.userId || 0,
  }));
}

async function topPlayers(viewerId, gameKey, { db = getPrisma() } = {}) {
  const key = String(gameKey || '').slice(0, 120);
  const ids = await visibleUserIds(viewerId, { db });
  const rows = await db.gamePlaytime.findMany({
    where: { gameKey: key, userId: { in: ids }, totalSeconds: { gt: 0 } }, orderBy: { totalSeconds: 'desc' }, take: TOP_PLAYERS,
    select: { userId: true, name: true, totalSeconds: true, lastPlayedAt: true, user: { select: { id: true, displayName: true, username: true, avatarUrl: true } } },
  });
  return { gameKey: key, name: rows[0]?.name || key, players: rows.map((r, i) => ({ position: i + 1, user: r.user, totalSeconds: r.totalSeconds, lastPlayedAt: r.lastPlayedAt })) };
}

module.exports = { visibleUserIds, topGames, topPlayers };
