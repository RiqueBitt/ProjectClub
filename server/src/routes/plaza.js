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

// Cópia do pinguim pro modo offline do app de computador (itens por id,
// saldo, iglu, puffles…). O app salva isto em arquivo e usa quando está sem
// internet ou sem o servidor. Só saída: nunca volta pro banco.
router.get('/offline-snapshot', requireAuth, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await waddle.getOfflineSnapshot(req.user));
  } catch (err) { next(err); }
});

// Pacote de instalação (jogo completo / evento) num fluxo único.
router.get('/pack/:kind(base|event)', requireAuth, async (req, res, next) => {
  try { await waddle.streamPack(req.params.kind, res); } catch (err) { next(err); }
});

// Centro de Download do jogo: pacotes por categoria.
router.get('/packs', requireAuth, async (req, res, next) => {
  try { res.set('Cache-Control', 'no-store'); res.json(await waddle.listPacks()); } catch (err) { next(err); }
});
router.get('/packs/:id/urls', requireAuth, async (req, res, next) => {
  try {
    const urls = await waddle.packUrls(String(req.params.id));
    if (!urls) return res.status(404).json({ error: 'Pacote não encontrado.' });
    return res.json({ urls });
  } catch (err) { return next(err); }
});
router.get('/packs/:id/stream', requireAuth, async (req, res, next) => {
  try { await waddle.streamNamedPack(String(req.params.id), req.query.from, res); } catch (err) { next(err); }
});

// Sem login: quantos pinguins estão na ilha (pra badge da barra lateral).
router.get('/status', async (req, res, next) => {
  try { res.json(await waddle.getStatus()); } catch (err) { next(err); }
});

module.exports = router;
