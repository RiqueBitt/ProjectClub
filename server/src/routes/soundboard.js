const express = require('express');
const ctrl = require('../controllers/soundboardController');
const { requireAuth } = require('../middleware/auth');
const { uploadAudio } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);
router.get('/', ctrl.listSounds);
router.post('/', uploadAudio.single('sound'), ctrl.createSound);
router.patch('/:id', ctrl.updateSound);
router.delete('/:id', ctrl.deleteSound);

module.exports = router;
