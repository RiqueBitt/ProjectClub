const express = require('express');
const ctrl = require('../controllers/voiceController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');

const router = express.Router();
router.use(requireAuth);

// Entrar numa chamada: decide o provedor ativo da cadeia e devolve as
// credenciais dele (mesmas checagens de acesso de sempre). Qualquer
// usuário autenticado com acesso àquela sala.
router.get('/join', ctrl.getJoin);

// Painel da staff — só administradores da plataforma.
router.get('/provider', requirePlatformAdmin, ctrl.getProviderStatus);
router.post('/override', requirePlatformAdmin, ctrl.postOverride);
router.post('/provider/:id/toggle', requirePlatformAdmin, ctrl.postToggle);

module.exports = router;
