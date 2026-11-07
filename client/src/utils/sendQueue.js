// Fila offline do chat.
//
// Mensagem que não chegou ao servidor por falta de conexão (sem internet,
// Wi-Fi oscilando, o site reiniciando no deploy — 502/503/504) não vira
// mais "falhou ao enviar": fica na fila com "Enviando quando a conexão
// voltar…" e é reenviada sozinha, NA ORDEM, quando a conexão volta (evento
// `online` do navegador ou o socket reconectando). O reenvio usa o MESMO
// nonce — o servidor reconhece e nunca duplica (ver
// server/src/services/messageIdempotency.js).
//
// Erros de validação (4xx: sem permissão, AutoMod, arquivo grande demais…)
// continuam como antes: "falhou", com "Tentar de novo" manual.
//
// Cada item tem `run()`, que tenta enviar e devolve 'ok' | 'retry' | 'fail'.
// A fila só guarda o que está esperando a conexão — vive na memória da
// aba (anexos incluídos, como File); fechar a aba avisa antes de perder.

// Classifica o erro de um envio (axios): 'retry' (rede/servidor fora),
// 'canceled' (a pessoa cancelou o upload) ou 'fail' (o servidor recusou).
export function classifySendError(err) {
  if (!err) return 'fail';
  if (err.code === 'ERR_CANCELED' || err.name === 'CanceledError' || err.name === 'AbortError') return 'canceled';
  const status = err.response?.status;
  if (!err.response || !status) return 'retry'; // sem resposta: rede caiu / offline / timeout
  if (status === 408 || status === 502 || status === 503 || status === 504) return 'retry';
  return 'fail';
}

const queue = []; // [{ id, run, roomKey }]
const listeners = new Set();
let flushing = false;
let retryTimer = null;
const RETRY_EVERY_MS = 15000;

function notify() {
  listeners.forEach((fn) => { try { fn(queue.length); } catch { /* ignora */ } });
}

export function queuedCount() { return queue.length; }
export function isQueued(id) { return queue.some((q) => q.id === id); }
export function hasQueuedFor(roomKey) { return queue.some((q) => q.roomKey === roomKey); }
export function onQueueChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Põe na fila (no fim, mantendo a ordem de envio) e agenda novas tentativas.
export function enqueueSend(id, run, roomKey = null) {
  const existing = queue.find((q) => q.id === id);
  if (existing) { existing.run = run; return; }
  queue.push({ id, run, roomKey });
  notify();
  scheduleRetry();
}

export function dequeueSend(id) {
  const i = queue.findIndex((q) => q.id === id);
  if (i >= 0) { queue.splice(i, 1); notify(); }
}

function scheduleRetry() {
  if (retryTimer || !queue.length) return;
  // Rede de segurança: mesmo sem evento nenhum (servidor voltou do deploy
  // sem o navegador perceber), tenta de novo de tempos em tempos.
  retryTimer = setTimeout(() => { retryTimer = null; flushSendQueue(); }, RETRY_EVERY_MS);
}

// Reenvia a fila, um de cada vez, na ordem. Para no primeiro que ainda
// não conseguiu (a conexão não voltou de verdade) e tenta mais tarde.
export async function flushSendQueue() {
  if (flushing || !queue.length) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { scheduleRetry(); return; }
  flushing = true;
  try {
    while (queue.length) {
      const item = queue[0];
      let result = 'fail';
      try { result = await item.run(); } catch { result = 'fail'; }
      if (result === 'retry') break;
      if (queue[0] === item) queue.shift();
      else dequeueSend(item.id);
      notify();
    }
  } finally {
    flushing = false;
    scheduleRetry();
  }
}

// Liga os gatilhos (MainApp): `online`, socket reconectando e aviso ao
// fechar a aba com mensagens ainda na fila. Devolve a função de desligar.
export function startSendQueue(socket) {
  if (typeof window === 'undefined') return () => {};
  const onOnline = () => { flushSendQueue(); };
  const onConnect = () => { flushSendQueue(); };
  const onBeforeUnload = (e) => {
    if (!queue.length) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('beforeunload', onBeforeUnload);
  socket?.on?.('connect', onConnect);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('beforeunload', onBeforeUnload);
    socket?.off?.('connect', onConnect);
  };
}

// Só pros testes.
export function _resetSendQueue() {
  queue.length = 0;
  flushing = false;
  clearTimeout(retryTimer);
  retryTimer = null;
}
