const express = require('express');
const ctrl = require('../controllers/communitiesController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.listCommunities);
router.post('/', ctrl.createCommunity);
router.get('/:slug', ctrl.getCommunity);
router.patch('/:slug', ctrl.updateCommunity);
router.post('/:slug/icon', uploadImage.single('icon'), ctrl.uploadCommunityIcon);
router.delete('/:slug', ctrl.deleteCommunity);

router.post('/:slug/categories', ctrl.createCategory);
router.patch('/categories/:id', ctrl.updateCategory);
router.post('/categories/:id/icon', uploadImage.single('image'), ctrl.uploadCategoryIcon);
router.post('/categories/:id/banner', uploadImage.single('image'), ctrl.uploadCategoryBanner);
router.delete('/categories/:id', ctrl.deleteCategory);

module.exports = router;
