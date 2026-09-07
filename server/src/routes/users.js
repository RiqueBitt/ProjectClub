const express = require('express');
const ctrl = require('../controllers/userController');
const emojiCtrl = require('../controllers/emojiController');
const gifCtrl = require('../controllers/gifController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

const router = express.Router();

router.use(requireAuth);
router.patch('/me', ctrl.updateProfile);
router.patch('/me/username', ctrl.updateUsername);
router.post('/me/avatar', uploadImage.single('avatar'), ctrl.uploadAvatar);
router.post('/me/banner', uploadImage.single('banner'), ctrl.uploadBanner);
router.post('/me/mini-banner', uploadImage.single('banner'), ctrl.uploadMiniProfileBanner);
router.post('/me/id-card', uploadImage.single('idCard'), ctrl.uploadIdCard);
router.delete('/me/id-card', ctrl.removeIdCard);
router.patch('/me/status', ctrl.setStatus);
router.patch('/me/custom-status', ctrl.setCustomStatus);
router.patch('/me/tag', ctrl.setActiveTag);
router.patch('/me/theme', ctrl.setPreferredTheme);
router.patch('/me/chat-zoom', ctrl.setChatZoom);
router.patch('/me/emoji-style', ctrl.setEmojiStyle);
router.patch('/me/displayed-achievements', ctrl.setDisplayedAchievements);
router.get('/me/usable-emojis', emojiCtrl.listUsableEmojis);
router.get('/me/favorite-gifs', gifCtrl.listFavoriteGifs);
router.post('/me/favorite-gifs', gifCtrl.addFavoriteGif);
router.delete('/me/favorite-gifs/:gifId', gifCtrl.removeFavoriteGif);
router.get('/search', ctrl.searchUsers);
router.get('/:id', ctrl.getUser);
router.post('/:id/vote', ctrl.voteProfile);

module.exports = router;
