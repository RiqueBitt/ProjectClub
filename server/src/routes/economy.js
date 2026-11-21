const express = require('express');
const ctrl = require('../controllers/economyController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const { requireSystemEnabled } = require('../middleware/systemToggle');

const router = express.Router();
router.use(requireAuth);

router.get('/', requireSystemEnabled('economia'), ctrl.getMyEconomy);
router.post('/daily', requireSystemEnabled('economia'), ctrl.claimDaily);
router.get('/chests', requireSystemEnabled('economia'), ctrl.listChests);

// Rank tem interruptor PRÓPRIO em Sistema (staff pode desligar o
// ranking sem desligar o resto da economia, ou vice-versa).
router.get('/rank', requireSystemEnabled('rank'), ctrl.getRank);
router.get('/leaderboard', requireSystemEnabled('rank'), ctrl.listLeaderboard);

// Administração dos baús diários (staff).
router.get('/admin/chests', requirePlatformAdmin, ctrl.adminListChests);
router.post('/admin/chests', requirePlatformAdmin, ctrl.adminCreateChest);
router.patch('/admin/chests/:id', requirePlatformAdmin, ctrl.adminUpdateChest);
router.delete('/admin/chests/:id', requirePlatformAdmin, ctrl.adminDeleteChest);

module.exports = router;
