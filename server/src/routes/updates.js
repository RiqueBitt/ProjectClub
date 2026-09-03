const express = require('express');
const ctrl = require('../controllers/updatesController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.listUpdates);
router.post('/', ctrl.createUpdate);
router.patch('/:id', ctrl.updateUpdate);
router.delete('/:id', ctrl.deleteUpdate);

module.exports = router;
