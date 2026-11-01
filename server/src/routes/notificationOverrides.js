const express = require('express');
const ctrl = require('../controllers/notificationOverrideController');
const { requireAuth } = require('../middleware/auth');

// Notificações por canal/categoria (silenciar + "Todas / Só @menções / Nada").
const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.put('/:type/:id', ctrl.update);

module.exports = router;
