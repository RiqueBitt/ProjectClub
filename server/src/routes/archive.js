// Cinema (filmes, séries, desenhos e anime do Internet Archive).
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const ia = require('../services/archiveBrowse');

const router = express.Router();
router.use(requireAuth);

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    res.status(status).json({ error: status === 502 ? 'Não consegui falar com o Internet Archive agora.' : e.message });
  }
};

router.get('/categories', (req, res) => res.json({ categories: ia.categories() }));
router.get('/home', wrap(async (req, res) => {
  res.set('Cache-Control', 'private, max-age=600');
  res.json(await ia.home());
}));
router.get('/search', wrap(async (req, res) => {
  const { q = '', cat = 'populares', sort = 'populares', page = '1' } = req.query;
  res.set('Cache-Control', 'private, max-age=300');
  res.json(await ia.search({ q: String(q), cat: String(cat), sort: String(sort), page: Number(page) || 1 }));
}));
router.get('/item/:id', wrap(async (req, res) => {
  res.set('Cache-Control', 'private, max-age=1800');
  res.json(await ia.item(req.params.id));
}));
router.get('/subtitle/:id', wrap(async (req, res) => {
  const vtt = await ia.subtitle(req.params.id, String(req.query.file || ''));
  res.set('Cache-Control', 'private, max-age=21600');
  res.type('text/vtt; charset=utf-8').send(vtt);
}));

module.exports = router;
