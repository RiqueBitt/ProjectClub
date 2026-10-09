const express = require('express');
const ctrl = require('../controllers/modpackController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

const router = express.Router();

// Modpacks públicos (item pedido: "criar modpacks e postar pra outras
// pessoas baixarem") — qualquer pessoa logada vê/vota/baixa; só o dono edita.
router.use(requireAuth);

router.get('/', ctrl.listPublic);
router.get('/mine', ctrl.listMine);
router.get('/user/:userId', ctrl.listByUser);
router.put('/featured', ctrl.setFeatured);
router.post('/', ctrl.create);
router.get('/:id', ctrl.getOne);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.post('/:id/cover', uploadImage.single('cover'), ctrl.uploadCover);
router.post('/:id/vote', ctrl.vote);
router.post('/:id/download', ctrl.registerDownload);

module.exports = router;
