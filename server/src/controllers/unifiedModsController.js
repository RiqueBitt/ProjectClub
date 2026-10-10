const unified = require('../services/unifiedModsService');
const updates = require('../services/modUpdatesService');

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

// POST /api/mods/updates { steamAppId, gameName?, mods: [{ source, sourceId, version }] }
// Versão mais nova de cada mod instalado pelo Project Club (em lote).
async function checkUpdates(req, res, next) {
  try {
    const steamAppId = Number(req.body?.steamAppId);
    if (!Number.isInteger(steamAppId) || steamAppId <= 0) return res.status(400).json({ error: 'steamAppId inválido.' });
    const mods = Array.isArray(req.body?.mods) ? req.body.mods.slice(0, 120) : [];
    const gameName = typeof req.body?.gameName === 'string' ? req.body.gameName.slice(0, 120) : undefined;
    res.json(await updates.checkUpdates(steamAppId, mods, gameName));
  } catch (err) { next(err); }
}

// GET /api/mods/trending?games=730:Nome,1966720:Nome — mods em alta dos
// jogos pedidos (até 6). Sem jogos: os jogos mais populares do site.
async function trending(req, res, next) {
  try {
    const raw = typeof req.query.games === 'string' ? req.query.games.slice(0, 1500) : '';
    const games = [];
    for (const part of raw.split(',')) {
      const [id, ...rest] = part.split(':');
      const steamAppId = Number(id);
      if (!Number.isInteger(steamAppId) || steamAppId <= 0 || games.some((g) => g.steamAppId === steamAppId)) continue;
      let name = rest.join(':') || '';
      try { name = decodeURIComponent(name); } catch { /* nome cru */ }
      name = name.slice(0, 120) || null;
      games.push({ steamAppId, name });
    }
    res.json(await updates.trending(games));
  } catch (err) { next(err); }
}

module.exports = { search, identify, checkUpdates, trending };
