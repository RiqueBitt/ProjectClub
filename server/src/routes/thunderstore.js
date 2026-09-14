const express = require('express');
const ctrl = require('../controllers/thunderstoreController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/steam-match', ctrl.matchThunderstoreGames);
router.get('/:community/categories', ctrl.listCategories);
router.get('/:community/packages', ctrl.listPackages);
router.get('/:community/packages/:fullName', ctrl.getPackage);

module.exports = router;
