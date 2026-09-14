const prisma = require('../config/prisma');
const gamebanana = require('../services/gamebananaService');

// Mesmo padrão de matchSteamGames/matchWorkshopGames — o desktop já
// detectou os AppIDs localmente, aqui só cruza com GameBananaGameMapping.
async function matchGameBananaGames(req, res, next) {
  try {
    const { steamAppIds } = req.body;
    if (!Array.isArray(steamAppIds) || steamAppIds.length === 0) return res.json({ games: [] });
    const appIds = steamAppIds.map(Number).filter((n) => Number.isInteger(n));
    const mappings = await prisma.gameBananaGameMapping.findMany({ where: { steamAppId: { in: appIds }, enabled: true } });
    res.json({ games: mappings });
  } catch (err) { next(err); }
}

// Normaliza um item de listagem (Subfeed ou Search) pra um formato
// estável, independente de qual dos dois formatos exatos veio (ver
// aviso no topo de gamebananaService.js sobre nomes de campo não-100%-
// documentados) — tenta várias chaves possíveis pra cada campo.
function normalizeListItem(raw) {
  const image = raw._aPreviewMedia?._aImages?.[0];
  const thumbUrl = image ? `${image._sBaseUrl}/${image._sFile220 || image._sFile}` : null;
  return {
    id: raw._idRow,
    modelName: raw._sModelName || 'Mod',
    name: raw._sName || raw._sModelName || 'Sem nome',
    profileUrl: raw._sProfileUrl,
    thumbUrl,
    submitter: raw._aSubmitter?._sName || raw._aOwner?._sName || null,
    dateModified: raw._tsDateModified,
    viewCount: raw._nViewCount,
    likeCount: raw._nLikeCount,
  };
}

async function browse(req, res, next) {
  try {
    const gameBananaGameId = Number(req.params.gameBananaGameId);
    const { q, sort, page, limit } = req.query;
    const data = await gamebanana.browseOrSearch(gameBananaGameId, {
      query: q, sort, page: page ? Number(page) : 1, limit: limit ? Number(limit) : 20,
    });
    // Search/Results agrupa por tipo de modelo em _aRecords; Subfeed já
    // devolve a lista direto em _aRecords também — os dois batem nesse
    // campo em comum, então não precisa de dois caminhos de código.
    const rawItems = data._aRecords || data._aResults || [];
    res.json({ items: rawItems.map(normalizeListItem), hasMore: !!data._aMetadata?._bIsComplete === false });
  } catch (err) { next(err); }
}

async function getMod(req, res, next) {
  try {
    const raw = await gamebanana.getMod(req.params.modId);
    const image = raw._aPreviewMedia?._aImages?.[0];
    const images = (raw._aPreviewMedia?._aImages || []).map((img) => `${img._sBaseUrl}/${img._sFile}`);
    const files = (raw._aFiles || []).map((f) => ({
      id: f._idRow, filename: f._sFile, filesize: f._nFilesize,
      downloadUrl: f._sDownloadUrl || `https://gamebanana.com/dl/${f._idRow}`,
    }));
    res.json({
      mod: {
        id: req.params.modId,
        name: raw._sName,
        profileUrl: raw._sProfileUrl,
        description: raw._sText || raw._sDescription,
        submitter: raw._aSubmitter?._sName,
        dateAdded: raw._tsDateAdded,
        dateModified: raw._tsDateModified,
        viewCount: raw._nViewCount,
        likeCount: raw._nLikeCount,
        categories: (raw._aCategory ? [raw._aCategory._sName] : []).filter(Boolean),
        thumbUrl: image ? `${image._sBaseUrl}/${image._sFile}` : null,
        images,
        files,
      },
    });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'Mod não encontrado.' });
    next(err);
  }
}

// ---------- Admin ----------
async function adminListGameMappings(req, res, next) {
  try {
    const mappings = await prisma.gameBananaGameMapping.findMany({ orderBy: { displayName: 'asc' } });
    res.json({ mappings });
  } catch (err) { next(err); }
}

async function adminCreateGameMapping(req, res, next) {
  try {
    const { steamAppId, gameBananaGameId, displayName, iconUrl } = req.body;
    if (!steamAppId || !gameBananaGameId || !displayName?.trim()) {
      return res.status(400).json({ error: 'steamAppId, gameBananaGameId e displayName são obrigatórios.' });
    }
    const mapping = await prisma.gameBananaGameMapping.create({
      data: { steamAppId: Number(steamAppId), gameBananaGameId: Number(gameBananaGameId), displayName: displayName.trim(), iconUrl: iconUrl || null },
    });
    res.status(201).json({ mapping });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Já existe um mapeamento pra esse Steam AppID.' });
    next(err);
  }
}

async function adminUpdateGameMapping(req, res, next) {
  try {
    const { displayName, iconUrl, enabled } = req.body;
    const mapping = await prisma.gameBananaGameMapping.update({
      where: { id: req.params.id },
      data: {
        ...(displayName !== undefined ? { displayName: displayName.trim() } : {}),
        ...(iconUrl !== undefined ? { iconUrl } : {}),
        ...(enabled !== undefined ? { enabled: !!enabled } : {}),
      },
    });
    res.json({ mapping });
  } catch (err) { next(err); }
}

async function adminDeleteGameMapping(req, res, next) {
  try {
    await prisma.gameBananaGameMapping.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = {
  matchGameBananaGames, browse, getMod,
  adminListGameMappings, adminCreateGameMapping, adminUpdateGameMapping, adminDeleteGameMapping,
};
