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

    const [weekly, common] = await Promise.all([
      weeklyHours(targetId, games).catch(() => null),
      isMe ? null : commonGames(req.user.id, games).catch(() => null),
    ]);

    res.json({ weekly, common, user, isMe, visible: true, visibility: isMe ? (await prisma.userSettings.findUnique({ where: { userId: targetId }, select: { gamesVisibility: true } }))?.gamesVisibility || 'friends' : access.level, sort, games: list, recent, totals, nowPlaying });
  } catch (err) { next(err); }
}

// Horas por semana (últimas 8 semanas, começando na segunda-feira).
// Fonte "days": GamePlayDay (gravado a partir deste update). Sem esses
// dados ainda, devolve source "lastPlayed": só QUANTOS jogos foram abertos
// pela última vez em cada semana — NÃO é tempo jogado, a tela avisa isso.
const WEEKS = 8;
function weekStarts(now = Date.now()) {
  const today = gamePlaytime.dayKey(now); // AAAA-MM-DD em Brasília
  const d = new Date(`${today}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = segunda
  d.setUTCDate(d.getUTCDate() - dow);
  const out = [];
  for (let i = WEEKS - 1; i >= 0; i -= 1) {
    const w = new Date(d); w.setUTCDate(d.getUTCDate() - i * 7);
    out.push(w.toISOString().slice(0, 10));
  }
  return out;
}
async function weeklyHours(userId, games) {
  const starts = weekStarts();
  const rows = await prisma.gamePlayDay.findMany({ where: { userId, day: { gte: starts[0] } }, select: { day: true, seconds: true }, take: 5000 });
  const idx = (day) => { let k = -1; for (let i = 0; i < starts.length; i += 1) if (day >= starts[i]) k = i; return k; };
  if (rows.length > 0) {
    const weeks = starts.map((start) => ({ start, seconds: 0 }));
    for (const r of rows) { const k = idx(r.day); if (k >= 0) weeks[k].seconds += r.seconds; }
    return { source: 'days', weeks };
  }
  const weeks = starts.map((start) => ({ start, games: 0 }));
  for (const g of games) {
    const k = idx(gamePlaytime.dayKey(new Date(g.lastPlayedAt).getTime()));
    if (k >= 0) weeks[k].games += 1;
  }
  return { source: 'lastPlayed', weeks };
}

// Jogos em comum entre quem está vendo e a biblioteca aberta. Só usa a
// biblioteca de quem vê (a dela é sempre dela) — a outra já passou pela
// checagem de privacidade antes de chegar aqui.
async function commonGames(viewerId, theirGames) {
  if (!theirGames.length) return [];
  const mine = await prisma.gamePlaytime.findMany({
    where: { userId: viewerId, gameKey: { in: theirGames.map((g) => g.gameKey) } },
    select: { gameKey: true, totalSeconds: true },
  });
  const myBy = Object.fromEntries(mine.map((m) => [m.gameKey, m.totalSeconds]));
  return theirGames
    .filter((g) => myBy[g.gameKey] !== undefined)
    .map((g) => ({ gameKey: g.gameKey, name: g.name, steamAppId: g.steamAppId, iconUrl: g.iconUrl, theirSeconds: g.totalSeconds, mySeconds: myBy[g.gameKey] }))
    .sort((a, b) => (b.theirSeconds + b.mySeconds) - (a.theirSeconds + a.mySeconds))
    .slice(0, 24);
}

module.exports = { getLibrary, canSeeLibrary };
