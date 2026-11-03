const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');

// Pingu pra qualquer membro: resumo do que perdeu, tradução e placar do quiz.
// Resumo/tradução são SÓ pra quem pediu: a rota responde 202 na hora e o
// resultado chega pelo socket pessoal ('pingu:ephemeral', com o requestId) —
// a IA é lenta e o pedido não pode ficar preso esperando.
const router = express.Router();
router.use(requireAuth);

const bot = () => require('../services/pinguBot');
const fail = (res, err) => res.status(err?.status && err.status < 600 ? err.status : 500).json({ error: err?.message || 'Erro inesperado.' });

// Desligado pela equipe ou IA fora do ar: responde na hora (sem 202).
function precheck(flag, offMsg) {
  const cfg = require('../services/pingu/config').getConfig();
  if (!cfg[flag]) return { status: 400, error: offMsg };
  if (!bot().isOnline()) return { status: 503, error: bot().OFFLINE_TEXT };
  return null;
}

router.get('/status', (req, res) => {
  const cfg = require('../services/pingu/config').getConfig();
  res.json({ online: bot().isOnline(), summaryEnabled: cfg.summaryEnabled, translateEnabled: cfg.translateEnabled });
});

router.post('/summary', async (req, res) => {
  try {
    const channelId = String(req.body?.channelId || '');
    const { assertAccess } = require('../controllers/messageController');
    const access = await assertAccess(req, { channelId });
    const pre = precheck('summaryEnabled', 'O resumo do Pingu está desligado pela equipe.');
    if (pre) return res.status(pre.status).json({ error: pre.error });
    const requestId = crypto.randomUUID();
    res.status(202).json({ pending: true, requestId });
    const r = await require('../services/pingu/summary').requestSummary({
      userId: req.user.id, channelId, channelName: access?.channel?.name, since: req.body?.since || null,
    });
    bot().sendEphemeral(req.user.id, { kind: 'summary', requestId, channelId, ...r });
  } catch (err) {
    if (!res.headersSent) fail(res, err);
  }
});

router.post('/translate', async (req, res) => {
  try {
    const t = require('../services/pingu/translate');
    const message = await t.loadMessage(req.body?.messageId);
    const { assertAccess } = require('../controllers/messageController');
    await assertAccess(req, { channelId: message.channelId });
    const target = t.normalizeLang(req.body?.target) || t.pickTarget(message.content, req.body?.lang);
    const hit = t.cached(message, target);
    if (hit) return res.json({ text: hit, target, messageId: message.id, cached: true });
    const pre = precheck('translateEnabled', 'A tradução do Pingu está desligada pela equipe.');
    if (pre) return res.status(pre.status).json({ error: pre.error });
    const requestId = crypto.randomUUID();
    res.status(202).json({ pending: true, requestId, target });
    const r = await t.translate({ userId: req.user.id, message, target });
    bot().sendEphemeral(req.user.id, { kind: 'translate', requestId, messageId: message.id, ...r });
  } catch (err) {
    if (!res.headersSent) fail(res, err);
  }
});

router.get('/quiz/scoreboard', async (req, res) => {
  try { res.json({ scoreboard: await require('../services/pingu/quiz').scoreboard(10) }); } catch (err) { fail(res, err); }
});

module.exports = router;
