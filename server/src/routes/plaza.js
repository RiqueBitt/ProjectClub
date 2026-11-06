// Praça (Club Penguin). O jogo em si é servido pelo Waddle Forever embutido
// (services/waddle); aqui só o que a página React precisa pra abrir ele.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireFeature } = require('../config/features');
const waddle = require('../services/waddle');

const router = express.Router();
router.use(requireFeature('plaza'));

// Configuração da sessão: SWF de entrada, socketProxy do Ruffle e o pinguim da conta.
router.get('/config', requireAuth, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await waddle.getConfig(req.user));
  } catch (err) { next(err); }
});

// Pacote de instalação (jogo completo / evento) num fluxo único.
router.get('/pack/:kind(base|event)', requireAuth, async (req, res, next) => {
  try { await waddle.streamPack(req.params.kind, res); } catch (err) { next(err); }
});

// Centro de Download do jogo: pacotes por categoria.
router.get('/packs', requireAuth, async (req, res, next) => {
  try { res.set('Cache-Control', 'no-store'); res.json(await waddle.listPacks()); } catch (err) { next(err); }
});
router.get('/packs/:id/urls', requireAuth, async (req, res, next) => {
  try {
    const urls = await waddle.packUrls(String(req.params.id));
    if (!urls) return res.status(404).json({ error: 'Pacote não encontrado.' });
    return res.json({ urls });
  } catch (err) { return next(err); }
});
router.get('/packs/:id/stream', requireAuth, async (req, res, next) => {
  try { await waddle.streamNamedPack(String(req.params.id), req.query.from, res); } catch (err) { next(err); }
});

// Sem login: quantos pinguins estão na ilha (pra badge da barra lateral).
router.get('/status', async (req, res, next) => {
  try { res.json(await waddle.getStatus()); } catch (err) { next(err); }
});

// ---- Eventos da Praça (quests, moeda de evento, loja, códigos, mascotes,
// advento, Coins for Change) — services/waddle/events.js. A janela "Festa"
// dentro do jogo usa isto.
const events = require('../services/waddle/events');
const evWrap = (fn) => async (req, res, next) => {
  try { res.set('Cache-Control', 'no-store'); res.json(await fn(req)); } catch (err) {
    if (err && !err.status && err.message && !/prisma|ECONN|Unknown/i.test(err.message)) return res.status(400).json({ error: err.message });
    return next(err);
  }
};
router.get('/events', requireAuth, evWrap((req) => events.playerState(req.user.id)));
router.post('/events/:slug/quests/:key/claim', requireAuth, evWrap((req) => events.claimQuest(req.user.id, req.params.slug, req.params.key)));
router.post('/events/:slug/shop/:key', requireAuth, evWrap((req) => events.buy(req.user.id, req.params.slug, req.params.key)));
router.post('/events/:slug/donate', requireAuth, evWrap((req) => events.donate(req.user.id, req.params.slug, req.body?.amount)));
router.post('/events/:slug/cfc/:index/claim', requireAuth, evWrap((req) => events.claimCfc(req.user.id, req.params.slug, req.params.index)));
router.post('/events/:slug/advent/:day', requireAuth, evWrap((req) => events.claimAdvent(req.user.id, req.params.slug, req.params.day)));
router.post('/codes/redeem', requireAuth, evWrap((req) => events.redeemCode(req.user.id, req.body?.code)));
router.get('/friends', requireAuth, evWrap((req) => events.friendsOnIsland(req.user.id)));

module.exports = router;
