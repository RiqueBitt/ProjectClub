// Cache e "junta pedidos iguais" do Pingu (puro; relógio injetável).
//
// - createLru: cache LRU com validade (TTL) e versão. Mudou a wiki ou as
//   instruções da equipe → a versão muda e tudo que estava guardado vale nada.
// - createInflight: duas pessoas perguntando a MESMA coisa ao mesmo tempo
//   esperam UMA geração só (e as duas recebem o texto parcial do streaming).
const { normalize } = require('./text');

function createLru({ max = 300, ttlMs = 30 * 60 * 1000, now = () => Date.now() } = {}) {
  const map = new Map();
  let version = '';
  const api = {
    /** Troca a versão (ex.: "instruções:3|wiki:7"); se mudou, limpa tudo. */
    setVersion(v) {
      const next = String(v);
      if (next !== version) { version = next; map.clear(); }
    },
    get version() { return version; },
    get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      if (now() - hit.at > ttlMs) { map.delete(key); return null; }
      map.delete(key);
      map.set(key, hit); // mais recente vai pro fim
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { value, at: now() });
      while (map.size > max) map.delete(map.keys().next().value);
    },
    delete(key) { map.delete(key); },
    clear() { map.clear(); },
    get size() { return map.size; },
  };
  return api;
}

/**
 * Pedidos em andamento por chave. run(key, fn, onPartial):
 * - primeiro pedido: chama fn(emitPartial) e guarda a promessa;
 * - os seguintes com a mesma chave (enquanto o primeiro não acabou): não
 *   chamam fn, só esperam a mesma promessa e recebem os parciais.
 * Devolve { promise, shared } (shared = pegou carona).
 */
function createInflight() {
  const running = new Map();
  return {
    run(key, fn, onPartial) {
      const existing = key ? running.get(key) : null;
      if (existing) {
        if (onPartial) {
          existing.listeners.add(onPartial);
          if (existing.last) onPartial(existing.last);
        }
        return { promise: existing.promise, shared: true };
      }
      const entry = { listeners: new Set(onPartial ? [onPartial] : []), last: '' };
      const emit = (text) => {
        entry.last = text;
        entry.listeners.forEach((l) => { try { l(text); } catch { /* ignora */ } });
      };
      entry.promise = Promise.resolve().then(() => fn(emit)).finally(() => { if (key && running.get(key) === entry) running.delete(key); });
      if (key) running.set(key, entry);
      return { promise: entry.promise, shared: false };
    },
    /** Tira um ouvinte (pedido cancelado) sem parar a geração dos outros. */
    unlisten(key, onPartial) { running.get(key)?.listeners.delete(onPartial); },
    listenerCount(key) { return running.get(key)?.listeners.size || 0; },
    has(key) { return running.has(key); },
    get size() { return running.size; },
  };
}

// Perguntas que dependem da hora/conversa não entram no cache.
const NO_CACHE_RE = /\b(hoje|agora|amanha|ontem|horas?|data|dia|semana|mes|ano|ultim[oa]s?|recente|noticia|isso|esse|essa|ele|ela|eles|elas|outr[oa]|mesm[oa]|tambem|ainda|de novo|anterior|acima)\b/;

/** Chave do cache pra uma pergunta (null = não guardar). */
function cacheKeyFor(question) {
  const n = normalize(question);
  if (n.length < 4 || n.length > 300) return null;
  if (NO_CACHE_RE.test(n)) return null;
  return n.replace(/\b(por favor|pfv|pf|ai|ae|kk+|haha+|rs+)\b/g, '').replace(/\s+/g, ' ').trim() || null;
}

module.exports = { createLru, createInflight, cacheKeyFor };
