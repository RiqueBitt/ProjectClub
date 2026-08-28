const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRateLimitStore } = require('../config/rateLimitStore');
const ctrl = require('../controllers/applicationsController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');

const router = express.Router();
const submitLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, store: createRateLimitStore('applications') });

router.post('/', submitLimiter, ctrl.submitApplication);

router.use('/admin', requireAuth, requirePlatformAdmin);
router.get('/admin/all', ctrl.adminListApplications);
router.post('/admin/:id/approve', ctrl.approveApplication);
router.post('/admin/:id/reject', ctrl.rejectApplication);

module.exports = router;
