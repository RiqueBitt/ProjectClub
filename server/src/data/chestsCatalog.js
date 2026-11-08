// Baús do /daily — adaptado 1:1 de config/chests.json do bot Robbie.
// chance_regular/chance_subscriber somam ~1 cada (seleção por peso, ver
// selectChest em services/economy.js). Mega Baú (streak) simplificado na
// fase 1: dá gemas direto em vez do sistema completo de item-por-raridade.
const DAILY_CHESTS = [
  { name: 'Comum', chanceRegular: 0.30, chanceSubscriber: 0.10, coinsMin: 10, coinsMax: 20, ticketsMin: 1, ticketsMax: 2, imageClosed: 'https://i.imgur.com/un0og6i.png?size=100', imageOpened: 'https://i.imgur.com/o0zbAHG.png?size=100' },
  { name: 'Épico', chanceRegular: 0.18, chanceSubscriber: 0.38, coinsMin: 35, coinsMax: 40, ticketsMin: 5, ticketsMax: 6, imageClosed: 'https://i.imgur.com/tFN16Z2.png?size=100', imageOpened: 'https://i.imgur.com/qYLbrq3.png?size=100' },
  { name: 'Mítico', chanceRegular: 0.10, chanceSubscriber: 0.28, coinsMin: 45, coinsMax: 50, ticketsMin: 7, ticketsMax: 8, imageClosed: 'https://i.imgur.com/fCTgVXW.png?size=100', imageOpened: 'https://i.imgur.com/GCeOBHr.png?size=100' },
  { name: 'Lendário', chanceRegular: 0.08, chanceSubscriber: 0.18, coinsMin: 55, coinsMax: 60, ticketsMin: 9, ticketsMax: 10, imageClosed: 'https://i.imgur.com/TCO2F2Y.png?size=100', imageOpened: 'https://i.imgur.com/6N8CoIk.png?size=100' },
  { name: 'Ultra Lendário', chanceRegular: 0.05, chanceSubscriber: 0.10, coinsMin: 65, coinsMax: 70, ticketsMin: 11, ticketsMax: 12, imageClosed: 'https://i.imgur.com/wiNVMUT.png?size=100', imageOpened: 'https://i.imgur.com/aR9ryyh.png?size=100' },
  { name: 'Baú Raro', chanceRegular: 0.10, chanceSubscriber: 0.10, coinsMin: 10, coinsMax: 20, ticketsMin: 0, ticketsMax: 0 },
];

const MEGA_CHEST_STREAK_REQUIRED = 5;
const MEGA_CHEST_GEMS_MIN = 1;
const MEGA_CHEST_GEMS_MAX = 6;

module.exports = { DAILY_CHESTS, MEGA_CHEST_STREAK_REQUIRED, MEGA_CHEST_GEMS_MIN, MEGA_CHEST_GEMS_MAX };
