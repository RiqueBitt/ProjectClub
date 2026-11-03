// Agendador da Fase 4: um único relógio de 1 minuto que chama as tarefas
// (cada uma decide se tem algo pra fazer e se protege contra rodar duas
// vezes com JobRun/RewardGrant — ver common.js). Sem dependência nova.
//
// Cada tarefa tem a própria trava em memória: uma tarefa demorada (ex.: a
// retrospectiva do mês avisando milhares de pessoas) nunca atrasa as outras
// (ex.: o lembrete de 15 minutos do Bora Jogar).
const activity = require('./activity');

const TICK_MS = 60 * 1000;
const HOURLY_EVERY_TICKS = 5; // indicações: confere a cada 5 min (chave por hora)

const JOBS = [
  ['bora-jogar', (o) => require('./playGroups').tick(o)],
  ['clubes', (o) => require('./clanWeekly').closeWeekIfDue(o)],
  ['metas', (o) => require('./communityGoals').closeIfDue(o)],
  ['post-da-semana', (o) => require('./postOfWeek').pickIfDue(o)],
  ['sorteio', (o) => require('./raffle').drawIfDue(o)],
  ['retrospectiva', (o) => require('./monthlyRecap').runIfDue(o)],
];
const HOURLY_JOBS = [
  ['indicacoes', (o) => require('./referrals').hourlyTick(o)],
];

let timer = null;
let ticks = 0;
const running = new Set();

function launch(name, fn, over) {
  if (running.has(name)) return null; // a anterior ainda está rodando: pula este minuto
  running.add(name);
  return Promise.resolve()
    .then(() => fn(over))
    .catch((err) => console.error(`[comunidade:${name}]`, err?.message || err))
    .finally(() => running.delete(name));
}

function tick(io) {
  ticks += 1;
  const over = { io };
  const started = JOBS.map(([name, fn]) => launch(name, fn, over));
  if (ticks % HOURLY_EVERY_TICKS === 1) HOURLY_JOBS.forEach(([name, fn]) => started.push(launch(name, fn, over)));
  try { require('./postOfWeek').refreshCacheIfStale(); } catch { /* selo é só visual */ }
  return Promise.all(started.filter(Boolean));
}

function startCommunityJobs(io) {
  if (timer) return;
  activity.startActivityFlush(io);
  // Metas coletivas: confere a cada gravação do total semanal da comunidade.
  activity.onCommunityWeek((row, over) => require('./communityGoals').checkReached(row, { ...over, io }));
  require('./postOfWeek').refreshCache().catch(() => {});
  timer = setInterval(() => { tick(io); }, TICK_MS);
  timer.unref?.();
  setTimeout(() => { tick(io); }, 30_000).unref?.();
}

module.exports = { startCommunityJobs, tick };
