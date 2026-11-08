const express = require('express');
const ctrl = require('../controllers/noticesController');
const { requireAuth } = require('../middleware/auth');

// Avisos pessoais salvos (lembrete de evento, presente da Loja...).
const router = express.Router();
router.use(requireAuth);
router.get('/', ctrl.listNotices);
router.post('/read-all', ctrl.readAll);
router.post('/:id/read', ctrl.readOne);
router.delete('/:id', ctrl.removeOne);

module.exports = router;
