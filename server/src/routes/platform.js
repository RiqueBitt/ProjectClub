const express = require('express');
const ctrl = require('../controllers/platformController');
const announcementCtrl = require('../controllers/announcementController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/status', ctrl.getStatus);
router.get('/announcements/active', requireAuth, announcementCtrl.getActiveAnnouncement);
router.post('/announcements/:id/dismiss', requireAuth, announcementCtrl.dismissAnnouncement);

module.exports = router;
