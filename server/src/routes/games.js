const express = require('express');
const ctrl = require('../controllers/gameLibraryController');
const { requireAuth } = require('../middleware/auth');

// Biblioteca de jogos (tempo de jogo, estilo Steam).
const router = express.Router();
router.use(requireAuth);

router.get('/library/:userId', ctrl.getLibrary);

module.exports = router;
