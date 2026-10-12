// Navegador do Project Club na versão site: conferir se uma página pode ser
// aberta dentro do app e sugestões da barra de endereço.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const env = require('../config/env');
const { createRateLimitStore } = require('../config/rateLimitStore');
const bc = require('../services/browserCheck');

const router = express.Router();
router.use(requireAuth);
router.use(rateLimit({
  windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user.id}`, store: createRateLimitStore('browser'),
  message: { error: 'Muitas páginas abertas em pouco tempo. Espere um pouquinho.' },
}));

const appOrigin = (req) => {
  try {
    const o = new URL(String(req.query.origin || ''));
    if (o.protocol === 'https:' || o.protocol === 'http:') return o.origin;
  } catch { /* usa o padrão */ }
  return String(env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
};

router.get('/check', async (req, res) => {
  const result = await bc.check(String(req.query.url || ''), appOrigin(req));
  res.set('Cache-Control', 'private, max-age=600');
  res.json(result);
});

router.get('/suggest', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=600');
  res.json({ list: await bc.suggest(req.query.q) });
});

module.exports = router;
