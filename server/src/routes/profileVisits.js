const express = require('express');
const ctrl = require('../controllers/profileVisitController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/:targetId', ctrl.registerVisit);
router.get('/:targetId', ctrl.listVisitors);

module.exports = router;
