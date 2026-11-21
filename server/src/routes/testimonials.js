const express = require('express');
const ctrl = require('../controllers/testimonialController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/:targetId', ctrl.writeTestimonial);
router.get('/pending/mine', ctrl.listPendingForMe);
router.get('/:targetId', ctrl.listApproved);
router.post('/:id/respond', ctrl.respond);
router.delete('/:id', ctrl.remove);

module.exports = router;
