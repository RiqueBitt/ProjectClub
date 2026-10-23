const express = require('express');
const ctrl = require('../controllers/userController');
const settingsCtrl = require('../controllers/settingsController');
const emojiCtrl = require('../controllers/emojiController');
const gifCtrl = require('../controllers/gifController');
const gamesCtrl = require('../controllers/gamesController');
const shortcutsCtrl = require('../controllers/shortcutsController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

const rateLimit = require('express-rate-limit');
const { createRateLimitStore } = require('../config/rateLimitStore');
const reportCtrl = require('../controllers/reportController');

const router = express.Router();

// Denúncias de perfil — limite por IP pra ninguém inundar a fila da staff.
const reportLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, store: createRateLimitStore('profile-report') });

router.use(requireAuth);
router.post('/:id/report', reportLimiter, reportCtrl.createProfileReport);
router.patch('/me', ctrl.updateProfile);
router.patch('/me/username', ctrl.updateUsername);
router.post('/me/avatar', uploadImage.single('avatar'), ctrl.uploadAvatar);
router.post('/me/banner', uploadImage.single('banner'), ctrl.uploadBanner);
router.post('/me/mini-banner', uploadImage.single('banner'), ctrl.uploadMiniProfileBanner);
router.post('/me/id-card', uploadImage.single('idCard'), ctrl.uploadIdCard);

// Item pedido: pingentes — imagem própria enviada pelo usuário (além
// do catálogo curado pela staff, ver pendantController.js).
const pendantCtrl = require('../controllers/pendantController');
router.post('/me/pendant/upload', uploadImage.single('pendant'), pendantCtrl.uploadMyCustomPendant);
router.delete('/me/pendant/upload', pendantCtrl.removeMyCustomPendant);
router.delete('/me/id-card', ctrl.removeIdCard);
router.patch('/me/status', ctrl.setStatus);
router.patch('/me/custom-status', ctrl.setCustomStatus);
router.patch('/me/tag', ctrl.setActiveTag);
router.patch('/me/theme', ctrl.setPreferredTheme);
router.patch('/me/layout-style', ctrl.setLayoutStyle);
router.patch('/me/chat-zoom', ctrl.setChatZoom);
router.patch('/me/interface-zoom', ctrl.setInterfaceZoom);
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
// Item pedido: "Atalhos personalizados... verificar se já existe
// outro comando usando a combinação"
router.get('/me/shortcuts', shortcutsCtrl.listMyShortcuts);

// Item pedido: pingentes — catálogo público + escolha da própria conta.
router.put('/me/shortcuts', shortcutsCtrl.setShortcut);
router.delete('/me/shortcuts/:id', shortcutsCtrl.deleteShortcut);
// Extras do perfil (Mural, Lista de desejos, Atividade, insígnias, nota).
const extrasCtrl = require('../controllers/profileExtrasController');
router.put('/me/widgets', extrasCtrl.setWidgets);
router.get('/me/wishlist', extrasCtrl.myWishlist);
router.post('/me/wishlist', extrasCtrl.toggleWishlist);
const msgExtra = require('../controllers/messageExtrasController');
router.get('/me/ignored', msgExtra.listIgnored);
router.get('/search', ctrl.searchUsers);
router.get('/:id', ctrl.getUser);
router.get('/:id/extras', extrasCtrl.getExtras);
router.put('/:id/note', extrasCtrl.setNote);
router.post('/:id/ignore', msgExtra.toggleIgnore);
// Cabeçalho do perfil completo numa requisição só (ver profileSummaryController).
router.get('/:id/summary', require('../controllers/profileSummaryController').getProfileSummary);
router.post('/:id/vote', ctrl.voteProfile);

module.exports = router;
