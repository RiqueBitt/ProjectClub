const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRateLimitStore } = require('../config/rateLimitStore');
const ctrl = require('../controllers/cardsController');
const admin = require('../controllers/cardsAdminController');
const extra = require('../controllers/cardsExtraController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const { requireSystemEnabled } = require('../middleware/systemToggle');
const { uploadImage } = require('../middleware/upload');

// Jogo de Cartas (substitui as Figurinhas). Painel da staff em /admin/*.
const router = express.Router();
router.use(requireAuth);
// Varredura de prazos de turno (precisa do io pra avisar os jogadores).
router.use((req, res, next) => { extra.startSweeper(req.app.get('io')); next(); });

const key = (req) => `u:${req.user?.id}`;
const actionLimiter = rateLimit({ windowMs: 10 * 1000, max: 60, keyGenerator: key, standardHeaders: true, legacyHeaders: false, store: createRateLimitStore('cards-action'), message: { error: 'Calma! Muitas ações seguidas.' } });
const buyLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyGenerator: key, standardHeaders: true, legacyHeaders: false, store: createRateLimitStore('cards-buy'), message: { error: 'Muitas compras seguidas. Espere um pouco.' } });
const socialLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, keyGenerator: key, standardHeaders: true, legacyHeaders: false, store: createRateLimitStore('cards-social'), message: { error: 'Muitos pedidos seguidos. Espere um pouco.' } });

// --- Staff (ADMIN) ---
const a = express.Router();
a.use(requirePlatformAdmin);
a.get('/cards', admin.listCards);
a.post('/cards', uploadImage.single('image'), admin.createCard);
a.patch('/cards/:id', uploadImage.single('image'), admin.updateCard);
a.delete('/cards/:id', admin.deleteCard);
a.get('/packs', admin.listPacks);
a.post('/packs', uploadImage.single('image'), admin.createPack);
a.patch('/packs/:id', uploadImage.single('image'), admin.updatePack);
a.delete('/packs/:id', admin.deletePack);
a.get('/packs/:id/simulate', admin.simulatePack);
a.get('/settings', admin.getSettings);
a.put('/settings', admin.updateSettings);
a.get('/players', admin.searchPlayers);
a.get('/players/:userId', admin.playerDetail);
a.post('/players/:userId/grant', admin.grantCard);
a.patch('/players/:userId', admin.updatePlayer);
a.get('/trades', admin.listTrades);
a.post('/trades/:id/cancel', admin.cancelTrade);
a.get('/matches', admin.listMatches);
a.post('/matches/:id/cancel', admin.cancelMatch);
a.get('/stats', extra.adminStats);
a.get('/export', extra.exportCards);
a.post('/import', extra.importCards);
a.get('/campaign', extra.adminCampaign);
a.post('/campaign', extra.createStage);
a.patch('/campaign/:id', extra.updateStage);
a.delete('/campaign/:id', extra.deleteStage);
a.get('/tournaments', extra.adminTournaments);
a.post('/tournaments', extra.createTournament);
a.patch('/tournaments/:id', extra.updateTournament);
a.post('/tournaments/:id/start', extra.startTournament);
a.post('/tournaments/:id/cancel', extra.cancelTournament);
router.use('/admin', a);

// --- Jogadores ---
router.get('/users/:userId/summary', ctrl.profileSummary); // vitrine do perfil (sempre visível)
router.use(requireSystemEnabled('cartas'));
router.get('/home', ctrl.home);
router.post('/starter', buyLimiter, ctrl.claimStarter);
router.get('/collection', ctrl.collection);
router.get('/users/:userId/collection', ctrl.userCollection);
router.post('/collection/:cardId/sell', buyLimiter, ctrl.sellCard);
router.post('/collection/:cardId/level-up', buyLimiter, ctrl.levelUp);
router.get('/packs', ctrl.listPacks);
router.post('/packs/:id/open', buyLimiter, ctrl.openPack);
router.get('/decks', ctrl.listDecks);
router.get('/decks/suggest', ctrl.suggestDeck);
router.post('/decks', ctrl.saveDeck);
router.put('/decks/:id', ctrl.saveDeck);
router.delete('/decks/:id', ctrl.deleteDeck);
router.post('/decks/:id/activate', ctrl.activateDeck);
router.get('/matches', ctrl.history);
router.post('/matches/pve', socialLimiter, ctrl.startPve);
router.post('/matches/challenge', socialLimiter, ctrl.challenge);
router.post('/matches/:id/accept', ctrl.acceptChallenge);
router.post('/matches/:id/decline', ctrl.declineChallenge);
router.get('/matches/:id', ctrl.getMatch);
router.post('/matches/:id/action', actionLimiter, ctrl.action);
router.get('/ranking', ctrl.ranking);
router.get('/campaign', extra.campaign);
router.post('/campaign/:id/start', socialLimiter, extra.startCampaign);
router.post('/queue', extra.joinQueue);
router.delete('/queue', extra.leaveQueue);
router.get('/live', extra.live);
router.get('/matches/:id/replay', extra.replay);
router.get('/matches/:id/watch', extra.watch);
router.get('/market', extra.market);
router.post('/market', buyLimiter, extra.createListing);
router.post('/market/:id/buy', buyLimiter, extra.buyListing);
router.post('/market/:id/cancel', extra.cancelListing);
router.get('/tournaments', extra.tournaments);
router.post('/tournaments/:id/join', extra.joinTournament);
router.post('/tournaments/:id/leave', extra.leaveTournament);
router.get('/trades', ctrl.listTrades);
router.post('/trades', socialLimiter, ctrl.createTrade);
router.post('/trades/:id/accept', ctrl.acceptTrade);
router.post('/trades/:id/decline', ctrl.declineTrade);
router.post('/trades/:id/cancel', ctrl.cancelTrade);

module.exports = router;
