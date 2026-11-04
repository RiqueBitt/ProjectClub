// Praça (Club Penguin). O jogo em si é servido pelo Waddle Forever embutido
// (services/waddle); aqui só o que a página React precisa pra abrir ele.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireFeature } = require('../config/features');
const waddle = require('../services/waddle');

const router = express.Router();
router.use(requireFeature('plaza'));

// Configuração da sessão: SWF de entrada, socketProxy do Ruffle e o pinguim da conta.
router.get('/config', requireAuth, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await waddle.getConfig(req.user));
  } catch (err) { next(err); }
});

// Pacote de instalação (jogo completo / evento) num fluxo único.
router.get('/pack/:kind(base|event)', requireAuth, async (req, res, next) => {
  try { await waddle.streamPack(req.params.kind, res); } catch (err) { next(err); }
});

// Chat de texto da Praça: fala como o pinguim (balão no jogo + painel da sala).
router.post('/say', requireAuth, async (req, res, next) => {
  try {
    const out = await waddle.say(req.user, req.body?.text);
    if (!out.ok) return res.status(out.status || 400).json({ error: out.error });
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

// Sem login: quantos pinguins estão na ilha (pra badge da barra lateral).
router.get('/status', async (req, res, next) => {
  try { res.json(await waddle.getStatus()); } catch (err) { next(err); }
});

module.exports = router;
