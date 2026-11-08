const express = require('express');
const ctrl = require('../controllers/voiceController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');

const router = express.Router();
router.use(requireAuth);

// Entrar numa chamada: confere o acesso à sala e devolve as credenciais do
// servidor de voz próprio (provider "projectclub"). Qualquer usuário
// autenticado com acesso àquela sala.
router.get('/join', ctrl.getJoin);
// Telemetria: o cliente avisa que não conseguiu conectar no servidor de voz
// (só vai pro log).
router.post('/report', ctrl.postReport);

// Painel da staff "Servidor de voz" — só administradores da plataforma.
// Chaves do servidor próprio (URL/segredo do media-server, TURN); segredos
// nunca voltam pro navegador.
router.get('/server', requirePlatformAdmin, ctrl.getServer);
router.post('/server/config', requirePlatformAdmin, ctrl.postServerConfig);

module.exports = router;
