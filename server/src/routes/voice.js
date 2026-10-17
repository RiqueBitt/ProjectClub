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
// O cliente avisa que um provedor não conectou (alimenta o disjuntor de
// saúde da cadeia — ver services/voiceHealth.js).
router.post('/report', ctrl.postReport);

// Painel da staff — só administradores da plataforma.
router.get('/provider', requirePlatformAdmin, ctrl.getProviderStatus);
router.post('/override', requirePlatformAdmin, ctrl.postOverride);
router.post('/provider/:id/toggle', requirePlatformAdmin, ctrl.postToggle);
router.post('/provider/:id/usage', requirePlatformAdmin, ctrl.postUsage);
router.post('/provider/:id/health/reset', requirePlatformAdmin, ctrl.postHealthReset);
// Chaves de cada provedor, editáveis pelo painel (segredos nunca voltam).
router.get('/provider/:id/config', requirePlatformAdmin, ctrl.getConfig);
router.post('/provider/:id/config', requirePlatformAdmin, ctrl.postConfig);

module.exports = router;
