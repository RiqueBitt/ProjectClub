const express = require('express');
const ctrl = require('../controllers/traitController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/:targetId', ctrl.getStatus);
router.post('/:targetId/toggle', ctrl.toggle);

module.exports = router;
