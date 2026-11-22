const express = require('express');
const ctrl = require('../controllers/instancesController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');

// Painel da Equipe → Instâncias (só administradores da plataforma).
const router = express.Router();
router.use(requireAuth, requirePlatformAdmin);
router.get('/', ctrl.adminList);
router.post('/', ctrl.adminCreate);
router.patch('/:id', ctrl.adminUpdate);
router.delete('/:id', ctrl.adminDelete);
router.post('/:id/members', ctrl.adminAddMember);
router.delete('/:id/members/:userId', ctrl.adminRemoveMember);
module.exports = router;
