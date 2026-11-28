const express = require('express');
const ctrl = require('../controllers/galleryController');
const { requireAuth } = require('../middleware/auth');

// Galeria: curtidas, mais curtidos e álbuns (a lista em si fica em /api/community/gallery).
const router = express.Router();
router.use(requireAuth);
router.post('/likes/lookup', ctrl.lookupLikes);
router.post('/likes/toggle', ctrl.toggleLike);
router.get('/top', ctrl.topLiked);
router.get('/albums', ctrl.listAlbums);
router.post('/albums', ctrl.createAlbum);
router.get('/albums/:id', ctrl.getAlbum);
router.patch('/albums/:id', ctrl.updateAlbum);
router.delete('/albums/:id', ctrl.deleteAlbum);
router.post('/albums/:id/items', ctrl.addAlbumItem);
router.delete('/albums/:id/items/:key', ctrl.removeAlbumItem);

module.exports = router;
