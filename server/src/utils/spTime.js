// Datas no horário de Brasília (America/Sao_Paulo, UTC-3 fixo desde 2019,
// sem horário de verão) — chaves de dia, semana e mês usadas pelos sistemas
// da Fase 4 (competição dos Clubes, metas coletivas, sorteio, retrospectiva).
//
// Mesma regra de semana de services/minigameWeekly.js (segunda 00:00 até
// domingo 23:59, chave ISO "AAAA-Www"), só que sem depender do Prisma — dá
// pra usar e testar sem banco.
const OFFSET_MS = -3 * 3600 * 1000; // Brasília
const DAY_MS = 86400000;

// "Relógio local" de Brasília num Date em UTC deslocado.
const local = (now) => new Date(new Date(now).getTime() + OFFSET_MS);
const toUtc = (localMs) => new Date(localMs - OFFSET_MS);
const pad = (n) => String(n).padStart(2, '0');

/** "AAAA-MM-DD" do dia em Brasília. */
function dayKey(now = Date.now()) {
  return local(now).toISOString().slice(0, 10);
}

/** Hora (0–23) em Brasília. */
function hourSP(now = Date.now()) {
  return local(now).getUTCHours();
}

/** { day, month } (1–12) em Brasília — nunca ano. */
function dayMonthSP(now = Date.now()) {
  const l = local(now);
  return { day: l.getUTCDate(), month: l.getUTCMonth() + 1, year: l.getUTCFullYear() };
}

/** Semana (segunda 00:00 Brasília) que contém `now`: { key, start, end }. */
function weekBounds(now = Date.now()) {
  const l = local(now);
  const dow = (l.getUTCDay() + 6) % 7; // 0 = segunda
  const startLocal = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate() - dow);
  const start = toUtc(startLocal);
  const end = new Date(start.getTime() + 7 * DAY_MS);
  const thu = new Date(startLocal + 3 * DAY_MS);
  const y = thu.getUTCFullYear();
  const jan4 = Date.UTC(y, 0, 4);
  const jan4dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Start = jan4 - jan4dow * DAY_MS;
  const week = Math.floor((startLocal - week1Start) / (7 * DAY_MS)) + 1;
  return { key: `${y}-W${pad(week)}`, start, end };
}

function previousWeekBounds(now = Date.now()) {
  return weekBounds(weekBounds(now).start.getTime() - DAY_MS);
}

/** Mês em Brasília: { key: "AAAA-MM", start, end, year, month }. */
function monthBounds(now = Date.now()) {
  const l = local(now);
  const y = l.getUTCFullYear();
  const m = l.getUTCMonth();
  const start = toUtc(Date.UTC(y, m, 1));
  const end = toUtc(Date.UTC(y, m + 1, 1));
  return { key: `${y}-${pad(m + 1)}`, start, end, year: y, month: m + 1 };
}

function previousMonthBounds(now = Date.now()) {
  return monthBounds(monthBounds(now).start.getTime() - DAY_MS);
}

const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function monthName(key) {
  const m = Number(String(key || '').slice(5, 7));
  return MONTH_NAMES[m - 1] || '';
}

module.exports = { dayKey, hourSP, dayMonthSP, weekBounds, previousWeekBounds, monthBounds, previousMonthBounds, monthName, MONTH_NAMES, DAY_MS };
