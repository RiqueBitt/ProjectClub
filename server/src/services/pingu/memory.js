// Memória curta do Pingu: as 2 últimas trocas (pergunta → resposta) de cada
// pessoa em cada canal/DM, por 10 minutos, SÓ em memória (nunca vai pro
// banco). Serve pra continuar o assunto: "e o outro?", "explica melhor".
const MAX_TURNS = 2;
const TTL_MS = 10 * 60 * 1000;
const MAX_KEYS = 5000;
const MAX_Q = 240;
const MAX_A = 320;

function createMemory({ now = () => Date.now(), ttlMs = TTL_MS, maxTurns = MAX_TURNS } = {}) {
  const map = new Map(); // `${userId}:${roomId}` → [{ q, a, at }]
  const key = (userId, roomId) => `${userId}:${roomId}`;
  const fresh = (list) => (list || []).filter((x) => now() - x.at < ttlMs);
  return {
    remember(userId, roomId, q, a) {
      if (!userId || !roomId || !q || !a) return;
      const k = key(userId, roomId);
      const list = fresh(map.get(k));
      list.push({ q: String(q).slice(0, MAX_Q), a: String(a).slice(0, MAX_A), at: now() });
      map.delete(k);
      map.set(k, list.slice(-maxTurns));
      while (map.size > MAX_KEYS) map.delete(map.keys().next().value);
    },
    /** Trocas ainda válidas (mais antiga primeiro). */
    recall(userId, roomId) {
      const k = key(userId, roomId);
      const list = fresh(map.get(k));
      if (!list.length) map.delete(k); else map.set(k, list);
      return list;
    },
    forget(userId, roomId) { map.delete(key(userId, roomId)); },
    clear() { map.clear(); },
    get size() { return map.size; },
  };
}

// Pergunta que depende do que veio antes (vale gastar tokens com a memória).
const FOLLOW_UP_RE = /^(e|mas|entao|tipo|como assim|por que|porque|pq|serio|tem certeza|explica|fala mais|e se|outro|outra|mais)\b|\b(isso|disso|nisso|esse|essa|esses|essas|ele|ela|eles|elas|dele|dela|outro|outra|anterior|acima|de novo|tambem)\b/;

/** Vale mandar a memória junto? (curta ou com cara de continuação). Recebe texto normalizado. */
function isFollowUp(normalizedQuestion) {
  const q = String(normalizedQuestion || '');
  return q.length > 0 && (q.length <= 40 || FOLLOW_UP_RE.test(q));
}

module.exports = { createMemory, isFollowUp, MAX_TURNS, TTL_MS };
