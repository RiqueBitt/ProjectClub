const express = require('express');
const ctrl = require('../controllers/conversationController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.listConversations);
router.post('/', ctrl.createConversation);
router.patch('/:id', ctrl.updateConversation);
router.post('/:id/icon', uploadImage.single('icon'), ctrl.uploadIcon);
router.post('/:id/members', ctrl.addMember);
router.delete('/:id/members/me', ctrl.leaveConversation);
router.post('/:id/read', ctrl.markRead);

module.exports = router;
