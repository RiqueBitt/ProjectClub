const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRateLimitStore } = require('../config/rateLimitStore');
const { requireAuth } = require('../middleware/auth');

// Game Hub (/api/game-hub): promoções, hotlist do mês, partidas com call,
// clipes por link e builds. Serviços em services/gameHub/*. Só o Node
// responde aqui (nada disso está no Rust).
const router = express.Router();
router.use(requireAuth);

function perUser(name, windowMs, limit, message) {
  return rateLimit({
    windowMs, limit, standardHeaders: true, legacyHeaders: false,
    store: createRateLimitStore(`gh:${name}`),
    keyGenerator: (req) => `u:${req.user.id}`,
    message: { error: message || 'Muitas tentativas seguidas. Espere um pouco.' },
  });
}
const writes = perUser('writes', 60_000, 30, 'Calma: muitas ações seguidas. Espere um pouco.');
const partyCreate = perUser('party', 10 * 60_000, 6, 'Muitas partidas criadas seguidas. Espere um pouco.');
const invites = perUser('invite', 10 * 60_000, 40, 'Muitos convites seguidos. Espere um pouco.');
const clipCreate = perUser('clip', 60 * 60_000, 15, 'Muitos clipes seguidos. Espere um pouco.');
const buildCreate = perUser('build', 24 * 60 * 60_000, 30, 'Você já criou muitas builds hoje. Volte amanhã.');

// Responde o erro "de gente" (status + mensagem) ou passa pro tratador geral.
const handle = (fn) => async (req, res, next) => {
  try { res.json(await fn(req, res)); } catch (err) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
};
const deps = (req) => ({ io: req.app.get('io') });
const me = async (req) => {
  const u = await require('../config/prisma').user.findUnique({ where: { id: req.user.id }, select: { id: true, displayName: true, username: true, platformRole: true } });
  return u || req.user;
};

// ---------- Início / promoções / hotlist ----------
const deals = require('../services/gameHub/deals');
const hotlist = require('../services/gameHub/hotlist');
router.get('/deals', handle(() => deals.getDeals()));
router.get('/hotlist', handle(() => hotlist.getHotlist()));

// ---------- Partidas ----------
const parties = require('../services/gameHub/parties');
router.get('/parties', handle((req) => parties.list(req.user.id, { gameKey: req.query.game || null }).then((list) => ({ parties: list }))));
router.post('/parties', partyCreate, handle(async (req) => ({ party: await parties.create(await me(req), req.body || {}, deps(req)) })));
router.post('/parties/:id/join', writes, handle(async (req) => ({ party: await parties.join(req.user, req.params.id) })));
router.post('/parties/:id/leave', writes, handle((req) => parties.leave(req.user, req.params.id)));
router.post('/parties/:id/close', writes, handle(async (req) => parties.close(await me(req), req.params.id)));
router.post('/parties/:id/kick', writes, handle(async (req) => ({ party: await parties.kick(await me(req), req.params.id, req.body?.userId) })));
router.post('/parties/:id/invite', invites, handle(async (req) => parties.invite(await me(req), req.params.id, req.body?.userIds, deps(req))));
router.post('/parties/:id/call', writes, handle((req) => parties.call(req.user, req.params.id, deps(req))));

// ---------- Clipes ----------
const clips = require('../services/gameHub/clips');
router.get('/clips', handle((req) => clips.list(req.user.id, { gameKey: req.query.game || null, mine: req.query.mine === '1', before: req.query.before || null })));
router.post('/clips', clipCreate, handle(async (req) => ({ clip: await clips.create(req.user, req.body || {}) })));
router.delete('/clips/:id', writes, handle(async (req) => clips.remove(await me(req), req.params.id)));
router.post('/clips/:id/like', writes, handle((req) => clips.toggleLike(req.user, req.params.id)));

// ---------- Builds ----------
const builds = require('../services/gameHub/builds');
const gameData = require('../services/gameHub/gameData');
router.get('/builds', handle((req) => builds.list(req.user.id, {
  game: req.query.game || null, hero: req.query.hero || null, sort: req.query.sort === 'new' ? 'new' : 'top',
  mine: req.query.mine === '1', q: String(req.query.q || '').trim(), skip: req.query.skip,
})));
router.get('/builds/:id', handle(async (req) => ({ build: await builds.get(req.user.id, req.params.id) })));
router.post('/builds', buildCreate, handle(async (req) => ({ build: await builds.create(req.user, req.body || {}) })));
router.put('/builds/:id', writes, handle(async (req) => ({ build: await builds.update(req.user, req.params.id, req.body || {}) })));
router.delete('/builds/:id', writes, handle(async (req) => builds.remove(await me(req), req.params.id)));
router.post('/builds/:id/like', writes, handle((req) => builds.toggleLike(req.user, req.params.id)));

// Dados dos jogos pras builds (cache de 6 h; navegador guarda 1 h).
const dataRoute = (fn) => async (req, res, next) => {
  try { res.set('Cache-Control', 'private, max-age=3600'); res.json(await fn(req)); } catch (err) {
    console.warn('[game-hub] dados do jogo indisponíveis:', err?.message || err);
    if (err?.status) return res.status(err.status).json({ error: err.message });
    res.status(503).json({ error: 'Os dados desse jogo não carregaram agora. Tente de novo daqui a pouco.' });
    void next;
  }
};
router.get('/data/lol', dataRoute(() => gameData.lolData()));
router.get('/data/lol/champion/:id', dataRoute(async (req) => {
  const c = await gameData.lolChampion(req.params.id);
  if (!c) { const e = new Error('Campeão não encontrado.'); e.status = 404; throw e; }
  return c;
}));
router.get('/data/deadlock', dataRoute(() => gameData.deadlockData()));
router.get('/data/darktide', dataRoute(async () => ({ classes: gameData.DARKTIDE_CLASSES })));

module.exports = router;
