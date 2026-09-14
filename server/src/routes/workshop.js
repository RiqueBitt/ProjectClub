const express = require('express');
const ctrl = require('../controllers/steamWorkshopController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/steam-match', ctrl.matchWorkshopGames);
router.get('/games/:workshopAppId/items', ctrl.listItems);
router.get('/items/:publishedFileId', ctrl.getItem);

module.exports = router;
