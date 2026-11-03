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

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountXp: true, accountLevel: true, lastXpMessageAt: true, supporterTier: true } });
  if (user.lastXpMessageAt && Date.now() - user.lastXpMessageAt.getTime() < MESSAGE_COOLDOWN_MS) return null;

  // Bônus de XP de Assinante (+5%) / Super Assinante (+15%).
  const xpGain = require('./supporters').withXpBonus(Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN, user.supporterTier);
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
  require('./community/hooks').onXp(userId, xpGain); // retrospectiva do mês

  if (!levelUp) return null;
  if (newLevelData.coinsReward > 0) {
    require('./economyLedger').recordTransaction(userId, { kind: 'LEVEL', label: `Subiu para o nível ${newLevelData.level}`, coins: newLevelData.coinsReward });
  }
  // Guarda a subida de nível pra aparecer na página "Atividade" dos amigos.
  prisma.activityEvent.create({
    data: { userId, type: 'LEVEL_UP', data: JSON.stringify({ level: newLevelData.level, levelName: newLevelData.name }) },
  }).catch(() => {});
  return { levelUp: true, oldLevel, newLevel: newLevelData.level, newLevelName: newLevelData.name, coinsReward: newLevelData.coinsReward };
}

// XP (e moedas) vindos de outras fontes que não mensagem — ex.: tempo em
// call (services/voiceRewards.js). Mesma regra de nível/recompensa do XP por
// mensagem; não mexe no intervalo anti-flood das mensagens.
async function awardXp(userId, xp, { coins = 0, kind = 'XP', label = 'XP' } = {}) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountXp: true, accountLevel: true, supporterTier: true } });
  if (!user) return null;
  const xpGain = Math.max(0, require('./supporters').withXpBonus(Math.trunc(xp) || 0, user.supporterTier));
  const newXp = user.accountXp + xpGain;
  const lvl = calculateLevel(newXp);
  const levelUp = lvl.level > user.accountLevel;
  const levelCoins = levelUp && lvl.coinsReward > 0 ? lvl.coinsReward : 0;
  await prisma.user.update({
    where: { id: userId },
    data: { accountXp: newXp, accountLevel: lvl.level, ...(coins + levelCoins > 0 ? { coins: { increment: coins + levelCoins } } : {}) },
  });
  const ledger = require('./economyLedger');
  require('./community/hooks').onXp(userId, xpGain); // retrospectiva do mês
  if (coins > 0 || xpGain > 0) ledger.recordTransaction(userId, { kind, label, coins, xp: xpGain });
  if (!levelUp) return { levelUp: false, xp: xpGain, coins };
  if (levelCoins) ledger.recordTransaction(userId, { kind: 'LEVEL', label: `Subiu para o nível ${lvl.level}`, coins: levelCoins });
  prisma.activityEvent.create({ data: { userId, type: 'LEVEL_UP', data: JSON.stringify({ level: lvl.level, levelName: lvl.name }) } }).catch(() => {});
  return { levelUp: true, xp: xpGain, coins, oldLevel: user.accountLevel, newLevel: lvl.level, newLevelName: lvl.name, coinsReward: levelCoins };
}

module.exports = { awardMessageXp, awardXp };
