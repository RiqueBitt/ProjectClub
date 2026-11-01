// Retransmissão do "está falando" (anel verde) com limite: só repassa
// quando o valor MUDA e no máximo 1 vez a cada `minIntervalMs` (250ms ≈
// 4/s) por pessoa+canal. Se mudar de novo dentro da janela, o ÚLTIMO valor
// sai no fim dela — o estado final nunca se perde (senão o anel podia ficar
// aceso pra sempre). Antes cada pacote do cliente virava um broadcast pra
// comunidade inteira + uma escrita no Redis.
function createSpeakingRelay({ minIntervalMs = 250, send, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let last = null; // último valor enviado
  let lastAt = -Infinity;
  let pending = null; // valor esperando a janela abrir
  let timer = null;

  const flush = () => {
    timer = null;
    if (pending === null) return;
    const v = pending;
    pending = null;
    if (v === last) return;
    last = v; lastAt = now();
    send(v);
  };

  return {
    push(value) {
      const v = !!value;
      const effective = pending !== null ? pending : last;
      if (v === effective) return false; // não mudou
      const t = now();
      if (t - lastAt >= minIntervalMs && pending === null) {
        last = v; lastAt = t;
        send(v);
        return true;
      }
      pending = v;
      if (!timer) {
        timer = setTimer(flush, Math.max(0, minIntervalMs - (t - lastAt)));
        timer?.unref?.();
      }
      return false;
    },
    dispose() { if (timer) clearTimer(timer); timer = null; pending = null; },
    get last() { return last; },
  };
}

module.exports = { createSpeakingRelay };
