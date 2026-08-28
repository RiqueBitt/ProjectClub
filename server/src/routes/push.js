const express = require('express');
const ctrl = require('../controllers/pushController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/register', ctrl.registerToken);
router.post('/unregister', ctrl.unregisterToken);

module.exports = router;
