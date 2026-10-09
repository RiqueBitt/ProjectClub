const unified = require('../services/unifiedModsService');

const SORTS = new Set(['popular', 'downloads', 'new', 'updated']);

// GET /api/mods/unified/:steamAppId?q=&category=&sort=&pageToken=
// Todas as fontes do jogo juntas, com compatibilidade e categorias.
async function search(req, res, next) {
  try {
    const steamAppId = Number(req.params.steamAppId);
    if (!Number.isInteger(steamAppId) || steamAppId <= 0) return res.status(400).json({ error: 'steamAppId inválido.' });
    const { q, category, sort, pageToken, gameName } = req.query;
    const data = await unified.unifiedSearch(steamAppId, {
      q: typeof q === 'string' ? q.slice(0, 100) : undefined,
      category: typeof category === 'string' && category ? category.slice(0, 80) : undefined,
      sort: SORTS.has(sort) ? sort : 'popular',
      pageToken: typeof pageToken === 'string' ? pageToken.slice(0, 2000) : undefined,
      gameName: typeof gameName === 'string' ? gameName.slice(0, 120) : undefined,
    });
    res.json(data);
  } catch (err) { next(err); }
}

// POST /api/mods/identify { steamAppId, names: [...] } — tenta achar, nas
// fontes do jogo, qual mod é cada pasta/arquivo detectado no disco (só
// aceita correspondência confiável; o resto volta null).
async function identify(req, res, next) {
  try {
    const steamAppId = Number(req.body?.steamAppId);
    const names = Array.isArray(req.body?.names) ? req.body.names.filter((n) => typeof n === 'string').map((n) => n.slice(0, 160)) : [];
    if (!Number.isInteger(steamAppId) || steamAppId <= 0) return res.status(400).json({ error: 'steamAppId inválido.' });
    if (names.length === 0) return res.json({ matches: {} });
    const gameName = typeof req.body?.gameName === 'string' ? req.body.gameName.slice(0, 120) : undefined;
    res.json(await unified.identify(steamAppId, names, gameName));
  } catch (err) { next(err); }
}

module.exports = { search, identify };
