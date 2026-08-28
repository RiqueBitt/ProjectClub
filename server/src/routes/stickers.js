const express = require('express');
const ctrl = require('../controllers/stickersController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const { requireSystemEnabled } = require('../middleware/systemToggle');

const router = express.Router();
router.use(requireAuth);
router.use(requireSystemEnabled('figurinhas'));

router.get('/', ctrl.getCollection);
router.post('/capsules/buy', ctrl.buyCapsules);
router.post('/capsules/open-all', ctrl.openAllCapsules);
router.post('/:id/paste', ctrl.pasteSticker);

router.get('/admin/album-layout', requirePlatformAdmin, ctrl.adminGetAlbumLayout);
router.patch('/admin/album-layout/settings', requirePlatformAdmin, ctrl.adminUpdateAlbumSettings);
router.put('/admin/album-layout/slots/:slotKey', requirePlatformAdmin, ctrl.adminUpsertAlbumSlot);
router.patch('/admin/:id/position', requirePlatformAdmin, ctrl.adminAssignStickerPosition);

module.exports = router;
