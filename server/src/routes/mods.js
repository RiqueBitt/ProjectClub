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

module.exports = router;
