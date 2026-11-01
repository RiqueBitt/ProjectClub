const nexus = require('../services/nexusService');

const DOMAIN_RE = /^[a-z0-9]{1,64}$/;
const isId = (v) => /^\d{1,10}$/.test(String(v));

function notConfigured(res) {
  return res.status(503).json({ error: 'Essa fonte de mods está indisponível no momento.' });
}

// POST /api/nexus/steam-match { steamAppIds: [...], names: { [appId]: nome } }
// Quais jogos detectados no PC existem na Nexus Mods (AppID fixo ou nome).
async function matchSteamGames(req, res, next) {
  try {
    if (!nexus.isConfigured()) return res.json({ games: [] });
    const ids = (Array.isArray(req.body?.steamAppIds) ? req.body.steamAppIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
    const names = req.body?.names && typeof req.body.names === 'object' ? req.body.names : {};
    const games = [];
    for (const id of ids) {
      const name = typeof names[id] === 'string' ? names[id].slice(0, 120) : null;
      const g = await nexus.resolveGame(id, name ? [name] : []).catch(() => null);
      if (g) games.push({ steamAppId: id, nexusDomain: g.domain, nexusGameId: g.gameId, displayName: g.name || name || null });
    }
    res.json({ games });
  } catch (err) { next(err); }
}

// GET /api/nexus/games/:domain/mods/:modId — detalhes + arquivos.
async function getMod(req, res, next) {
  try {
    if (!nexus.isConfigured()) return notConfigured(res);
    const { domain, modId } = req.params;
    if (!DOMAIN_RE.test(domain) || !isId(modId)) return res.status(400).json({ error: 'Mod inválido.' });
    const mod = await nexus.getMod(domain, Number(modId));
    res.json({ mod });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'Mod não encontrado.' });
    next(err);
  }
}

// GET /api/nexus/games/:domain/mods/:modId/files/:fileId/download?key=&expires=
// Link direto do arquivo. Conta grátis precisa do key/expires do link
// nxm:// ("Mod Manager Download" no site) — sem isso devolve 403 com o
// endereço da página certa pra pessoa clicar.
async function getDownload(req, res, next) {
  try {
    if (!nexus.isConfigured()) return notConfigured(res);
    const { domain, modId, fileId } = req.params;
    if (!DOMAIN_RE.test(domain) || !isId(modId) || !isId(fileId)) return res.status(400).json({ error: 'Arquivo inválido.' });
    const key = typeof req.query.key === 'string' && /^[A-Za-z0-9_+/=-]{1,300}$/.test(req.query.key) ? req.query.key : undefined;
    const expires = typeof req.query.expires === 'string' && isId(req.query.expires) ? req.query.expires : undefined;
    try {
      const link = await nexus.getDownloadLink(domain, Number(modId), Number(fileId), { key, expires });
      res.json(link);
    } catch (err) {
      if (err.status === 403 || err.status === 401) {
        return res.status(403).json({
          error: 'Este mod precisa ser baixado pela página dele.',
          needsManager: true,
          managerUrl: nexus.managerDownloadUrl(domain, modId, fileId),
        });
      }
      if (err.status === 410) return res.status(410).json({ error: 'O link de download expirou. Clique de novo no botão de download da página.' });
      throw err;
    }
  } catch (err) { next(err); }
}

module.exports = { matchSteamGames, getMod, getDownload };
