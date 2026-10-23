const express = require('express');
const ctrl = require('../controllers/personalStickerController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

// Figurinhas pessoais (pacote de figurinhas personalizadas dos Assinantes).
const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.listMine);
router.post('/', uploadImage.single('sticker'), ctrl.createPersonalSticker);
router.delete('/:id', ctrl.deletePersonalSticker);

module.exports = router;
