const express = require('express');
const ctrl = require('../controllers/modController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Todas as rotas exigem login (mesma conta do Project Club, sem sistema
// de autenticação próprio — item pedido 20/31) mas nenhuma exige staff;
// qualquer pessoa logada pode navegar/pesquisar/favoritar/comentar.
router.use(requireAuth);

router.post('/steam-match', ctrl.matchSteamGames);

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
