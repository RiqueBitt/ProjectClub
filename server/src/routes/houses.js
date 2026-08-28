const express = require('express');
const ctrl = require('../controllers/housesController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const { uploadImage } = require('../middleware/upload');
const { requireSystemEnabled } = require('../middleware/systemToggle');

const router = express.Router();
router.use(requireAuth);
router.use(requireSystemEnabled('casas'));

router.get('/catalog/houses', ctrl.listHouseCatalog);
router.post('/catalog/houses/:id/buy', ctrl.buyHouse);
router.get('/catalog/furniture', ctrl.listFurnitureCatalog);
router.post('/catalog/furniture/:id/buy', ctrl.buyFurniture);
router.get('/catalog/maps', ctrl.listMapBackgrounds);
router.post('/catalog/maps/:id/buy', ctrl.buyMapBackground);

router.get('/mine', ctrl.listMyHouses);
router.get('/mine/:houseId', ctrl.getHouseLayout);
router.post('/mine/:houseId/active', ctrl.setActiveHouse);
router.put('/mine/:houseId/layout', ctrl.saveHouseLayout);
router.patch('/mine/:houseId/map', ctrl.setHouseMapBackground);

router.get('/gallery', ctrl.getGallery);
router.post('/gallery/:houseId/like', ctrl.toggleLike);
router.get('/gallery/:houseId/comments', ctrl.listComments);
router.post('/gallery/:houseId/comments', ctrl.addComment);
router.delete('/comments/:commentId', ctrl.deleteComment);

router.get('/achievements', ctrl.getAchievements);

// Administração (staff) — catálogo de casas/móveis, moderação de recados.
router.get('/admin/catalog/houses', requirePlatformAdmin, ctrl.adminListHouseCatalog);
router.post('/admin/catalog/houses', requirePlatformAdmin, uploadImage.single('image'), ctrl.adminCreateHouse);
router.patch('/admin/catalog/houses/:id', requirePlatformAdmin, uploadImage.single('image'), ctrl.adminUpdateHouse);
router.delete('/admin/catalog/houses/:id', requirePlatformAdmin, ctrl.adminDeleteHouse);
router.post('/admin/houses/:id/starter', requirePlatformAdmin, ctrl.adminSetStarterHouse);
router.post('/admin/houses/starter/clear', requirePlatformAdmin, ctrl.adminClearStarterHouse);

router.get('/admin/groups', requirePlatformAdmin, ctrl.adminListHouseGroups);
router.post('/admin/groups/:id', requirePlatformAdmin, ctrl.adminSetHouseGroup);
router.delete('/admin/groups/:id', requirePlatformAdmin, ctrl.adminDeleteHouseGroup);

router.get('/admin/catalog/furniture-categories', requirePlatformAdmin, ctrl.adminListFurnitureCategories);
router.post('/admin/catalog/furniture-categories', requirePlatformAdmin, ctrl.adminCreateFurnitureCategory);

router.post('/admin/catalog/maps', requirePlatformAdmin, uploadImage.single('image'), ctrl.adminCreateMapBackground);
router.patch('/admin/catalog/maps/:id', requirePlatformAdmin, uploadImage.single('image'), ctrl.adminUpdateMapBackground);
router.delete('/admin/catalog/maps/:id', requirePlatformAdmin, ctrl.adminDeleteMapBackground);
router.post('/admin/maps/:id/starter', requirePlatformAdmin, ctrl.adminSetStarterMap);
router.post('/admin/maps/starter/clear', requirePlatformAdmin, ctrl.adminClearStarterMap);

router.get('/admin/catalog/furniture', requirePlatformAdmin, ctrl.adminListFurnitureCatalog);
router.post('/admin/catalog/furniture', requirePlatformAdmin, uploadImage.single('image'), ctrl.adminCreateFurniture);
router.patch('/admin/catalog/furniture/:id', requirePlatformAdmin, uploadImage.single('image'), ctrl.adminUpdateFurniture);
router.delete('/admin/catalog/furniture/:id', requirePlatformAdmin, ctrl.adminDeleteFurniture);

router.get('/admin/comments', requirePlatformAdmin, ctrl.adminListHouseComments);
router.delete('/admin/comments/:commentId', requirePlatformAdmin, ctrl.adminDeleteHouseCommentMod);

module.exports = router;
