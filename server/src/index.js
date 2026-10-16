const http = require('http');
const createApp = require('./app');
const { initSockets } = require('./sockets');
const env = require('./config/env');
const { bootstrapPlatformAdmin, backfillPollTopicPermissions } = require('./services/adminBootstrap');
const { seedAchievements } = require('./services/achievements');
const missions = require('./services/missions');
const voiceStore = require('./services/voiceRoomStore');
const { checkB2 } = require('./services/b2HealthCheck');

// Last-resort safety net: without these, a single unawaited/uncaught error
// ANYWHERE in the process (a stray promise in a socket handler, a timer
// callback, a third-party lib) takes the entire server down and disconnects
// every single user at once — for a chat app that's the worst possible
// failure mode. Logging and staying up beats a hard crash here; every
// request/socket-handler code path in this codebase already has its own
// try/catch or .catch() for the errors it expects, so anything reaching
// this point is already an unexpected edge case being handled defensively,
// not a substitute for fixing bugs at the source.
const { recordError } = require('./services/errorRing');
process.on('unhandledRejection', (reason) => {
  console.error('\x1b[31m[unhandledRejection]\x1b[0m', reason);
  recordError('process', { where: 'unhandledRejection', message: reason?.message || String(reason), stack: reason?.stack });
});
process.on('uncaughtException', (err) => {
  console.error('\x1b[31m[uncaughtException]\x1b[0m', err);
  recordError('process', { where: 'uncaughtException', message: err?.message || String(err), stack: err?.stack });
});

const app = createApp();
const httpServer = http.createServer(app);
// Conexões keep-alive: o proxy da hospedagem reaproveita a conexão por até
// ~60s; se o Node fechar antes (padrão dele: 5s), o proxy às vezes manda a
// próxima requisição numa conexão que acabou de fechar → 502 aleatório.
// headersTimeout precisa ser MAIOR que keepAliveTimeout.
httpServer.keepAliveTimeout = 65_000;
httpServer.headersTimeout = 66_000;
const io = initSockets(httpServer);
app.set('io', io);

// A small hand-rolled ANSI palette instead of pulling in a color library —
// this is the only place in the whole server that cares about pretty
// terminal output, doesn't justify a new dependency. `NO_COLOR`/non-TTY
// output (e.g. piped into a log file, or a host that doesn't support ANSI)
// falls back to plain text automatically.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s);
const dim = (s) => c('2', s);
const orange = (s) => c('38;5;209', s);
const green = (s) => c('32', s);
const cyan = (s) => c('36', s);

