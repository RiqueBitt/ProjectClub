const express = require('express');
const ctrl = require('../controllers/achievementsController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.listAchievements);

router.get('/admin', ctrl.adminListAchievements);
router.post('/admin', ctrl.createAchievement);
router.patch('/admin/:id', ctrl.updateAchievement);
router.post('/admin/:id/icon', uploadImage.single('icon'), ctrl.uploadAchievementIcon);
router.delete('/admin/:id', ctrl.deleteAchievement);

module.exports = router;
