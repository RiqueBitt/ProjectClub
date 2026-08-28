const express = require('express');
const ctrl = require('../controllers/pollController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/', ctrl.createPoll);
router.post('/:id/vote', ctrl.votePoll);

module.exports = router;
