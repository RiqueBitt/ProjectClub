// Balde de fichas simples (por socket/por evento): `capacity` fichas no
// máximo, repostas a `refillPerSec` por segundo. Cada evento gasta uma;
// sem ficha, o evento é ignorado em silêncio. Barra flood de eventos
// baratos de mandar (typing, presence:set, voice:signal) sem atrapalhar
// uso normal.
function createTokenBucket({ capacity, refillPerSec, now = () => Date.now() }) {
  let tokens = capacity;
  let last = now();
  return function take() {
    const t = now();
    tokens = Math.min(capacity, tokens + ((t - last) / 1000) * refillPerSec);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

module.exports = { createTokenBucket };
