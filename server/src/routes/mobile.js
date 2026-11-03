const express = require('express');
const rateLimit = require('express-rate-limit');
const mobileUpdate = require('../services/mobileUpdate');
const { requireAuth } = require('../middleware/auth');
const { createRateLimitStore } = require('../config/rateLimitStore');

// Público (sem login): o app pergunta antes mesmo de a pessoa entrar.
// Só devolve informação pública (as mesmas das releases do GitHub).
const router = express.Router();

// GET /api/mobile/update?native=v1.2.3&current=<versão do conteúdo>
router.get('/update', async (req, res) => {
  const native = String(req.query.native || '').slice(0, 40);
  const current = String(req.query.current || '').slice(0, 80);
  let manifest;
  try {
    manifest = await mobileUpdate.getManifest();
  } catch {
    // GitHub fora do ar: ainda responde a versão do conteúdo, sem exigir .apk.
    manifest = { webVersion: mobileUpdate.readWebVersion() };
  }
  res.set('Cache-Control', 'no-cache');
  res.json(mobileUpdate.decideUpdate({ native, current, manifest }));
});

// GET /api/mobile/widget-summary — widget "quem está online" da tela
// inicial do Android. COM login (só esta rota): devolve só contagens e
// nomes de exibição de amigos — ver services/widgetSummary.js. O widget
// atualiza a cada 30 min + quando o app abre; o limite é só um teto.
const widgetLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user.id}`,
  store: createRateLimitStore('mobile-widget'),
  message: { error: 'Muitas atualizações seguidas do widget.' },
});
router.get('/widget-summary', requireAuth, widgetLimiter, async (req, res, next) => {
  try {
    const { buildWidgetSummary } = require('../services/widgetSummary');
    res.set('Cache-Control', 'private, no-store');
    res.json(await buildWidgetSummary(req.user.id));
  } catch (err) { next(err); }
});

module.exports = router;
