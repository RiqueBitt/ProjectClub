const express = require('express');
const ctrl = require('../controllers/userController');
const settingsCtrl = require('../controllers/settingsController');
const emojiCtrl = require('../controllers/emojiController');
const gifCtrl = require('../controllers/gifController');
const gamesCtrl = require('../controllers/gamesController');
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
// Item pedido: "GET /api/users/me/settings, PATCH /api/users/me/settings,
// POST /api/users/me/settings/reset" — mesmo padrão já usado acima
// pras outras preferências pessoais (tema, zoom do chat).
router.get('/me/settings', settingsCtrl.getSettings);
router.patch('/me/settings', settingsCtrl.updateSettings);
router.post('/me/settings/reset', settingsCtrl.resetSettings);
router.patch('/me/emoji-style', ctrl.setEmojiStyle);
router.patch('/me/displayed-achievements', ctrl.setDisplayedAchievements);
router.get('/me/usable-emojis', emojiCtrl.listUsableEmojis);
router.get('/me/favorite-gifs', gifCtrl.listFavoriteGifs);
router.post('/me/favorite-gifs', gifCtrl.addFavoriteGif);
router.delete('/me/favorite-gifs/:gifId', gifCtrl.removeFavoriteGif);
// Item pedido: "Jogos adicionados... Minecraft [Remover], Palworld
// [Remover]" — mesmo padrão de favorite-gifs acima (lista/adiciona/
// remove, escopado ao próprio usuário).
router.get('/me/games', gamesCtrl.listMyGames);
router.post('/me/games', gamesCtrl.addGame);
router.delete('/me/games/:id', gamesCtrl.removeGame);
router.get('/search', ctrl.searchUsers);
router.get('/:id', ctrl.getUser);
router.post('/:id/vote', ctrl.voteProfile);

module.exports = router;
