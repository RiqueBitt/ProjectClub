// Partes puras do "arrastar pra responder" (ver useSwipeToReply.js).

export const SWIPE_REPLY_THRESHOLD = 60; // px arrastados pra direita pra responder
export const SWIPE_REPLY_MAX = 96; // até onde a mensagem acompanha o dedo
export const SWIPE_SLOP = 10; // movimento mínimo antes de decidir a direção
export const SWIPE_EDGE = 28; // começo colado na borda esquerda = gesto da gaveta (useMobileGestures)

// Decide pra onde o gesto vai: null (ainda não sabe), 'x' (arrastar pra
// direita — responder) ou 'y' (rolagem, ou pra esquerda: não é com a gente).
export function swipeAxis(dx, dy, slop = SWIPE_SLOP) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < slop) return null;
  if (dx > 0 && ax > ay * 1.5) return 'x';
  return 'y';
}

// Quanto a mensagem anda na tela: segue o dedo até o limite e depois
// "pesa" (resistência), nunca passando do máximo.
export function swipeOffset(dx, threshold = SWIPE_REPLY_THRESHOLD, max = SWIPE_REPLY_MAX) {
  if (!(dx > 0)) return 0;
  if (dx <= threshold) return dx;
  return Math.min(max, threshold + (dx - threshold) * 0.35);
}

export function swipeProgress(dx, threshold = SWIPE_REPLY_THRESHOLD) {
  if (!(dx > 0)) return 0;
  return Math.min(1, dx / threshold);
}

export function swipeShouldReply(dx, threshold = SWIPE_REPLY_THRESHOLD) {
  return dx >= threshold;
}
