const express = require('express');
const ctrl = require('../controllers/activitiesController');
const { requireAuth } = require('../middleware/auth');

// Atividades do chat: dados, cartões de YouTube e Música.
const router = express.Router();
router.use(requireAuth);
router.post('/dice', ctrl.rollDice);
router.get('/dice/:id', ctrl.getDice);
router.get('/youtube/:id', ctrl.youtubeInfo);
module.exports = router;
