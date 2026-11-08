const express = require('express');
const ctrl = require('../controllers/uiEditorController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.getUiLayout);
router.put('/:device', requirePlatformAdmin, ctrl.updateUiLayout);
router.delete('/:device', requirePlatformAdmin, ctrl.resetUiLayout);

module.exports = router;
