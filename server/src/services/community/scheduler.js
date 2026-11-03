// Agendador da Fase 4: um único relógio de 1 minuto que chama as tarefas
// (cada uma decide se tem algo pra fazer e se protege contra rodar duas
// vezes com JobRun/RewardGrant — ver common.js). Sem dependência nova.
const activity = require('./activity');

const TICK_MS = 60 * 1000;
const HOURLY_EVERY_TICKS = 5; // indicações/padrinhos: confere a cada 5 min (chave por hora)

let timer = null;
let ticks = 0;
let running = false;

async function runSafe(name, fn) {
  try { await fn(); } catch (err) { console.error(`[comunidade:${name}]`, err?.message || err); }
}

async function tick(io) {
  if (running) return; // tarefa anterior ainda rodando (banco lento): pula este minuto
  running = true;
  ticks += 1;
  const over = { io };
  try {
    await runSafe('bora-jogar', () => require('./playGroups').tick(over));
    await runSafe('clubes', () => require('./clanWeekly').closeWeekIfDue(over));
    await runSafe('metas', () => require('./communityGoals').closeIfDue(over));
    await runSafe('post-da-semana', () => require('./postOfWeek').pickIfDue(over));
    await runSafe('sorteio', () => require('./raffle').drawIfDue(over));
    await runSafe('retrospectiva', () => require('./monthlyRecap').runIfDue(over));
    await runSafe('aniversarios', () => require('./birthdays').runIfDue(over));
    require('./postOfWeek').refreshCacheIfStale();
    if (ticks % HOURLY_EVERY_TICKS === 1) {
      await runSafe('indicacoes', () => require('./referrals').hourlyTick(over));
      await runSafe('padrinhos', () => require('./mentors').hourlyTick(over));
    }
  } finally {
    running = false;
  }
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
