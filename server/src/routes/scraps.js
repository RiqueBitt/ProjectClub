const express = require('express');
const ctrl = require('../controllers/scrapController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/:targetId', ctrl.write);
router.get('/:targetId', ctrl.list);
router.delete('/:id', ctrl.remove);

module.exports = router;
