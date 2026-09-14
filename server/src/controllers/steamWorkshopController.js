const prisma = require('../config/prisma');
const workshop = require('../services/steamWorkshopService');

// Mesmo espírito do matchSteamGames (modController.js): o app desktop já
// mandou só os AppIDs detectados LOCALMENTE (item pedido 30); aqui só
// cruza com WorkshopGameMapping (staff-editável) pra saber quais desses
// jogos têm suporte a Steam Workshop configurado.
async function matchWorkshopGames(req, res, next) {
  try {
    const { steamAppIds } = req.body;
    if (!Array.isArray(steamAppIds) || steamAppIds.length === 0) return res.json({ games: [] });
    const appIds = steamAppIds.map(Number).filter((n) => Number.isInteger(n));
    const mappings = await prisma.workshopGameMapping.findMany({ where: { steamAppId: { in: appIds }, enabled: true } });
    res.json({ games: mappings });
  } catch (err) { next(err); }
}

async function listItems(req, res, next) {
  try {
    const workshopAppId = Number(req.params.workshopAppId);
    const { q, sort, cursor, limit } = req.query;
    const data = await workshop.queryFiles(workshopAppId, { query: q, sort, cursor, limit: limit ? Number(limit) : 20 });
    res.json({
      items: data.publishedfiledetails || [],
      total: data.total || 0,
      nextCursor: data.next_cursor || null,
    });
  } catch (err) {
    if (err instanceof workshop.SteamWorkshopNotConfiguredError) return res.status(503).json({ error: err.message });
    next(err);
  }
}

async function getItem(req, res, next) {
  try {
    const [item] = await workshop.getFileDetails([req.params.publishedFileId]);
    if (!item || item.result !== 1) return res.status(404).json({ error: 'Item do Workshop não encontrado.' });
    res.json({ item });
  } catch (err) {
    if (err instanceof workshop.SteamWorkshopNotConfiguredError) return res.status(503).json({ error: err.message });
    next(err);
  }
}

// ---------- Admin ----------
async function adminListGameMappings(req, res, next) {
  try {
    const mappings = await prisma.workshopGameMapping.findMany({ orderBy: { displayName: 'asc' } });
    res.json({ mappings });
  } catch (err) { next(err); }
}

async function adminCreateGameMapping(req, res, next) {
  try {
    const { steamAppId, workshopAppId, displayName, iconUrl, note } = req.body;
    if (!steamAppId || !workshopAppId || !displayName?.trim()) {
      return res.status(400).json({ error: 'steamAppId, workshopAppId e displayName são obrigatórios.' });
    }
    const mapping = await prisma.workshopGameMapping.create({
      data: { steamAppId: Number(steamAppId), workshopAppId: Number(workshopAppId), displayName: displayName.trim(), iconUrl: iconUrl || null, note: note || null },
    });
    res.status(201).json({ mapping });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Já existe um mapeamento pra esse Steam AppID.' });
    next(err);
  }
}

async function adminUpdateGameMapping(req, res, next) {
  try {
    const { displayName, iconUrl, note, enabled } = req.body;
    const mapping = await prisma.workshopGameMapping.update({
      where: { id: req.params.id },
      data: {
        ...(displayName !== undefined ? { displayName: displayName.trim() } : {}),
        ...(iconUrl !== undefined ? { iconUrl } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(enabled !== undefined ? { enabled: !!enabled } : {}),
      },
    });
    res.json({ mapping });
  } catch (err) { next(err); }
}

async function adminDeleteGameMapping(req, res, next) {
  try {
    await prisma.workshopGameMapping.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = {
  matchWorkshopGames, listItems, getItem,
  adminListGameMappings, adminCreateGameMapping, adminUpdateGameMapping, adminDeleteGameMapping,
};
