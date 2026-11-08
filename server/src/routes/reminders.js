const express = require('express');
const ctrl = require('../controllers/reminderController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.post('/preview', ctrl.preview);
router.delete('/:id', ctrl.remove);

module.exports = router;
