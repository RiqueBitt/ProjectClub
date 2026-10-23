const express = require('express');
const ctrl = require('../controllers/donationGoalController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');

// Meta de doações: qualquer pessoa logada vê; só administradores mudam.
const router = express.Router();
router.use(requireAuth);
router.get('/', ctrl.getPublic);
router.put('/', requirePlatformAdmin, ctrl.update);
router.get('/entries', requirePlatformAdmin, ctrl.listEntries);
router.post('/entries', requirePlatformAdmin, ctrl.addEntry);
router.delete('/entries/:id', requirePlatformAdmin, ctrl.removeEntry);
module.exports = router;
