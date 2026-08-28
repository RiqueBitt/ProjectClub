const express = require('express');
const ctrl = require('../controllers/messageController');
const { requireAuth } = require('../middleware/auth');
const { upload, uploadImage } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.listMessages);
router.get('/search', ctrl.searchMessages);
router.post('/', upload.array('attachments', 10), ctrl.createMessage);
router.post('/:id/icon', uploadImage.single('icon'), ctrl.setPostIcon);
router.patch('/:id', ctrl.editMessage);
router.delete('/:id', ctrl.deleteMessage);
router.post('/:id/pin', ctrl.togglePin);
router.post('/:id/react', ctrl.react);
router.post('/:id/archive', ctrl.toggleArchiveTopic);

module.exports = router;
