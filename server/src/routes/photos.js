const express = require('express');
const ctrl = require('../controllers/photoController');
const { requireAuth } = require('../middleware/auth');
const { uploadPhotoOrVideo } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

router.post('/', uploadPhotoOrVideo.single('photo'), ctrl.upload);
router.get('/owner/:ownerId', ctrl.listByOwner);
router.delete('/comments/:commentId', ctrl.removeComment);
router.get('/:id', ctrl.getOne);
router.delete('/:id', ctrl.remove);
router.post('/:id/comments', ctrl.comment);

module.exports = router;
