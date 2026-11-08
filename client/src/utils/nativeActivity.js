// Item pedido: "Rich Presence" (jogo/Spotify) — só existe de verdade no
// app de desktop (Electron), que é o único lugar com acesso ao sistema
// operacional pra detectar isso (ver desktop/activityDetector.js). Esse
// arquivo é só a "última perna" da corrente: escuta o aviso que o
// Electron manda via IPC (window.electronAPI.onActivityDetected, ver
// preload.js) e repassa pro servidor via socket — dali em diante é o
// mesmo sistema de presença/status que todo mundo já usa (ver
// SocketContext.jsx, escutando 'activity:changed').
//
// ECONOMIA DE RECURSOS/REDE:
//  - UM listener de IPC só (antes cada socket novo — login, troca de
//    conta — somava mais um, e os antigos seguiam emitindo num socket já
//    desconectado, que guarda tudo num buffer pra sempre).
//  - Só manda quando a atividade MUDA (o Spotify era reenviado a cada 2s
//    mesmo tocando a mesma música); uma reconfirmação leve a cada ~6s
//    mantém a atividade viva no servidor (que expira em 8s — ver
//    server/src/services/activityStore.js).
//  - Ao reconectar, reenvia a atual (o servidor pode ter perdido).
let currentSocket = null;
let installed = false;
let last; // undefined = nada detectado ainda; null = sem atividade
let lastSentAt = 0;

function changed(prev, next) {
  if (!prev || !next) return prev !== next;
  if (prev.type !== next.type || prev.name !== next.name || prev.detail !== next.detail
    || prev.imageUrl !== next.imageUrl || prev.durationMs !== next.durationMs
    || (prev.playingGame?.name || null) !== (next.playingGame?.name || null)) return true;
  if (next.type !== 'spotify' || !Number.isFinite(prev.progressMs) || !Number.isFinite(next.progressMs)) return false;
  // Pausou/pulou/voltou a música: o progresso não bate com o tempo passado.
  return Math.abs(next.progressMs - (prev.progressMs + (next.startedAt - prev.startedAt))) >= 2500;
}

function send() {
  if (last === undefined || !currentSocket?.connected) return;
  currentSocket.emit('activity:update', last);
  lastSentAt = Date.now();
}

export function setupNativeActivity(socket) {
  if (typeof window === 'undefined' || !window.electronAPI?.onActivityDetected) return; // web comum/Android — não existe nada pra escutar aqui

  currentSocket = socket;
  socket?.on('connect', () => { if (currentSocket === socket) send(); });
  if (installed) return;
  installed = true;

  window.electronAPI.onActivityDetected((activity) => {
    const next = activity || null;
    if (last !== undefined && !changed(last, next)) return;
    last = next;
    send();
  });
  setInterval(() => {
    if (last && Date.now() - lastSentAt >= 5500) send();
  }, 6000);
}
