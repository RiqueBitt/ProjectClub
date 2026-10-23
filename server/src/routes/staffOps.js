const express = require('express');
const { requireAuth } = require('../middleware/auth');
const ops = require('../services/staffOps');

// Painel de saúde da staff + backups (ver services/staffOps.js e
// services/dbBackup.js). Staff = ADMIN ou MODERATOR; disparar backup só ADMIN.
const router = express.Router();
router.use(requireAuth, ops.requireStaff);

router.get('/health', ops.getHealth);
router.get('/backups', ops.getBackups);
router.post('/backups/run', ops.requireAdmin, ops.postBackupRun);

module.exports = router;
