const prisma = require('../config/prisma');
const gamePlaytime = require('../services/gamePlaytime');

// Biblioteca de jogos (estilo Steam) — tempo de jogo por jogo.
// Privacidade: UserSettings.gamesVisibility ("everyone" | "friends" |
// "nobody", padrão "friends"). O dono e a staff sempre veem.
const isStaff = (user) => ['ADMIN', 'MODERATOR'].includes(user?.platformRole);

async function canSeeLibrary(viewer, targetId) {
  if (viewer.id === targetId || isStaff(viewer)) return { ok: true };
  const settings = await prisma.userSettings.findUnique({ where: { userId: targetId }, select: { gamesVisibility: true } });
  const level = settings?.gamesVisibility || 'friends';
  if (level === 'everyone') return { ok: true, level };
  if (level === 'nobody') return { ok: false, level };
  const friendship = await prisma.friendship.findFirst({
    where: { status: 'ACCEPTED', OR: [{ requesterId: viewer.id, addresseeId: targetId }, { requesterId: targetId, addresseeId: viewer.id }] },
    select: { id: true },
  });
  return { ok: !!friendship, level };
}

const SORTS = {
  playtime: (a, b) => b.totalSeconds - a.totalSeconds || a.name.localeCompare(b.name, 'pt-BR'),
  name: (a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  recent: (a, b) => new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt),
};

// GET /api/games/library/:userId?sort=playtime|name|recent&q=
async function getLibrary(req, res, next) {
  try {
    const targetId = req.params.userId === 'me' ? req.user.id : req.params.userId;
    const user = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, username: true, displayName: true, avatarUrl: true } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const access = await canSeeLibrary(req.user, targetId);
    const isMe = req.user.id === targetId;
    if (!access.ok) {
      return res.json({ user, isMe, visible: false, visibility: access.level, games: [], totals: null, nowPlaying: null });
    }

    const rows = await prisma.gamePlaytime.findMany({
      where: { userId: targetId },
      select: { gameKey: true, name: true, steamAppId: true, iconUrl: true, totalSeconds: true, sessions: true, firstPlayedAt: true, lastPlayedAt: true },
      take: 1000,
    });

    // Capa: App ID que faltava — tira do link da capa salvo (desktop manda
    // o header antigo da Steam) ou procura pelo nome (cacheado), esperando
    // no máximo ~1,2s; o que não der tempo fica pra próxima carga.
    const missing = [];
    for (const g of rows) {
      if (g.steamAppId) continue;
      const fromUrl = gamePlaytime.steamAppIdFrom(g.iconUrl);
      if (fromUrl) { g.steamAppId = fromUrl; continue; }
      if (missing.length < 6) missing.push(g);
    }
    if (missing.length) {
      const lookups = Promise.all(missing.map((g) => gamePlaytime.fillSteamAppId(targetId, g.gameKey, g.name).then((id) => { if (id) g.steamAppId = id; })));
      await Promise.race([lookups, new Promise((r) => setTimeout(r, 1200))]);
    }

    // Sessão em andamento: soma o tempo ainda não gravado e marca "jogando agora".
    const live = await gamePlaytime.getLiveSession(targetId).catch(() => null);
    const games = rows.map((g) => {
      const playingNow = !!live && live.gameKey === g.gameKey;
      return {
        ...g,
        totalSeconds: g.totalSeconds + (playingNow ? Math.floor((live.pendingMs || 0) / 1000) : 0),
        lastPlayedAt: playingNow ? new Date(live.lastBeatAt) : g.lastPlayedAt,
        playingNow,
        sessionStartedAt: playingNow ? new Date(live.startedAt) : null,
      };
    });

    const totals = {
      games: games.length,
      seconds: games.reduce((sum, g) => sum + g.totalSeconds, 0),
    };

    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 80);
    const sort = SORTS[req.query.sort] ? req.query.sort : 'playtime';
    const list = (q ? games.filter((g) => g.name.toLowerCase().includes(q)) : games).sort(SORTS[sort]);
    const recent = [...games].sort(SORTS.recent).slice(0, 8);
    const nowPlaying = games.find((g) => g.playingNow) || null;

    res.json({ user, isMe, visible: true, visibility: isMe ? (await prisma.userSettings.findUnique({ where: { userId: targetId }, select: { gamesVisibility: true } }))?.gamesVisibility || 'friends' : access.level, sort, games: list, recent, totals, nowPlaying });
  } catch (err) { next(err); }
}

module.exports = { getLibrary, canSeeLibrary };
