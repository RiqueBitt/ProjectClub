const prisma = require('../config/prisma');
const thunderstore = require('../services/thunderstoreService');

// Mesmo padrão de matchSteamGames/matchWorkshopGames/matchGameBananaGames
// — o desktop já detectou os AppIDs localmente, aqui só cruza com
// ThunderstoreGameMapping.
async function matchThunderstoreGames(req, res, next) {
  try {
    const { steamAppIds } = req.body;
    if (!Array.isArray(steamAppIds) || steamAppIds.length === 0) return res.json({ games: [] });
    const appIds = steamAppIds.map(Number).filter((n) => Number.isInteger(n));
    const mappings = await prisma.thunderstoreGameMapping.findMany({ where: { steamAppId: { in: appIds }, enabled: true } });
    // O resto do app (ModsPage.jsx GameHubView/GameCard) espera cada
    // fonte no formato { steamAppId, displayName, iconUrl, ... } — aqui
    // o "..." é thunderstoreCommunity, único campo extra que só essa
    // fonte precisa (o identificador da comunidade pra todas as outras
    // chamadas abaixo).
    res.json({
      games: mappings.map((m) => ({
        steamAppId: m.steamAppId, displayName: m.displayName, iconUrl: m.iconUrl,
        thunderstoreCommunity: m.communityIdentifier,
      })),
    });
  } catch (err) { next(err); }
}

async function listCategories(req, res, next) {
  try {
    const categories = await thunderstore.fetchCategories(req.params.community);
    res.json({ categories });
  } catch (err) { next(err); }
}

async function listPackages(req, res, next) {
  try {
    const { q, sort, category, offset, limit } = req.query;
    const { packages, total } = await thunderstore.searchPackages(req.params.community, {
      q, sort, category, offset: offset ? Number(offset) : 0, limit: limit ? Number(limit) : 30,
    });
    res.json({ packages, total });
  } catch (err) { next(err); }
}

async function getPackage(req, res, next) {
  try {
    const { pkg, dependencies } = await thunderstore.getPackageDetail(req.params.community, req.params.fullName);
    res.json({ package: pkg, dependencies });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'Mod não encontrado nesta comunidade.' });
    next(err);
  }
}

// ---------- Admin ----------
async function adminListGameMappings(req, res, next) {
  try {
    const mappings = await prisma.thunderstoreGameMapping.findMany({ orderBy: { displayName: 'asc' } });
    res.json({ mappings });
  } catch (err) { next(err); }
}

async function adminCreateGameMapping(req, res, next) {
  try {
    const { steamAppId, communityIdentifier, displayName, iconUrl } = req.body;
    if (!steamAppId || !communityIdentifier?.trim() || !displayName?.trim()) {
      return res.status(400).json({ error: 'steamAppId, communityIdentifier e displayName são obrigatórios.' });
    }
    const mapping = await prisma.thunderstoreGameMapping.create({
      data: {
        steamAppId: Number(steamAppId), communityIdentifier: communityIdentifier.trim().toLowerCase(),
        displayName: displayName.trim(), iconUrl: iconUrl || null,
      },
    });
    res.status(201).json({ mapping });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Já existe um mapeamento pra esse Steam AppID.' });
    next(err);
  }
}

async function adminUpdateGameMapping(req, res, next) {
  try {
    const { displayName, iconUrl, enabled, communityIdentifier } = req.body;
    const mapping = await prisma.thunderstoreGameMapping.update({
      where: { id: req.params.id },
      data: {
        ...(displayName !== undefined ? { displayName: displayName.trim() } : {}),
        ...(iconUrl !== undefined ? { iconUrl } : {}),
        ...(enabled !== undefined ? { enabled: !!enabled } : {}),
        ...(communityIdentifier !== undefined ? { communityIdentifier: communityIdentifier.trim().toLowerCase() } : {}),
      },
    });
    res.json({ mapping });
  } catch (err) { next(err); }
}

async function adminDeleteGameMapping(req, res, next) {
  try {
    await prisma.thunderstoreGameMapping.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = {
  matchThunderstoreGames, listCategories, listPackages, getPackage,
  adminListGameMappings, adminCreateGameMapping, adminUpdateGameMapping, adminDeleteGameMapping,
};
