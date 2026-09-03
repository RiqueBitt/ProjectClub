const prisma = require('../config/prisma');
const economy = require('../services/economy');
const achievements = require('../services/achievements');
const { LEVELS, nextLevel, titleForLevel } = require('../data/levelsCatalog');

async function getMyEconomy(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { coins: true, gems: true, dailyStreak: true, lastDailyAt: true, accountLevel: true },
    });
    res.json({
      coins: user.coins, gems: user.gems, dailyStreak: user.dailyStreak,
      lastDailyAt: user.lastDailyAt, accountLevel: user.accountLevel,
    });
  } catch (err) { next(err); }
}

async function claimDaily(req, res, next) {
  try {
    const result = await economy.claimDaily(req.user.id);
    const newAchievements = await achievements.checkAndUnlock(req.user.id, req.app.get('io'));
    res.json({ ...result, newAchievements });
  } catch (err) { next(err); }
}

// Galeria pública dos baús possíveis (só nome+imagem, sem as chances —
// isso fica só na tela de admin) — mostrada na página de Economia, igual
// o bot Robbie mostrava com /daily.
async function listChests(req, res, next) {
  try {
    const chests = await prisma.dailyChest.findMany({
      where: { enabled: true }, orderBy: { position: 'asc' },
      select: { id: true, name: true, imageClosed: true, imageOpened: true },
    });
    res.json({ chests });
  } catch (err) { next(err); }
}

// --- Nível / rank ---

async function getRank(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { accountXp: true, accountLevel: true } });
    const currentLevelData = LEVELS.find((l) => l.level === user.accountLevel) || LEVELS[0];
    const next = nextLevel(user.accountLevel);
    const higherRank = await prisma.user.count({ where: { accountXp: { gt: user.accountXp } } });

    let progress = 100;
    let xpInLevel = 0;
    let xpNeeded = 0;
    if (next) {
      xpInLevel = user.accountXp - currentLevelData.minXp;
      xpNeeded = next.minXp - currentLevelData.minXp;
      progress = Math.max(0, Math.min(100, Math.floor((xpInLevel / xpNeeded) * 100)));
    }

    res.json({
      level: user.accountLevel, levelName: currentLevelData.name, levelTitle: titleForLevel(user.accountLevel), xp: user.accountXp,
      nextLevel: next?.level || null, xpInLevel, xpNeeded, progress,
      isMaxLevel: !next, position: higherRank + 1,
    });
  } catch (err) { next(err); }
}

async function listLeaderboard(req, res, next) {
  try {
    const { PUBLIC_USER_FIELDS } = require('./authController');
    const top = await prisma.user.findMany({
      orderBy: { accountXp: 'desc' }, take: 50, select: { ...PUBLIC_USER_FIELDS, accountXp: true },
    });
    // Item pedido: "melhore o menu de ranks" — antes, quem não estava
    // no top 50 simplesmente não se via em lugar nenhum da lista (só
    // sabia a própria posição pelo número em getRank, sem ver contra
    // quem exatamente estava competindo). Se a pessoa que pediu não
    // estiver entre os 50, ela entra no fim da lista mesmo assim —
    // outsideTop50 avisa o cliente pra desenhar um separador visual
    // antes dela, deixando claro que ela não é "a 51ª colocada" de
    // verdade, só está fora do topo.
    const alreadyIncluded = top.some((u) => u.id === req.user.id);
    let me = null;
    if (!alreadyIncluded) {
      const meRow = await prisma.user.findUnique({ where: { id: req.user.id }, select: { ...PUBLIC_USER_FIELDS, accountXp: true } });
      if (meRow) me = { ...meRow, outsideTop50: true };
    }
    res.json({ leaderboard: me ? [...top, me] : top });
  } catch (err) { next(err); }
}

// ============================================================
// Administração dos baús diários (staff) — equivalente ao comando
// /edit_daily do bot Robbie, só que pela web.
// ============================================================

async function adminListChests(req, res, next) {
  try {
    const chests = await prisma.dailyChest.findMany({ orderBy: { position: 'asc' } });
    res.json({ chests });
  } catch (err) { next(err); }
}

async function adminCreateChest(req, res, next) {
  try {
    const { name, chanceRegular, coinsMin, coinsMax, ticketsMin, ticketsMax, imageClosed, imageOpened } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const count = await prisma.dailyChest.count();
    const chest = await prisma.dailyChest.create({
      data: {
        name, chanceRegular: parseFloat(chanceRegular) || 0.1,
        coinsMin: parseInt(coinsMin, 10) || 1, coinsMax: parseInt(coinsMax, 10) || 10,
        ticketsMin: parseInt(ticketsMin, 10) || 0, ticketsMax: parseInt(ticketsMax, 10) || 0,
        imageClosed: imageClosed || undefined, imageOpened: imageOpened || undefined,
        position: count,
      },
    });
    req.app.get('io')?.to('community').emit('chests:update');
    res.status(201).json({ chest });
  } catch (err) { next(err); }
}

async function adminUpdateChest(req, res, next) {
  try {
    const { id } = req.params;
    const allowed = ['name', 'chanceRegular', 'chanceSubscriber', 'coinsMin', 'coinsMax', 'ticketsMin', 'ticketsMax', 'position', 'enabled', 'imageClosed', 'imageOpened'];
    const data = {};
    for (const key of allowed) if (req.body[key] !== undefined) data[key] = req.body[key];
    ['chanceRegular', 'chanceSubscriber'].forEach((k) => { if (data[k] !== undefined) data[k] = parseFloat(data[k]); });
    ['coinsMin', 'coinsMax', 'ticketsMin', 'ticketsMax', 'position'].forEach((k) => { if (data[k] !== undefined) data[k] = parseInt(data[k], 10); });
    const chest = await prisma.dailyChest.update({ where: { id }, data });
    req.app.get('io')?.to('community').emit('chests:update');
    res.json({ chest });
  } catch (err) { next(err); }
}

async function adminDeleteChest(req, res, next) {
  try {
    const { id } = req.params;
    await prisma.dailyChest.delete({ where: { id } });
    req.app.get('io')?.to('community').emit('chests:update');
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  getMyEconomy, claimDaily, listChests, getRank, listLeaderboard,
  adminListChests, adminCreateChest, adminUpdateChest, adminDeleteChest,
};
