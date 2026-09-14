const express = require('express');
const ctrl = require('../controllers/gamebananaController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/steam-match', ctrl.matchGameBananaGames);
router.get('/games/:gameBananaGameId/browse', ctrl.browse);
router.get('/mods/:modId', ctrl.getMod);

module.exports = router;
