const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');

// Recordes dos Mini-Jogos (client/src/minijogos/catalog.js). O jogo roda num
// iframe da mesma origem e manda o placar pro player, que posta aqui.
// Não dá pra provar que o placar é "real" (o jogo roda no navegador), então
// só seguramos o óbvio: jogo conhecido, número inteiro, teto por jogo e
// limite de envios por minuto (rota).
const GAMES = {
  // HTML5
  beancounters: 100000, pizzatron: 100000, sledracing: 100000,
  // Flash (Ruffle) — placar = moedas/pontos/tickets do fim da partida
  aquagrabber: 50000, astrobarrier: 50000, balloonpop: 50000, cartsurfer: 50000,
  catchinwaves: 50000, dance: 50000, feedapuffle: 50000, hydrohopper: 50000,
  icefishing: 50000, pufflepaddle: 50000, puffleroundup: 50000, pufflesoaker: 50000,
  systemdefender: 50000, thinice: 50000, fluffy: 50000,
  avalanche: 0, clockwork: 0, fur: 0, gmission: 0, missingcoins: 0,
  missingpuffles: 0, spyseek: 0, veggie: 0, waddlesquad: 0,
};
const MAX_SECONDS = 6 * 60 * 60; // uma sessão não conta mais que 6h

function gameOf(req, res) {
  const slug = String(req.params.slug || '');
  if (!Object.prototype.hasOwnProperty.call(GAMES, slug)) { res.status(404).json({ error: 'Mini-jogo não encontrado.' }); return null; }
  return slug;
}

async function rankOf(game, best) {
  if (!best) return null;
  const above = await prisma.minigameStat.count({ where: { game, bestScore: { gt: best } } });
  return above + 1;
}

// POST /api/minigames/:slug/score { score }
async function submitScore(req, res, next) {
  try {
    const game = gameOf(req, res); if (!game) return;
    const max = GAMES[game];
    const score = Math.floor(Number(req.body?.score));
    if (!max) return res.status(400).json({ error: 'Esse mini-jogo não tem placar.' });
    if (!Number.isFinite(score) || score <= 0 || score > max) return res.status(400).json({ error: 'Placar inválido.' });
    const userId = req.user.id;
    const prev = await prisma.minigameStat.findUnique({ where: { userId_game: { userId, game } } });
    const prevBest = prev?.bestScore || 0;
    const isRecord = score > prevBest;
    await prisma.minigameScore.create({ data: { userId, game, score } });
    const stat = await prisma.minigameStat.upsert({
      where: { userId_game: { userId, game } },
      update: isRecord ? { bestScore: score, bestAt: new Date() } : {},
      create: { userId, game, bestScore: score, bestAt: new Date() },
    });
    res.json({ ok: true, score, best: stat.bestScore, previousBest: prevBest, isRecord, rank: await rankOf(game, stat.bestScore) });
  } catch (err) { next(err); }
}

// POST /api/minigames/:slug/play { seconds } — conta uma partida + tempo jogado
async function registerPlay(req, res, next) {
  try {
    const game = gameOf(req, res); if (!game) return;
    const seconds = Math.max(0, Math.min(MAX_SECONDS, Math.floor(Number(req.body?.seconds) || 0)));
    const userId = req.user.id;
    await prisma.minigameStat.upsert({
      where: { userId_game: { userId, game } },
      update: { plays: { increment: 1 }, seconds: { increment: seconds }, lastPlayedAt: new Date() },
      create: { userId, game, plays: 1, seconds },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// GET /api/minigames/:slug/leaderboard — top 20 + meu recorde + minha posição
async function leaderboard(req, res, next) {
  try {
    const game = gameOf(req, res); if (!game) return;
    const userId = req.user.id;
    const [rows, mine, agg] = await Promise.all([
      prisma.minigameStat.findMany({ where: { game, bestScore: { gt: 0 } }, orderBy: [{ bestScore: 'desc' }, { bestAt: 'asc' }], take: 20 }),
      prisma.minigameStat.findUnique({ where: { userId_game: { userId, game } } }),
      prisma.minigameStat.aggregate({ where: { game }, _sum: { plays: true }, _count: { _all: true } }),
    ]);
    const users = rows.length ? await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: PUBLIC_USER_FIELDS }) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const top = rows.filter((r) => byId.has(r.userId)).map((r, i) => ({ rank: i + 1, score: r.bestScore, at: r.bestAt, user: byId.get(r.userId) }));
    res.json({
      game,
      hasScores: !!GAMES[game],
      top,
      me: mine ? { best: mine.bestScore, plays: mine.plays, seconds: mine.seconds, rank: await rankOf(game, mine.bestScore) } : { best: 0, plays: 0, seconds: 0, rank: null },
      totalPlays: agg._sum.plays || 0,
      players: agg._count._all || 0,
    });
  } catch (err) { next(err); }
}

// GET /api/minigames/me — meus recordes/partidas em todos os jogos
async function myStats(req, res, next) {
  try {
    const rows = await prisma.minigameStat.findMany({ where: { userId: req.user.id }, orderBy: { lastPlayedAt: 'desc' } });
    res.json({ stats: rows.map((r) => ({ game: r.game, best: r.bestScore, plays: r.plays, seconds: r.seconds, lastPlayedAt: r.lastPlayedAt })) });
  } catch (err) { next(err); }
}

module.exports = { submitScore, registerPlay, leaderboard, myStats, GAMES };
