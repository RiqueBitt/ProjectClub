// Temporadas temáticas (Natal, Ano Novo, Carnaval, Festa Junina, Halloween
// e o aniversário do Project Club).
//
// Mesmas datas do visual sazonal do cliente (client/src/utils/appearance.js
// → SEASONS/seasonForDate) — o servidor sabe qual temporada está valendo pra
// liberar a recompensa diária (DAILY_COINS, uma por pessoa por dia) e a
// conquista da temporada (vem junto com a primeira recompensa).
const { dayKey, dayMonthSP } = require('../../utils/spTime');
const { deps, httpError, economyDisabled } = require('./common');

// Aniversário do Project Club — igual a PROJECT_CLUB_BIRTHDAY no cliente.
const PROJECT_CLUB_BIRTHDAY = { month: 9, day: 20 };

const SEASONS = {
  natal: { label: 'Natal', greeting: 'Boas festas!', when: '1 a 31 de dezembro', dailyCoins: 20, achievement: 'temporada_natal' },
  anonovo: { label: 'Ano Novo', greeting: 'Feliz Ano Novo!', when: '1 a 6 de janeiro', dailyCoins: 25, achievement: 'temporada_anonovo' },
  carnaval: { label: 'Carnaval', greeting: 'Bom Carnaval!', when: 'sábado até quarta de cinzas', dailyCoins: 20, achievement: 'temporada_carnaval' },
  festajunina: { label: 'Festa Junina', greeting: 'Arraiá do Project Club!', when: '1 a 30 de junho', dailyCoins: 15, achievement: 'temporada_festajunina' },
  halloween: { label: 'Halloween', greeting: 'Feliz Halloween!', when: '20 a 31 de outubro', dailyCoins: 20, achievement: 'temporada_halloween' },
  aniversario: { label: 'Aniversário do Project Club', greeting: 'Parabéns, Project Club!', when: '20/09 e os 2 dias seguintes', dailyCoins: 50, achievement: 'temporada_aniversario' },
};

// Domingo de Páscoa (Meeus/Jones/Butcher) — Carnaval termina 46 dias antes.
function easterSunday(year) {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

/** Chave da temporada valendo no dia (Brasília) ou null. */
function seasonForDate(now = Date.now()) {
  const { day: d, month: m, year: y } = dayMonthSP(now);
  if (m === 12) return 'natal';
  if (m === 1 && d <= 6) return 'anonovo';
  if (m === 10 && d >= 20) return 'halloween';
  if (m === 6) return 'festajunina';
  const today = Date.UTC(y, m - 1, d);
  const diffBd = Math.round((today - Date.UTC(y, PROJECT_CLUB_BIRTHDAY.month - 1, PROJECT_CLUB_BIRTHDAY.day)) / 86400000);
  if (diffBd >= 0 && diffBd <= 2) return 'aniversario';
  const diffEaster = Math.round((today - easterSunday(y)) / 86400000);
  if (diffEaster >= -51 && diffEaster <= -46) return 'carnaval';
  return null;
}

async function status(userId, over = {}) {
  const d = deps(over);
  const key = seasonForDate(d.now);
  if (!key) return { season: null };
  const today = dayKey(d.now);
  const [claim, total] = await Promise.all([
    d.db.seasonClaim.findUnique({ where: { userId_dayKey: { userId, dayKey: today } } }),
    d.db.seasonClaim.count({ where: { userId, season: key, dayKey: { startsWith: today.slice(0, 4) } } }),
  ]);
  const s = SEASONS[key];
  return {
    season: { key, label: s.label, greeting: s.greeting, when: s.when, dailyCoins: s.dailyCoins, achievement: s.achievement },
    claimedToday: !!claim, daysClaimed: total,
  };
}

/** Recompensa diária da temporada (uma por pessoa por dia). */
async function claimDaily(userId, over = {}) {
  const d = deps(over);
  const key = seasonForDate(d.now);
  if (!key) throw httpError(400, 'Nenhuma temporada temática está valendo hoje.');
  const s = SEASONS[key];
  const today = dayKey(d.now);
  const coins = (await economyDisabled(d.db)) ? 0 : s.dailyCoins;
  try {
    await d.db.$transaction(async (tx) => {
      await tx.seasonClaim.create({ data: { userId, dayKey: today, season: key, coins } });
      if (coins > 0) await tx.user.update({ where: { id: userId }, data: { coins: { increment: coins } } });
    });
  } catch (err) {
    if (err?.code === 'P2002') throw httpError(409, 'Você já pegou o presente de hoje. Volte amanhã!');
    throw err;
  }
  if (coins > 0) { try { d.ledger(userId, { kind: 'SEASON', label: `Presente do dia: ${s.label}`, coins }); } catch { /* só registro */ } }
  const unlocked = await (over.unlock || require('./secretAchievements').unlock)(userId, s.achievement, d.io, { db: d.db });
  return { coins, season: key, achievementUnlocked: !!unlocked };
}

module.exports = { SEASONS, seasonForDate, status, claimDaily, PROJECT_CLUB_BIRTHDAY };
