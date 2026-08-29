const express = require('express');
const ctrl = require('../controllers/agoraController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/token', ctrl.getToken);

module.exports = router;
