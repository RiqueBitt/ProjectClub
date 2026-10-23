const express = require('express');
const ctrl = require('../controllers/relationshipController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/pending/mine', ctrl.listPendingForMe);
router.post('/request', ctrl.sendRequest);
router.post('/:id/respond', ctrl.respond);
router.post('/end', ctrl.endRelationship);

module.exports = router;
