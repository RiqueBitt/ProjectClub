const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRateLimitStore } = require('../config/rateLimitStore');
const ctrl = require('../controllers/modController');
const ratingCtrl = require('../controllers/modRatingController');
const unifiedCtrl = require('../controllers/unifiedModsController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Todas as rotas exigem login (mesma conta do Project Club, sem sistema
// de autenticação próprio — item pedido 20/31) mas nenhuma exige staff;
// qualquer pessoa logada pode navegar/pesquisar/favoritar/comentar.
router.use(requireAuth);

// Avaliações (Fase 7): limite por pessoa pra ninguém ficar trocando nota
// em loop (cada troca recalcula a média de todo mundo que está vendo).
const ratingLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user.id}`,
  store: createRateLimitStore('mod-rating'),
  message: { error: 'Muitas avaliações seguidas. Espere um pouco.' },
});

router.post('/steam-match', ctrl.matchSteamGames);

// Busca unificada (todas as fontes juntas, com compatibilidade) e
// identificação de mods detectados no disco — ver unifiedModsService.js.
router.get('/unified/:steamAppId', unifiedCtrl.search);
router.post('/identify', unifiedCtrl.identify);
// Tela inicial de Mods ("Em alta") e checagem de atualizações em lote.
router.get('/trending', unifiedCtrl.trending);
router.post('/updates', unifiedCtrl.checkUpdates);

router.get('/games/:modioGameId', ctrl.getGame);
router.get('/games/:modioGameId/tags', ctrl.getGameTags);
router.get('/games/:modioGameId/mods', ctrl.listMods);
router.get('/games/:modioGameId/mods/:modioModId', ctrl.getMod);
router.post('/games/:modioGameId/mods/:modioModId/download', ctrl.getModDownload);

router.post('/games/:modioGameId/mods/:modioModId/favorite', ctrl.toggleFavorite);
router.post('/games/:modioGameId/mods/:modioModId/up', ctrl.toggleUp);
router.get('/mods/:modioModId/comments', ctrl.listComments);
router.post('/games/:modioGameId/mods/:modioModId/comments', ctrl.addComment);
router.delete('/comments/:commentId', ctrl.deleteComment);
router.post('/mods/:modioModId/report', ctrl.reportMod);

// Avaliações: 1–5 estrelas + texto curto opcional (uma por pessoa por mod).
router.get('/mods/:modioModId/ratings', ratingCtrl.getRatings);
router.put('/games/:modioGameId/mods/:modioModId/rating', ratingLimiter, ratingCtrl.putRating);
router.delete('/mods/:modioModId/rating', ratingLimiter, ratingCtrl.deleteMyRating);
router.delete('/ratings/:ratingId', ratingLimiter, ratingCtrl.deleteRating);

// Perfis (item pedido 15)
router.get('/games/:modioGameId/profiles', ctrl.listProfiles);
router.post('/games/:modioGameId/profiles', ctrl.createProfile);
router.delete('/profiles/:profileId', ctrl.deleteProfile);
router.post('/profiles/:profileId/items', ctrl.upsertProfileItem);
router.delete('/profiles/:profileId/items/:itemId', ctrl.removeProfileItem);

// Coleções (item pedido 19)
router.get('/games/:modioGameId/collections', ctrl.listCollections);
router.post('/games/:modioGameId/collections', ctrl.createCollection);
router.patch('/collections/:collectionId', ctrl.updateCollection);
router.delete('/collections/:collectionId', ctrl.deleteCollection);
router.post('/collections/:collectionId/items', ctrl.addCollectionItem);
router.delete('/collections/:collectionId/items/:modioModId', ctrl.removeCollectionItem);

module.exports = router;
