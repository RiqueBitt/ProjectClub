// Links bonitos: GET /api/links/resolve?path=/canal/chat-geral
// → { link: { kind, id, path, ... } } ou 404. Aceita também os endereços
// antigos (/channels/<id>, /conversations/<id>, /u/<id>, /eventos/<id>,
// /posts/<id>) e devolve o endereço bonito pra onde o site redireciona.
// Mesma regra de acesso dos ids (ver services/linkResolver.js).
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { resolveLink } = require('../services/linkResolver');

const router = express.Router();
router.use(requireAuth);

router.get('/resolve', async (req, res, next) => {
  try {
    const path = typeof req.query.path === 'string' ? req.query.path.slice(0, 300) : '';
    const link = await resolveLink({ path, userId: req.user.id });
    if (!link) return res.status(404).json({ error: 'Link não encontrado.' });
    res.json({ link });
  } catch (err) { next(err); }
});

module.exports = router;
