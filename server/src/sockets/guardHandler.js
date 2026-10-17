// Rede de segurança por evento de socket.
//
// Vários handlers `socket.on('x', async (...) => {...})` fazem await fora de
// try/catch (Redis/banco fora do ar por um instante, ou um cliente mandando
// o evento sem payload — `({ channelId }) => ...` com `undefined` lança
// TypeError na hora). O socket.io não trata a promessa devolvida pelo
// handler, então isso virava "[unhandledRejection]" sem dizer QUAL evento
// falhou — e um erro síncrono subia até o 'uncaughtException' do processo.
//
// guardSocketHandler embrulha o handler: erro síncrono ou promessa rejeitada
// fica registrado com o nome do evento (aba Saúde do painel, via errorRing)
// e não escapa do evento. O comportamento de quem não dá erro é o mesmo.
// Doc do Node sobre rejeições sem tratamento:
// https://nodejs.org/api/process.html#event-unhandledrejection

function defaultReport(event, err) {
  console.error(`[socket] evento "${event}" falhou:`, err?.message || err);
  try {
    require('../services/errorRing').recordError('server', {
      where: `socket:${String(event).slice(0, 40)}`,
      message: err?.message || String(err),
      stack: err?.stack,
    });
  } catch { /* registrar o erro nunca pode derrubar nada */ }
}

function guardSocketHandler(event, handler, report = defaultReport) {
  if (typeof handler !== 'function') return handler;
  return function guarded(...args) {
    try {
      const out = handler.apply(this, args);
      if (out && typeof out.then === 'function') {
        return out.then(undefined, (err) => { report(event, err); });
      }
      return out;
    } catch (err) {
      report(event, err);
      return undefined;
    }
  };
}

// Troca socket.on/socket.once DESTE socket por versões que embrulham o
// handler. Feito uma vez por conexão, antes de registrar os eventos.
function guardSocket(socket, report = defaultReport) {
  if (!socket || socket.__pcGuarded) return socket;
  for (const method of ['on', 'once']) {
    const original = socket[method];
    if (typeof original !== 'function') continue;
    socket[method] = function guardedRegister(event, handler) {
      return original.call(this, event, guardSocketHandler(event, handler, report));
    };
  }
  Object.defineProperty(socket, '__pcGuarded', { value: true, enumerable: false });
  return socket;
}

module.exports = { guardSocketHandler, guardSocket };
