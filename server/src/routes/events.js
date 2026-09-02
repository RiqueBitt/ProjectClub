const express = require('express');
const ctrl = require('../controllers/eventsController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.listEvents);
router.post('/', ctrl.createEvent);
router.patch('/:id', ctrl.updateEvent);
router.delete('/:id', ctrl.deleteEvent);
router.post('/:id/banner', uploadImage.single('banner'), ctrl.uploadEventBanner);
router.post('/:id/icon', uploadImage.single('icon'), ctrl.uploadEventIcon);

module.exports = router;
