const express = require('express');
const ctrl = require('../controllers/activityController');
const { requireAuth } = require('../middleware/auth');

// Página "Atividade" (linha do tempo dos amigos) + "Parabéns"/"Comemorar".
const router = express.Router();
router.use(requireAuth);

router.get('/feed', ctrl.getFeed);
router.post('/cheer', ctrl.toggleCheer);
router.post('/celebrate', ctrl.celebrate);

// Rich presence pros apps do ecossistema (ver services/presenceApi.js).
const presence = require('../services/presenceApi');
router.post('/presence', async (req, res, next) => {
  try { res.json(await presence.setPresence(req.app.get('io'), req.user.id, req.body || {})); } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message }); next(err);
  }
});
router.delete('/presence', async (req, res, next) => {
  try { res.json(await presence.clearPresence(req.app.get('io'), req.user.id)); } catch (err) { next(err); }
});

module.exports = router;
