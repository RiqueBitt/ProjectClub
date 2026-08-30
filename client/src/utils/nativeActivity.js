// Item pedido: "Rich Presence" (jogo/Spotify) — só existe de verdade no
// app de desktop (Electron), que é o único lugar com acesso ao sistema
// operacional pra detectar isso (ver desktop/activityDetector.js). Esse
// arquivo é só a "última perna" da corrente: escuta o aviso que o
// Electron manda via IPC (window.electronAPI.onActivityDetected, ver
// preload.js) e repassa pro servidor via socket — dali em diante é o
// mesmo sistema de presença/status que todo mundo já usa (ver
// SocketContext.jsx, escutando 'activity:changed').
export function setupNativeActivity(socket) {
  if (typeof window === 'undefined' || !window.electronAPI?.onActivityDetected) return; // web comum/Android — não existe nada pra escutar aqui

  window.electronAPI.onActivityDetected((activity) => {
    socket?.emit('activity:update', activity);
  });
}
