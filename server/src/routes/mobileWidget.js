const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { createRateLimitStore } = require('../config/rateLimitStore');
const { buildWidgetSummary } = require('../services/widgetSummary');

// GET /api/mobile/widget-summary — widget "quem está online" da tela
// inicial do Android (Fase 7). COM login: devolve só contagens e nomes de
// exibição de amigos — ver services/widgetSummary.js. Arquivo separado de
// routes/mobile.js de propósito: aquele é público (atualização do app) e
// continua sem depender de login/Redis.
const router = express.Router();

// O widget atualiza a cada 30 min + quando o app abre; o limite é só um teto.
const widgetLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user.id}`,
  store: createRateLimitStore('mobile-widget'),
  message: { error: 'Muitas atualizações seguidas do widget.' },
});

router.get('/widget-summary', requireAuth, widgetLimiter, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await buildWidgetSummary(req.user.id));
  } catch (err) { next(err); }
});

module.exports = router;
