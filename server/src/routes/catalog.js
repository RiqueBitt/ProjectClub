// Cinema → Lançamentos (catálogo recente: metadados, trailers e onde assistir).
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const cat = require('../services/catalogBrowse');

const router = express.Router();
router.use(requireAuth);

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    res.status(status).json({ error: status === 502 ? 'Não consegui falar com as fontes do catálogo agora.' : e.message });
  }
};

router.get('/home', wrap(async (req, res) => {
  res.set('Cache-Control', 'private, max-age=600');
  res.json({ ...(await cat.home()), lists: cat.lists() });
}));
router.get('/list/:name', wrap(async (req, res) => {
  res.set('Cache-Control', 'private, max-age=600');
  res.json(await cat.list(String(req.params.name), Number(req.query.page) || 1));
}));
router.get('/search', wrap(async (req, res) => {
  res.set('Cache-Control', 'private, max-age=300');
  res.json(await cat.search(String(req.query.q || ''), String(req.query.kind || 'todos')));
}));
// Grátis na Pluto TV (catálogo via TMDB/JustWatch; o vídeo abre no site oficial).
router.get('/pluto/meta', wrap(async (req, res) => {
  res.set('Cache-Control', 'private, max-age=600');
  res.json(await cat.plutoMeta());
}));
router.get('/pluto', wrap(async (req, res) => {
  const qy = req.query;
  res.set('Cache-Control', 'private, max-age=300');
  res.json(await cat.plutoSearch({
    type: ['movie', 'tv', 'all'].includes(qy.type) ? qy.type : 'all',
    yearFrom: qy.yearFrom === undefined ? 2001 : Number(qy.yearFrom) || 0,
    yearTo: Number(qy.yearTo) || 0,
    genre: Number(qy.genre) || null,
    lang: /^[a-z]{2}$/.test(String(qy.lang || '')) ? qy.lang : null,
    q: String(qy.q || '').slice(0, 80),
    sort: String(qy.sort || 'populares'),
    page: Number(qy.page) || 1,
  }));
}));
router.get('/item/:id', wrap(async (req, res) => {
  res.set('Cache-Control', 'private, max-age=1800');
  res.json(await cat.item(String(req.params.id)));
}));

module.exports = router;
