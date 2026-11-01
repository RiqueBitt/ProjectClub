const express = require('express');
const ctrl = require('../controllers/rankingController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/mine', ctrl.myVotes);
router.get('/top-among-friends', ctrl.topAmongFriends);
router.post('/:targetId', ctrl.vote);

module.exports = router;
