const express = require('express');
const ctrl = require('../controllers/voiceController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Qual provedor de mídia usar agora + quanto do mês já foi usado (Agora).
router.get('/provider', ctrl.getProvider);
// Fluxo de entrada: checa acesso e devolve o provedor + credenciais dele.
router.get('/join', ctrl.getJoin);

module.exports = router;
