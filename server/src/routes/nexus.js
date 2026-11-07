const express = require('express');
const ctrl = require('../controllers/nexusController');
const { requireAuth } = require('../middleware/auth');

// Nexus Mods (a fonte do Vortex) — ver services/nexusService.js.
const router = express.Router();
router.use(requireAuth);

router.post('/steam-match', ctrl.matchSteamGames);
router.get('/games/:domain/mods/:modId', ctrl.getMod);
router.get('/games/:domain/mods/:modId/files/:fileId/download', ctrl.getDownload);

module.exports = router;
