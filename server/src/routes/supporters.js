const express = require('express');
const ctrl = require('../controllers/supportersController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');

// Gerenciamento de Apoio — só administradores da plataforma (checado no
// servidor; esconder botão no cliente não protege nada).
const router = express.Router();
router.use(requireAuth);
router.get('/admin/users', requirePlatformAdmin, ctrl.adminSearch);
router.get('/admin/history', requirePlatformAdmin, ctrl.adminHistory);
router.post('/admin/:userId', requirePlatformAdmin, ctrl.adminSetTier);
module.exports = router;
