const express = require('express');
const communityCtrl = require('../controllers/communityController');
const categoryCtrl = require('../controllers/categoryController');
const channelCtrl = require('../controllers/channelController');
const roleCtrl = require('../controllers/roleController');
const modCtrl = require('../controllers/moderationController');
const automodCtrl = require('../controllers/automodController');
const emojiCtrl = require('../controllers/emojiController');
const stickerCtrl = require('../controllers/serverStickerController');
const collectionCtrl = require('../controllers/assetCollectionController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

router.get('/', communityCtrl.getCommunity);

// --- Emojis da comunidade ---
router.get('/emojis', emojiCtrl.listEmojis);
router.post('/emojis', uploadImage.single('emoji'), emojiCtrl.createEmoji);
router.patch('/emojis/:id', emojiCtrl.updateEmoji);
router.delete('/emojis/:id', emojiCtrl.deleteEmoji);
router.get('/emojis/usable', emojiCtrl.listUsableEmojis);
router.get('/stickers', stickerCtrl.listStickers);
router.post('/stickers', uploadImage.single('sticker'), stickerCtrl.createSticker);
router.patch('/stickers/:id', stickerCtrl.updateSticker);
router.delete('/stickers/:id', stickerCtrl.deleteSticker);
router.get('/collections/:kind', collectionCtrl.listCollections);
router.post('/collections/:kind', collectionCtrl.createCollection);
router.patch('/collections/:id', collectionCtrl.updateCollection);
router.delete('/collections/:id', collectionCtrl.deleteCollection);

// --- Categorias ---
router.post('/categories', categoryCtrl.createCategory);
router.patch('/categories/:id', categoryCtrl.updateCategory);
router.post('/categories/reorder', categoryCtrl.reorderCategories);
router.delete('/categories/:id', categoryCtrl.deleteCategory);
router.get('/categories/:id/overwrites', categoryCtrl.listCategoryOverwrites);
router.post('/categories/:id/overwrites', categoryCtrl.setCategoryOverwrite);
router.delete('/categories/:id/overwrites/:overwriteId', categoryCtrl.deleteCategoryOverwrite);

// --- Canais ---
router.post('/channels', channelCtrl.createChannel);
router.patch('/channels/:id', channelCtrl.updateChannel);
router.post('/channels/reorder', channelCtrl.reorderChannels);
router.delete('/channels/:id', channelCtrl.deleteChannel);
router.post('/channels/:id/read', channelCtrl.markRead);
router.get('/channels/:id/overwrites', channelCtrl.listChannelOverwrites);
router.post('/channels/:id/overwrites', channelCtrl.setChannelOverwrite);
router.delete('/channels/:id/overwrites/:overwriteId', channelCtrl.deleteChannelOverwrite);

// --- Cargos ---
router.get('/roles', roleCtrl.listRoles);
router.post('/roles', roleCtrl.createRole);
router.patch('/roles/:id', roleCtrl.updateRole);
router.delete('/roles/:id', roleCtrl.deleteRole);
router.post('/roles/reorder', roleCtrl.reorderRoles);
router.post('/roles/:id/icon', uploadImage.single('icon'), roleCtrl.uploadIcon);
router.post('/members/:userId/roles/:roleId', roleCtrl.assignRole);
router.delete('/members/:userId/roles/:roleId', roleCtrl.unassignRole);

// --- Moderação ---
router.get('/bans', modCtrl.listBans);
router.post('/bans/:userId', modCtrl.banMember);
router.delete('/bans/:userId', modCtrl.unbanMember);
router.post('/members/:userId/timeout', modCtrl.timeoutMember);
router.delete('/members/:userId/timeout', modCtrl.removeTimeout);
router.get('/warnings', modCtrl.listWarnings);
router.get('/members/:userId/warnings', modCtrl.listWarnings);
router.post('/members/:userId/warnings', modCtrl.warnMember);
router.delete('/warnings/:warningId', modCtrl.deleteWarning);
router.get('/audit-log', modCtrl.listAuditLog);

// --- AutoMod ---
router.get('/automod', automodCtrl.listRules);
router.post('/automod', automodCtrl.createRule);
router.patch('/automod/:id', automodCtrl.updateRule);
router.delete('/automod/:id', automodCtrl.deleteRule);

module.exports = router;
