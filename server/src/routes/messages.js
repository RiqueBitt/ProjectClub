const express = require('express');
const ctrl = require('../controllers/messageController');
const reportCtrl = require('../controllers/reportController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage, uploadMessageAttachments, MESSAGE_MAX_FILES } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.listMessages);
router.get('/search', ctrl.searchMessages);
router.get('/pinned', ctrl.listPinned);
// precheckCreateMessage roda ANTES do multer: permissão/spam são checados
// antes de qualquer anexo ser recebido e enviado pro storage.
router.post('/', ctrl.precheckCreateMessage, uploadMessageAttachments.array('attachments', MESSAGE_MAX_FILES), ctrl.createMessage);
router.post('/report', reportCtrl.createReport);
router.post('/:id/icon', uploadImage.single('icon'), ctrl.setPostIcon);
router.get('/:id/edits', ctrl.listEdits);
router.post('/:id/forward', ctrl.forwardMessage);
router.patch('/:id', ctrl.editMessage);
router.delete('/:id', ctrl.deleteMessage);
router.post('/:id/pin', ctrl.togglePin);
router.post('/:id/react', ctrl.react);
router.post('/:id/archive', ctrl.toggleArchiveTopic);

module.exports = router;
