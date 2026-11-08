// Partes puras (sem IndexedDB/React) do cache de mensagens — ver
// messageCache.js. Separadas pra dar pra testar no Node.

export const CACHE_PER_ROOM = 50;
export const CACHE_MAX_ROOMS = 30;
export const CACHE_MAX_CHARS = 4_000_000; // ~4 MB de JSON no total, por conta
export const CACHE_MAX_AGE_MS = 14 * 24 * 3600 * 1000;

const TRANSIENT_FIELDS = ['_animateIn', 'nonce', 'upload', 'uploadCount', 'pending', 'failed', 'queued'];

// Só o que já está confirmado pelo servidor: sem otimistas (temp-), sem
// apagadas, só as últimas `limit`, sem campos de estado da tela.
export function sanitizeForCache(messages, limit = CACHE_PER_ROOM) {
  if (!Array.isArray(messages)) return [];
  const real = messages.filter((m) => m && m.id && !String(m.id).startsWith('temp-')
    && !m.pending && !m.failed && !m.queued && !m.deleted);
  return real.slice(-limit).map((m) => {
    const out = { ...m };
    TRANSIENT_FIELDS.forEach((k) => { delete out[k]; });
    return out;
  });
}

// Índice por conta: [{ r: roomKey, at, n: tamanho em caracteres }], o mais
// recente no FIM. Devolve { index, evict: [roomKeys a apagar] } depois de
// gravar `roomKey` com `chars` caracteres agora (`now`).
export function updateCacheIndex(index, roomKey, chars, now, { maxRooms = CACHE_MAX_ROOMS, maxChars = CACHE_MAX_CHARS, maxAge = CACHE_MAX_AGE_MS } = {}) {
  const list = (Array.isArray(index) ? index : []).filter((e) => e && typeof e.r === 'string' && e.r !== roomKey);
  if (roomKey && chars > 0) list.push({ r: roomKey, at: now, n: chars });
  const evict = [];
  // Velhos demais saem primeiro.
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (now - (list[i].at || 0) > maxAge) evict.push(list.splice(i, 1)[0].r);
  }
  // Depois o teto de salas e de tamanho total (os menos recentes primeiro).
  let total = list.reduce((n, e) => n + (e.n || 0), 0);
  while (list.length && (list.length > maxRooms || total > maxChars)) {
    const old = list.shift();
    total -= old.n || 0;
    evict.push(old.r);
  }
  return { index: list, evict };
}

export function roomCacheKey(userId, roomKey) { return `m:${userId}:${roomKey}`; }
export function indexCacheKey(userId) { return `i:${userId}`; }
