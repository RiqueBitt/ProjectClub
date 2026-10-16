const express = require('express');
const ctrl = require('../controllers/decorationsController');
const shop = require('../controllers/shopController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const { uploadImage, upload } = require('../middleware/upload');
const extras = require('../controllers/shopExtrasController');

const router = express.Router();
router.use(requireAuth);
router.get('/', ctrl.list);
// Loja completa (molduras + efeitos de perfil + coleções).
router.get('/shop', shop.shop);
router.post('/effects/equip', shop.equipEffect);
router.post('/effects/:id/buy', shop.buyEffect);
router.post('/collections/:id/buy', shop.buyCollection);
// Fontes do nome e estilos de perfil (ShopItem).
router.post('/fonts/equip', shop.equipFont);
router.post('/fonts/:id/buy', shop.buyFont);
router.post('/styles/equip', shop.equipStyle);
router.post('/styles/:id/buy', shop.buyStyle);
// Itens limitados e trocas entre jogadores.
router.get('/limiteds/:userId', extras.listLimiteds);
router.get('/trades', extras.listTrades);
router.post('/trades', extras.createTrade);
router.post('/trades/:id/accept', extras.acceptTrade);
router.post('/trades/:id/decline', extras.declineTrade);
router.post('/trades/:id/cancel', extras.cancelTrade);
router.get('/history', shop.purchaseHistory); // compras + presentes
router.post('/gift', shop.giftItem); // presentear um amigo
// Códigos de resgate + insígnia de presentes.
const redeemCtrl = require('../controllers/redeemController');
router.post('/redeem', redeemCtrl.redeem);
router.get('/gifts-summary', redeemCtrl.giftsSummary);
router.post('/credits/:id/buy', require('../services/supporterCredit').buyCredit);
const bannerCtrl = require('../controllers/shopBannerController');
router.get('/admin/banners', requirePlatformAdmin, bannerCtrl.list);
router.post('/admin/banners', requirePlatformAdmin, uploadImage.single('image'), bannerCtrl.create);
router.patch('/admin/banners/:id', requirePlatformAdmin, uploadImage.single('image'), bannerCtrl.update);
router.delete('/admin/banners/:id', requirePlatformAdmin, bannerCtrl.remove);
router.get('/admin/codes', requirePlatformAdmin, redeemCtrl.adminList);
router.post('/admin/codes', requirePlatformAdmin, redeemCtrl.adminCreate);
router.delete('/admin/codes/:id', requirePlatformAdmin, redeemCtrl.adminRemove);
const collectionFiles = uploadImage.fields([{ name: 'banner', maxCount: 1 }, { name: 'logo', maxCount: 1 }]);
router.get('/admin/effects', requirePlatformAdmin, shop.adminListEffects);
router.post('/admin/effects', requirePlatformAdmin, uploadImage.single('image'), shop.adminCreateEffect);
router.patch('/admin/effects/:id', requirePlatformAdmin, uploadImage.single('image'), shop.adminUpdateEffect);
router.delete('/admin/effects/:id', requirePlatformAdmin, shop.adminRemoveEffect);
router.get('/admin/collections', requirePlatformAdmin, shop.adminListCollections);
router.post('/admin/collections', requirePlatformAdmin, collectionFiles, shop.adminCreateCollection);
router.patch('/admin/collections/:id', requirePlatformAdmin, collectionFiles, shop.adminUpdateCollection);
router.delete('/admin/collections/:id', requirePlatformAdmin, shop.adminRemoveCollection);
const itemFiles = upload.fields([{ name: 'preview', maxCount: 1 }, { name: 'font', maxCount: 1 }]);
router.get('/admin/items', requirePlatformAdmin, extras.adminListItems);
router.post('/admin/items', requirePlatformAdmin, itemFiles, extras.adminCreateItem);
router.patch('/admin/items/:id', requirePlatformAdmin, itemFiles, extras.adminUpdateItem);
router.delete('/admin/items/:id', requirePlatformAdmin, extras.adminRemoveItem);
// Staff dá (ou tira) qualquer item da Loja de alguém.
router.get('/admin/catalog', requirePlatformAdmin, extras.adminCatalog);
router.post('/admin/grant', requirePlatformAdmin, extras.adminGrant);
router.delete('/admin/grant', requirePlatformAdmin, extras.adminRevoke);
router.post('/equip', ctrl.equip);
router.get('/admin/all', requirePlatformAdmin, ctrl.adminList);
router.post('/admin', requirePlatformAdmin, uploadImage.single('image'), ctrl.adminCreate);
router.patch('/admin/:id', requirePlatformAdmin, uploadImage.single('image'), ctrl.adminUpdate);
router.delete('/admin/:id', requirePlatformAdmin, ctrl.adminRemove);
router.post('/:id/buy', ctrl.buy);
module.exports = router;
