const express = require('express');
const ctrl = require('../controllers/postsController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.listPosts);
router.post('/', ctrl.createPost);
router.post('/upload-image', uploadImage.single('image'), ctrl.uploadPostImage);
// Item pedido: "posts em destaque durante o mês" (categoria Início) —
// precisa vir ANTES de /:id, senão o Express trataria "featured" como
// se fosse um :id de post (rota wildcard capturaria primeiro).
router.get('/featured', ctrl.listFeaturedPostsThisMonth);
router.get('/:id', ctrl.getPost);
router.delete('/:id', ctrl.deletePost);
router.post('/:id/vote', ctrl.votePost);

router.get('/:id/comments', ctrl.listComments);
router.post('/:id/comments', ctrl.addComment);
router.post('/comments/:id/vote', ctrl.voteComment);
router.delete('/comments/:id', ctrl.deleteComment);

module.exports = router;
