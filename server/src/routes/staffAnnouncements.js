const express = require('express');
const ctrl = require('../controllers/staffAnnouncementsController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);
router.get('/', ctrl.list);
router.post('/', uploadImage.single('banner'), ctrl.create);
router.patch('/:id', uploadImage.single('banner'), ctrl.update);
router.delete('/:id', ctrl.remove);
module.exports = router;
