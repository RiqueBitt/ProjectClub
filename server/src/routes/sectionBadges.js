const express = require('express');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../services/sectionBadges').routes();

// Bolinhas "novo" de Anúncios, Eventos e Coleções da Loja.
const router = express.Router();
router.use(requireAuth);
router.get('/', ctrl.list);
router.post('/:section/seen', ctrl.seen);
module.exports = router;
