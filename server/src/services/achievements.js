const prisma = require('../config/prisma');
const { ACHIEVEMENTS, DEPRECATED_KEYS } = require('../data/achievementsCatalog');

// Roda UMA vez no boot do servidor (ver src/index.js) — cria no banco
// qualquer conquista do catálogo seed que ainda não existe (por `key`).
// Nunca sobrescreve uma que já existe, então uma edição da staff pelo
// painel (nome, ícone, raridade, meta...) nunca é perdida só por causa
// de um restart do servidor.
async function seedAchievements() {
  for (const def of ACHIEVEMENTS) {
    await prisma.achievement.upsert({
      where: { key: def.key },
      update: {},
      create: def,
    }).catch(() => {});
  }
  // Desativa (não exclui — preserva o histórico de quem já desbloqueou)
  // qualquer conquista de um deploy anterior que não faz mais parte do
  // catálogo atual (ex: as de Casas/Figurinhas, sistemas desligados por
  // padrão). Só mexe se ainda estiver marcada como enabled=true, pra não
  // sobrescrever uma reativação manual que a staff tenha feito de
  // propósito pelo painel.
  await prisma.achievement.updateMany({
    where: { key: { in: DEPRECATED_KEYS }, enabled: true },
    data: { enabled: false },
  }).catch(() => {});
}

// Progresso atual de um usuário num TIPO de condição — várias conquistas
// podem compartilhar o mesmo progressType com metas (target) diferentes
// (ex: "rico"/"magnata"/"bilionario" são todas COINS), então o cálculo
// fica centralizado aqui em vez de repetido por conquista.
async function getProgressByType(userId, progressType) {
  switch (progressType) {
    case 'HOUSES_OWNED':
      return prisma.userHouse.count({ where: { userId } });
    case 'FURNITURE_PLACED':
      return prisma.placedFurniture.count({ where: { userHouse: { userId } } });
    case 'HOUSE_LIKES_RECEIVED':
      return prisma.houseLike.count({ where: { userHouse: { userId } } });
    case 'HOUSE_COMMENTS_RECEIVED':
      return prisma.houseComment.count({ where: { userHouse: { userId } } });
    case 'HOUSE_COMMENTS_GIVEN':
      return prisma.houseComment.count({ where: { authorId: userId } });
    case 'COINS': {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true } });
      return u?.coins || 0;
    }
    case 'GEMS': {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { gems: true } });
      return u?.gems || 0;
    }
    case 'POSTS_CREATED':
      return prisma.post.count({ where: { authorId: userId } });
    case 'POST_UPS_RECEIVED':
      return prisma.postVote.count({ where: { value: 1, post: { authorId: userId } } });
    case 'COMMENTS_CREATED':
      return prisma.postComment.count({ where: { authorId: userId } });
    case 'COMMENT_UPS_RECEIVED':
      return prisma.postCommentVote.count({ where: { value: 1, comment: { authorId: userId } } });
    case 'PROFILE_UPS_RECEIVED':
      return prisma.profileVote.count({ where: { toUserId: userId, value: 1 } });
    case 'FRIENDS_COUNT':
      return prisma.friendship.count({ where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] } });
    case 'ACCOUNT_LEVEL': {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { accountLevel: true } });
      return u?.accountLevel || 1;
    }
    case 'DAILY_STREAK': {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { dailyStreak: true } });
      return u?.dailyStreak || 0;
    }
    default:
      return 0;
  }
}

// Mantido por compatibilidade com quem já chamava getProgress(userId, key)
// — resolve a `key` pra conquista no banco e delega pro cálculo por tipo.
async function getProgress(userId, achievementKey) {
  const def = await prisma.achievement.findUnique({ where: { key: achievementKey } });
  if (!def) return 0;
  return getProgressByType(userId, def.progressType);
}

// `io` é opcional — quando presente, emite pra sala pessoal do usuário
// (`user:<id>`) assim que uma conquista nova é desbloqueada, pra
// aparecer na hora sem precisar recarregar a página.
async function checkAndUnlock(userId, io = null) {
  try {
    const [defs, already] = await Promise.all([
      prisma.achievement.findMany({ where: { enabled: true } }),
      prisma.userAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
    ]);
    const unlockedKeys = new Set(already.map((a) => a.achievementId));
    const newlyUnlocked = [];

    for (const def of defs) {
      if (unlockedKeys.has(def.key)) continue;
      const progress = await getProgressByType(userId, def.progressType);
      if (progress >= def.target) {
        await prisma.userAchievement.create({ data: { userId, achievementId: def.key } }).catch(() => {});
        newlyUnlocked.push(def);
        io?.to(`user:${userId}`).emit('achievement:unlocked', def);
      }
    }
    return newlyUnlocked;
  } catch {
    return [];
  }
}

module.exports = { seedAchievements, getProgress, getProgressByType, checkAndUnlock };
