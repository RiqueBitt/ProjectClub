// Game Hub: busca em APIs públicas de fora (lojas, dados do LoL e do
// Deadlock) com tempo limite, User-Agent identificado e cache em memória.
//
// cached(key, ttl, loader): devolve o valor guardado enquanto vale; um pedido
// só por vez pra cada chave (quem chega junto espera o mesmo); se a busca
// falhar e tiver um valor antigo, devolve o antigo (melhor promoção de uma
// hora atrás do que tela vazia). Sem valor nenhum, o erro sobe.
// Venceu há pouco (até 6× o tempo de validade): devolve o guardado NA HORA e
// atualiza por trás — quem abre a tela não espera a loja de fora responder
// (era o "[lento] /api/game-hub/deals 800ms" dos logs a cada meia hora).

const UA = 'ProjectClub/1.0 (+https://projectclub.shardweb.app)';
const store = new Map(); // key -> { at, value }
const inflight = new Map(); // key -> Promise

async function fetchJson(url, { timeoutMs = 10_000, fetchImpl = globalThis.fetch, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${new URL(url).host}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

const STALE_FACTOR = 6;

async function cached(key, ttlMs, loader, { now = Date.now } = {}) {
  const hit = store.get(key);
  const age = hit ? now() - hit.at : Infinity;
  if (hit && age < ttlMs) return hit.value;
  if (hit && age < ttlMs * STALE_FACTOR) {
    if (!inflight.has(key)) refresh(key, loader, now, hit).catch(() => {});
    return hit.value;
  }
  if (inflight.has(key)) return inflight.get(key);
  return refresh(key, loader, now, hit);
}

function refresh(key, loader, now, hit) {
  const p = (async () => {
    try {
      const value = await loader();
      store.set(key, { at: now(), value });
      return value;
    } catch (err) {
      if (hit) return hit.value;
      throw err;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

// Espera a atualização por trás terminar (testes).
function _settle() { return Promise.allSettled([...inflight.values()]); }

function _resetForTests() { store.clear(); inflight.clear(); }

module.exports = { fetchJson, cached, UA, _resetForTests, _settle };