httpServer.listen(env.PORT, () => {
  const url = `http://localhost:${env.PORT}`;
  const lines = [
    `${bold(orange('Project Club'))} ${dim('— servidor rodando')}`,
    '',
    `  ${dim('Ambiente')}   ${env.NODE_ENV === 'production' ? green(env.NODE_ENV) : cyan(env.NODE_ENV)}`,
    `  ${dim('Endereço')}   ${cyan(url)}`,
    `  ${dim('WebSocket')}  ${green('conectado')}`,
  ];
  const width = Math.max(...lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').length)) + 2;
  const top = `┌${'─'.repeat(width)}┐`;
  const bottom = `└${'─'.repeat(width)}┘`;
  console.log(dim(top));
  lines.forEach((l) => console.log(dim('│ ') + l));
  console.log(dim(bottom));
  checkB2().catch(() => {});
  // Textos antigos salvos no banco com o nome "Arena de Cartas".
  require('./services/renameCardGame').renameCardGame();
  // Apps do ecossistema (WaveProject, TexelProject...) na aba Apps.
  { const apps = require('./services/builtinApps'); apps.seedBuiltinApps().then(() => apps.rebrandLegacyApps()).then(() => apps.applyAppPages()); }
});

// Item pedido: "encontre uma solução para manter a sessão do usuário
// ativa mesmo após atualizações... toda vez que o sistema é
// atualizado, todos acabam sendo desconectados" — causa raiz real:
// sem nenhum tratamento de SIGTERM, o processo Node morria na hora
// exata em que o deploy mata a versão antiga pra subir a nova
// (comportamento padrão do Node pra SIGTERM sem handler nenhum) — se
// alguém tivesse uma requisição em andamento nesse instante (o caso
// mais grave: POST /api/auth/refresh, que já roda a atualização no
// banco ANTES de mandar a resposta — ver authController.refresh),
// essa requisição era cortada NO MEIO: o token antigo já tinha sido
// marcado como revogado no banco, mas a resposta com o cookie novo
// nunca chegava a sair — a pessoa ficava com um cookie "morto" sem
// nunca ter recebido o substituto, e o próximo carregamento da
// página caía direto na tela de login.
//
// httpServer.close() já faz exatamente o que precisa nativamente:
// para de aceitar conexões NOVAS, mas deixa as que já estão em
// andamento terminarem normalmente — só espera até 15s (tempo de
// sobra pra qualquer requisição real terminar) antes de forçar a
// saída, pra nunca travar o deploy indefinidamente se alguma conexão
// ficar presa por outro motivo.
function gracefulShutdown(signal) {
  console.log(dim(`\n[${signal}] recebido — fechando conexões em andamento antes de sair...`));
  const forceExitTimer = setTimeout(() => {
    console.error('\x1b[31m[shutdown]\x1b[0m tempo limite atingido — saindo à força.');
    process.exit(1);
  }, 15000);
  forceExitTimer.unref();
  io.close(); // fecha os sockets também, senão eles podem segurar o servidor aberto indefinidamente
  httpServer.close(() => {
    clearTimeout(forceExitTimer);
    console.log(dim('[shutdown] todas as conexões em andamento terminaram — saindo.'));
    process.exit(0);
  });
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Fire-and-forget: doesn't block the server from accepting connections, and
// PLATFORM_ADMIN_EMAIL is unset by default so this is a no-op for most deploys.
bootstrapPlatformAdmin().catch((err) => {
  console.error('\x1b[31m[admin-bootstrap]\x1b[0m falhou:', err.message);
});
backfillPollTopicPermissions().catch((err) => {
  console.error('\x1b[31m[admin-bootstrap]\x1b[0m backfill de permissões falhou:', err.message);
});
// Cria no banco as conquistas do catálogo seed que ainda não existem —
// ver comentário completo em services/achievements.js. Fire-and-forget,
// não trava o servidor aceitar conexões.
seedAchievements().catch((err) => {
  console.error('\x1b[31m[achievements-seed]\x1b[0m falhou:', err.message);
});
// BUG CORRIGIDO ("áudio não funciona em lugar nenhum"): limpa toda sala de
// voz que ainda esteja no Redis de um restart/deploy anterior — ver o
// comentário completo em voiceRoomStore.clearAllRooms(). Roda uma vez a
// cada boot, o mais cedo possível: nenhuma sala de voz que exista nesse
// momento pode ser válida (nenhuma conexão de socket sobrevive a um
// restart do processo), então começar do zero é sempre seguro e sempre
// correto — nunca apaga uma chamada de verdade que esteja rolando agora.
voiceStore.clearAllRooms().catch((err) => {
  console.error('\x1b[31m[voice-store]\x1b[0m limpeza no boot falhou:', err.message);
});
// Missões (Economia): cria as missões padrão se a tabela estiver vazia e
// liga a contagem de minutos em call (1x por minuto, só sockets locais).
missions.seedDefaultMissions().catch((err) => {
  console.error('\x1b[31m[missões]\x1b[0m seed falhou:', err.message);
});
missions.startVoiceMinutesTicker(io);
// Cadeia de provedores de voz: a cada minuto soma os participantes ativos
// ao provedor ATIVO daquele minuto (voiceusage:YYYY-MM:<provedor>), o que
// permite a troca automática Agora → LiveKit → ... → Jitsi por limite
// mensal gratuito (ver services/voiceUsage.js e services/voiceDecision.js).
require('./services/voiceCredentials').load();
require('./services/voiceUsage').startProviderUsageTicker(io);
// Lembrete de evento 15 min antes pra quem respondeu "Eu vou".
require('./services/eventReminders').startEventReminders(io);
// Faxina diária do banco (tokens vencidos, avisos lidos antigos, ErrorLog
// velho...) — 5 min depois do boot e depois a cada 24h. Ver cleanupJobs.js.
require('./services/cleanupJobs').startCleanupJobs();
