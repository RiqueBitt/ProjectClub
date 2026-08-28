const http = require('http');
const createApp = require('./app');
const { initSockets } = require('./sockets');
const env = require('./config/env');
const { bootstrapPlatformAdmin, backfillPollTopicPermissions } = require('./services/adminBootstrap');
const { seedAchievements } = require('./services/achievements');
const voiceStore = require('./services/voiceRoomStore');

// Last-resort safety net: without these, a single unawaited/uncaught error
// ANYWHERE in the process (a stray promise in a socket handler, a timer
// callback, a third-party lib) takes the entire server down and disconnects
// every single user at once — for a chat app that's the worst possible
// failure mode. Logging and staying up beats a hard crash here; every
// request/socket-handler code path in this codebase already has its own
// try/catch or .catch() for the errors it expects, so anything reaching
// this point is already an unexpected edge case being handled defensively,
// not a substitute for fixing bugs at the source.
process.on('unhandledRejection', (reason) => {
  console.error('\x1b[31m[unhandledRejection]\x1b[0m', reason);
});
process.on('uncaughtException', (err) => {
  console.error('\x1b[31m[uncaughtException]\x1b[0m', err);
});

const app = createApp();
const httpServer = http.createServer(app);
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
});

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
