const express = require('express');
const ctrl = require('../controllers/friendController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.listFriends);
router.post('/request', ctrl.sendRequest);
router.post('/:id/respond', ctrl.respondRequest);
router.delete('/:id', ctrl.removeFriend);
router.post('/block', ctrl.blockUser);

module.exports = router;
