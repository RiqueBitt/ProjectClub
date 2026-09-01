const express = require('express');
const ctrl = require('../controllers/birthdayController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/upcoming', ctrl.upcomingAmongFriends);

module.exports = router;
