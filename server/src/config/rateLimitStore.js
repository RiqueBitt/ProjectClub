// Store do rate limiter apontado pro Redis em vez do padrão em memória do
// express-rate-limit — sem isso, cada instância do servidor contaria os
// pedidos separadamente (alguém rodando 3 instâncias atrás de um load
// balancer conseguiria, na prática, 3x o limite real, um por instância).
// Com o Redis como contador compartilhado, o limite vale de verdade pra
// TODA a plataforma, não por processo.
//
// ESTABILIDADE: com o Redis fora do ar, o express-rate-limit (sem
// `passOnStoreError`) devolvia 500 em TODO pedido da API — o site inteiro
// parava por causa de um contador. Agora, sem Redis, a contagem continua
// numa memória do próprio processo (o limite segue valendo, inclusive o do
// login contra tentativa de senha) e volta pro Redis sozinha quando ele
// voltar. Igual no Rust: rust/pc-server/src/ratelimit.rs.
const { RedisStore } = require('rate-limit-redis');
const { MemoryStore } = require('express-rate-limit');
const { redis } = require('./redis');

let lastWarnAt = 0;
function warnFallback(prefix, err) {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn(`[rate-limit] Redis indisponível (${err?.message || err || 'sem conexão'}) — contando na memória do processo (${prefix})`);
}

// Junta um store "de verdade" (Redis) com um reserva (memória). `isReady`
// diz se vale tentar o primário — com o Redis desconectado nem espera o
// erro (que levava ~1 s por pedido com as novas tentativas do ioredis).
function createFallbackStore({ primary, fallback, isReady = () => true, onFallback = () => {} }) {
  const run = async (method, key) => {
    if (isReady()) {
      try {
        return await primary[method](key);
      } catch (err) {
        onFallback(err);
      }
    } else {
      onFallback(null);
    }
    return fallback[method](key);
  };
  return {
    prefix: primary.prefix,
    // contagem compartilhada (Redis) é o normal; a reserva é só emergência
    localKeys: false,
    init(options) {
      primary.init?.(options);
      fallback.init?.(options);
    },
    increment: (key) => run('increment', key),
    decrement: (key) => run('decrement', key),
    resetKey: (key) => run('resetKey', key),
    async get(key) {
      if (typeof primary.get !== 'function') return undefined;
      if (isReady()) {
        try { return await primary.get(key); } catch (err) { onFallback(err); }
      }
      return fallback.get?.(key);
    },
    shutdown() { fallback.shutdown?.(); },
  };
}

function createRateLimitStore(prefix) {
  const primary = new RedisStore({
    prefix: `ratelimit:${prefix}:`,
    // sendCommand precisa devolver uma Promise chamando o comando certo
    // do ioredis — é assim que rate-limit-redis funciona com qualquer
    // cliente Redis, não só o `redis` oficial.
    sendCommand: (...args) => redis.call(...args),
  });
  return createFallbackStore({
    primary,
    fallback: new MemoryStore(),
    isReady: () => redis.status === 'ready',
    onFallback: (err) => warnFallback(prefix, err),
  });
}

module.exports = { createRateLimitStore, createFallbackStore };
