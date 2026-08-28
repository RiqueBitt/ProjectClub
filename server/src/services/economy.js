const prisma = require('../config/prisma');
const { MEGA_CHEST_STREAK_REQUIRED, MEGA_CHEST_GEMS_MIN, MEGA_CHEST_GEMS_MAX } = require('../data/chestsCatalog');

const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STREAK_GRACE_MS = 48 * 60 * 60 * 1000;

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Baús diários — lidos do banco (staff edita em Admin → Economia →
// Baús diários; ver seed.js pros valores iniciais, extraídos 1:1 do
// config/chests.json original do bot Robbie).
async function selectChest() {
  const chests = await prisma.dailyChest.findMany({ where: { enabled: true }, orderBy: { position: 'asc' } });
  if (chests.length === 0) return null;
  const random = Math.random();
  let cumulative = 0;
  for (const chest of chests) {
    cumulative += chest.chanceRegular;
    if (random <= cumulative) return chest;
  }
  return chests[chests.length - 1];
}

async function claimDaily(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const now = Date.now();
  const lastDaily = user.lastDailyAt ? user.lastDailyAt.getTime() : 0;

  if (lastDaily && now - lastDaily < DAILY_COOLDOWN_MS) {
    const nextAt = new Date(lastDaily + DAILY_COOLDOWN_MS);
    const err = new Error('Você já resgatou a recompensa diária hoje.');
    err.status = 400;
    err.nextAt = nextAt;
    throw err;
  }

  const chest = await selectChest();
  if (!chest) { const e = new Error('Nenhum baú diário configurado.'); e.status = 400; throw e; }
  const coins = randInt(chest.coinsMin, chest.coinsMax);
  const tickets = randInt(chest.ticketsMin, chest.ticketsMax);

  let streak = user.dailyStreak || 0;
  streak = (lastDaily && now - lastDaily <= STREAK_GRACE_MS) ? streak + 1 : 1;
  let earnedMegaGems = 0;
  let megaAwarded = false;
  if (streak >= MEGA_CHEST_STREAK_REQUIRED) {
    earnedMegaGems = randInt(MEGA_CHEST_GEMS_MIN, MEGA_CHEST_GEMS_MAX);
    megaAwarded = true;
    streak = 0;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      coins: { increment: coins },
      dailyStreak: streak,
      gems: { increment: earnedMegaGems },
      lastDailyAt: new Date(now),
    },
    select: { coins: true, gems: true, dailyStreak: true },
  });

  return {
    chestName: chest.name, chestImageClosed: chest.imageClosed, chestImageOpened: chest.imageOpened,
    coins, tickets, streak, streakRequired: MEGA_CHEST_STREAK_REQUIRED,
    megaAwarded, megaGems: earnedMegaGems, balance: updated,
  };
}

module.exports = { DAILY_COOLDOWN_MS, claimDaily };
