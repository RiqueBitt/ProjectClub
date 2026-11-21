const express = require('express');
const ctrl = require('../controllers/missionsController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const { requireSystemEnabled } = require('../middleware/systemToggle');

// Missões fazem parte da Economia: mesmo interruptor ("economia") em Admin → Sistemas.
const router = express.Router();
router.use(requireAuth);

router.get('/', requireSystemEnabled('economia'), ctrl.listMyMissions);
router.post('/track', requireSystemEnabled('economia'), ctrl.trackClientEvent);
router.get('/season', requireSystemEnabled('economia'), ctrl.getSeason);
router.post('/season/claim', requireSystemEnabled('economia'), ctrl.claimSeason);
router.post('/:id/claim', requireSystemEnabled('economia'), ctrl.claimMission);

router.get('/admin/all', requirePlatformAdmin, ctrl.adminListMissions);
router.post('/admin', requirePlatformAdmin, ctrl.adminCreateMission);
router.patch('/admin/:id', requirePlatformAdmin, ctrl.adminUpdateMission);
router.delete('/admin/:id', requirePlatformAdmin, ctrl.adminDeleteMission);

module.exports = router;
