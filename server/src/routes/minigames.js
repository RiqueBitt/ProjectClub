const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRateLimitStore } = require('../config/rateLimitStore');
const ctrl = require('../controllers/minigamesController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
// Placar/partida: no máximo alguns envios por minuto por pessoa.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user.id}`,
  store: createRateLimitStore('minigames'),
});

router.get('/me', ctrl.myStats);
router.get('/:slug/leaderboard', ctrl.leaderboard);
router.post('/:slug/score', writeLimiter, ctrl.submitScore);
router.post('/:slug/play', writeLimiter, ctrl.registerPlay);

module.exports = router;
