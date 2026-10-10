const express = require('express');
const ctrl = require('../controllers/decorationsController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const { uploadImage } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);
router.get('/', ctrl.list);
router.post('/equip', ctrl.equip);
router.get('/admin/all', requirePlatformAdmin, ctrl.adminList);
router.post('/admin', requirePlatformAdmin, uploadImage.single('image'), ctrl.adminCreate);
router.patch('/admin/:id', requirePlatformAdmin, uploadImage.single('image'), ctrl.adminUpdate);
router.delete('/admin/:id', requirePlatformAdmin, ctrl.adminRemove);
router.post('/:id/buy', ctrl.buy);
module.exports = router;
