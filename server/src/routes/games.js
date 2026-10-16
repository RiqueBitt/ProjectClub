const express = require('express');
const ctrl = require('../controllers/gameLibraryController');
const { requireAuth } = require('../middleware/auth');

// Biblioteca de jogos (tempo de jogo, estilo Steam).
const router = express.Router();
router.use(requireAuth);

router.get('/library/:userId', ctrl.getLibrary);

// Busca de jogos pra montar o Mural do perfil (qualquer jogo, não só os
// jogados): loja da Steam, com cache curto em memória.
const searchCache = new Map();
router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return res.json({ games: [] });
    const key = q.toLowerCase();
    const hit = searchCache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60 * 1000) return res.json({ games: hit.games });
    const { searchStore } = require('../services/steamArtService');
    const { gameKeyFor } = require('../services/gamePlaytime');
    const items = (await searchStore(q)) || [];
    const games = items.filter((it) => Number.isInteger(Number(it?.id)) && (!it.type || it.type === 'app')).slice(0, 12)
      .map((it) => ({ gameKey: gameKeyFor(it.name), name: String(it.name).slice(0, 100), steamAppId: String(it.id) }))
      .filter((g) => g.gameKey);
    if (searchCache.size > 500) searchCache.clear();
    searchCache.set(key, { at: Date.now(), games });
    res.json({ games });
  } catch (err) { next(err); }
});

module.exports = router;
