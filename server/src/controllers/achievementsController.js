const prisma = require('../config/prisma');
const { getProgressByType } = require('../services/achievements');

const isStaff = (user) => ['ADMIN', 'MODERATOR'].includes(user.platformRole);
const RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'];
const PROGRESS_TYPES = [
  'POSTS_CREATED', 'POST_UPS_RECEIVED', 'COMMENTS_CREATED', 'COMMENT_UPS_RECEIVED',
  'PROFILE_UPS_RECEIVED', 'FRIENDS_COUNT', 'ACCOUNT_LEVEL',
];

// GET /achievements — devolve o catálogo inteiro (só as habilitadas),
// com o progresso atual de cada uma bloqueada, pra tela de "Conquistas"
// mostrar a barra de progresso sem precisar de outra chamada.
async function listAchievements(req, res, next) {
  try {
    const defs = await prisma.achievement.findMany({ where: { enabled: true }, orderBy: { position: 'asc' } });
    const unlocked = await prisma.userAchievement.findMany({ where: { userId: req.user.id } });
    const unlockedMap = Object.fromEntries(unlocked.map((u) => [u.achievementId, u.unlockedAt]));

    const achievements = await Promise.all(defs.map(async (def) => {
      const isUnlocked = !!unlockedMap[def.key];
      const progress = isUnlocked ? def.target : await getProgressByType(req.user.id, def.progressType);
      return { ...def, unlocked: isUnlocked, unlockedAt: unlockedMap[def.key] || null, progress: Math.min(progress, def.target) };
    }));

    res.json({ achievements });
  } catch (err) { next(err); }
}

// --- Gestão pela staff (painel de admin) ---

async function adminListAchievements(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Sem permissão.' });
    const achievements = await prisma.achievement.findMany({ orderBy: { position: 'asc' } });
    res.json({ achievements, progressTypes: PROGRESS_TYPES, rarities: RARITIES });
  } catch (err) { next(err); }
}

async function createAchievement(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Sem permissão.' });
    const { key, name, description, rarity, progressType, target } = req.body;
    if (!key?.trim() || !name?.trim() || !description?.trim()) return res.status(400).json({ error: 'Preencha chave, nome e descrição.' });
    const cleanKey = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
    if (!PROGRESS_TYPES.includes(progressType)) return res.status(400).json({ error: 'Tipo de progresso inválido.' });
    const parsedTarget = parseInt(target, 10);
    if (!Number.isFinite(parsedTarget) || parsedTarget < 1) return res.status(400).json({ error: 'Meta inválida.' });

    const existing = await prisma.achievement.findUnique({ where: { key: cleanKey } });
    if (existing) return res.status(409).json({ error: 'Já existe uma conquista com essa chave.' });

    const count = await prisma.achievement.count();
    const achievement = await prisma.achievement.create({
      data: {
        key: cleanKey, name: name.trim().slice(0, 80), description: description.trim().slice(0, 500),
        rarity: RARITIES.includes(rarity) ? rarity : 'COMMON', progressType, target: parsedTarget, position: count,
      },
    });
    req.app.get('io')?.to('community').emit('achievement:catalog-update');
    res.status(201).json({ achievement });
  } catch (err) { next(err); }
}

async function updateAchievement(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Sem permissão.' });
    const { id } = req.params;
    const existing = await prisma.achievement.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Conquista não encontrada.' });

    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name.trim().slice(0, 80);
    if (req.body.description !== undefined) data.description = req.body.description.trim().slice(0, 500);
    if (req.body.rarity !== undefined && RARITIES.includes(req.body.rarity)) data.rarity = req.body.rarity;
    if (req.body.progressType !== undefined && PROGRESS_TYPES.includes(req.body.progressType)) data.progressType = req.body.progressType;
    if (req.body.target !== undefined) {
      const parsed = parseInt(req.body.target, 10);
      if (Number.isFinite(parsed) && parsed >= 1) data.target = parsed;
    }
    if (req.body.enabled !== undefined) data.enabled = !!req.body.enabled;
    if (req.body.iconUrl === null) data.iconUrl = null; // explicitamente limpar, volta ao ícone padrão

    const achievement = await prisma.achievement.update({ where: { id }, data });
    req.app.get('io')?.to('community').emit('achievement:catalog-update');
    res.json({ achievement });
  } catch (err) { next(err); }
}

async function uploadAchievementIcon(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Sem permissão.' });
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const existing = await prisma.achievement.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Conquista não encontrada.' });
    const achievement = await prisma.achievement.update({ where: { id }, data: { iconUrl: req.file.url } });
    req.app.get('io')?.to('community').emit('achievement:catalog-update');
    res.json({ achievement });
  } catch (err) { next(err); }
}

async function deleteAchievement(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Sem permissão.' });
    const { id } = req.params;
    const existing = await prisma.achievement.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Conquista não encontrada.' });
    await prisma.achievement.delete({ where: { id } });
    // Quem já tinha desbloqueado essa conquista mantém o registro em
    // UserAchievement (histórico) — só some do catálogo/telas ativas.
    req.app.get('io')?.to('community').emit('achievement:catalog-update');
    res.json({ deleted: true });
  } catch (err) { next(err); }
}

module.exports = {
  listAchievements, adminListAchievements, createAchievement, updateAchievement, uploadAchievementIcon, deleteAchievement,
};
