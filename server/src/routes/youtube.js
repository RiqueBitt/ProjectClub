const express = require('express');
const ctrl = require('../controllers/youtubeController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/videos', ctrl.listYoutubeVideos);
// Navegador do "Assistir juntos" (busca/em alta/a seguir/canal/sugestões).
router.get('/search', ctrl.browseSearch);
router.get('/trending', ctrl.browseTrending);
router.get('/related/:id', ctrl.browseRelated);
router.get('/channel/:id', ctrl.browseChannel);
router.get('/suggest', ctrl.browseSuggest);

module.exports = router;
