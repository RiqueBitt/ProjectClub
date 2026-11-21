const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { createRateLimitStore } = require('../config/rateLimitStore');
const gifCtrl = require('../controllers/gifController');

// Busca de GIFs via servidor — a chave da KLIPY nunca chega ao navegador.
// Limite por pessoa pra ninguém esgotar a cota da chave digitando sem parar
// (o cliente já faz debounce; isso é só o teto de segurança).
const router = express.Router();
const gifLimiter = rateLimit({
  windowMs: 60 * 1000, max: 90, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user.id}`,
  store: createRateLimitStore('gifs'),
});

router.use(requireAuth, gifLimiter);
router.get('/search', gifCtrl.searchGifs);
router.get('/categories', gifCtrl.gifCategories);

module.exports = router;
