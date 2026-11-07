const express = require('express');
const ctrl = require('../controllers/profilePollController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/', ctrl.create);
router.get('/author/:authorId', ctrl.listByAuthor);
router.post('/:id/vote', ctrl.vote);
router.delete('/:id', ctrl.remove);

module.exports = router;
