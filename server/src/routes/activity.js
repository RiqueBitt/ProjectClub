const express = require('express');
const ctrl = require('../controllers/activityController');
const { requireAuth } = require('../middleware/auth');

// Página "Atividade" (linha do tempo dos amigos) + "Parabéns"/"Comemorar".
const router = express.Router();
router.use(requireAuth);

router.get('/feed', ctrl.getFeed);
router.post('/cheer', ctrl.toggleCheer);
router.post('/celebrate', ctrl.celebrate);

module.exports = router;
