// Limite de eventos por conexão de socket (balde de fichas).
//
// Antes não havia limite nenhum: um cliente com defeito (laço infinito) ou
// mal-intencionado podia mandar milhares de eventos por segundo — cada um
// mexendo no Redis/banco — e deixar o servidor lento pra todo mundo.
//
// Cada conexão começa com BURST fichas e ganha RATE por segundo. Cada evento
// gasta uma. Sem ficha, o evento é descartado (o handler não roda). Quem
// continua mandando sem parar depois de esgotar (ABUSE_DROPS descartes em
// ABUSE_WINDOW_MS) é desconectado — o app reconecta sozinho e o balde
// começa cheio de novo, então um pico legítimo nunca tira ninguém da call.
//
// Folga pra uso normal: o início de uma call manda dezenas de candidatos
// ICE (voice:signal) em 1–2 s; falar/calar (voice:speaking) dá poucos por
// segundo; digitando/presença são raros. Tudo isso cabe com sobra.
// Doc: https://socket.io/docs/v4/middlewares/#sending-credentials (socket.use)

const BURST = 150;
const RATE = 40; // fichas por segundo
const ABUSE_DROPS = 400;
const ABUSE_WINDOW_MS = 10_000;

function createEventLimiter({
  burst = BURST, rate = RATE, abuseDrops = ABUSE_DROPS, abuseWindowMs = ABUSE_WINDOW_MS, now = Date.now,
} = {}) {
  let tokens = burst;
  let last = now();
  let drops = 0;
  let windowStart = last;
  // 'ok' | 'drop' | 'abuse'
  return function take() {
    const t = now();
    tokens = Math.min(burst, tokens + ((t - last) / 1000) * rate);
    last = t;
    if (tokens >= 1) {
      tokens -= 1;
      return 'ok';
    }
    if (t - windowStart > abuseWindowMs) { windowStart = t; drops = 0; }
    drops += 1;
    return drops >= abuseDrops ? 'abuse' : 'drop';
  };
}

function defaultReport(socket, kind) {
  const who = socket?.userId || socket?.data?.userId || '?';
  console.warn(`[socket] ${kind === 'abuse' ? 'desconectado por excesso de eventos' : 'eventos acima do limite'} (usuário ${who})`);
  if (kind !== 'abuse') return;
  try {
    require('../services/errorRing').recordError('server', {
      where: 'socket:limite',
      message: `Conexão derrubada por excesso de eventos (usuário ${who})`,
    });
  } catch { /* registrar nunca pode derrubar nada */ }
}

// Instala o limite num socket (uma vez por conexão).
function limitSocketEvents(socket, opts = {}, report = defaultReport) {
  const take = createEventLimiter(opts);
  let warned = false;
  socket.use((packet, next) => {
    const r = take();
    if (r === 'ok') return next();
    if (!warned) { warned = true; report(socket, 'drop'); }
    if (r === 'abuse') {
      report(socket, 'abuse');
      socket.disconnect(true);
    }
    // descarta: não chama next() — o handler do evento não roda
    return undefined;
  });
  return socket;
}

module.exports = { createEventLimiter, limitSocketEvents, BURST, RATE };
