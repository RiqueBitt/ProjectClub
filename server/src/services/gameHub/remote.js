// Game Hub: busca em APIs públicas de fora (lojas, dados do LoL e do
// Deadlock) com tempo limite, User-Agent identificado e cache em memória.
//
// cached(key, ttl, loader): devolve o valor guardado enquanto vale; um pedido
// só por vez pra cada chave (quem chega junto espera o mesmo); se a busca
// falhar e tiver um valor antigo, devolve o antigo (melhor promoção de uma
// hora atrás do que tela vazia). Sem valor nenhum, o erro sobe.

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

async function cached(key, ttlMs, loader, { now = Date.now } = {}) {
  const hit = store.get(key);
  if (hit && now() - hit.at < ttlMs) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
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

function _resetForTests() { store.clear(); inflight.clear(); }

module.exports = { fetchJson, cached, UA, _resetForTests };
