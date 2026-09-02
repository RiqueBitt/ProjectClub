const express = require('express');
const ctrl = require('../controllers/youtubeController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/videos', ctrl.listYoutubeVideos);

module.exports = router;
