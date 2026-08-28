const prisma = require('../config/prisma');
const { calculateLevel } = require('../data/levelsCatalog');

const XP_MIN = 25;
const XP_MAX = 35;
const MESSAGE_COOLDOWN_MS = 30 * 1000;
const MIN_LENGTH = 4;
const MIN_WORDS = 2;

function meaningfulContent(content) {
  return (content || '')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/@everyone|@here/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Concede XP por mensagem de canal — versão simplificada do anti-farm
// original (mantém cooldown + tamanho/qualidade mínima; a detecção de
// flood/repetição do bot original foi omitida nesta fase para manter o
// escopo gerenciável). Retorna { levelUp, oldLevel, newLevel, reward } ou
// null se a mensagem não qualificar pra ganhar XP.
async function awardMessageXp(userId, content) {
  const meaningful = meaningfulContent(content);
  if (meaningful.length < MIN_LENGTH) return null;
  if (meaningful.split(' ').filter(Boolean).length < MIN_WORDS) return null;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountXp: true, accountLevel: true, lastXpMessageAt: true } });
  if (user.lastXpMessageAt && Date.now() - user.lastXpMessageAt.getTime() < MESSAGE_COOLDOWN_MS) return null;

  const xpGain = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;
  const newXp = user.accountXp + xpGain;
  const newLevelData = calculateLevel(newXp);
  const oldLevel = user.accountLevel;
  const levelUp = newLevelData.level > oldLevel;

  await prisma.user.update({
    where: { id: userId },
    data: {
      accountXp: newXp,
      accountLevel: newLevelData.level,
      lastXpMessageAt: new Date(),
      ...(levelUp && newLevelData.coinsReward > 0 ? { coins: { increment: newLevelData.coinsReward } } : {}),
    },
  });

  if (!levelUp) return null;
  return { levelUp: true, oldLevel, newLevel: newLevelData.level, newLevelName: newLevelData.name, coinsReward: newLevelData.coinsReward };
}

module.exports = { awardMessageXp };
