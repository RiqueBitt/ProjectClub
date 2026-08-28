// Store do rate limiter apontado pro Redis em vez do padrão em memória do
// express-rate-limit — sem isso, cada instância do servidor contaria os
// pedidos separadamente (alguém rodando 3 instâncias atrás de um load
// balancer conseguiria, na prática, 3x o limite real, um por instância).
// Com o Redis como contador compartilhado, o limite vale de verdade pra
// TODA a plataforma, não por processo.
const { RedisStore } = require('rate-limit-redis');
const { redis } = require('./redis');

function createRateLimitStore(prefix) {
  return new RedisStore({
    prefix: `ratelimit:${prefix}:`,
    // sendCommand precisa devolver uma Promise chamando o comando certo
    // do ioredis — é assim que rate-limit-redis funciona com qualquer
    // cliente Redis, não só o `redis` oficial.
    sendCommand: (...args) => redis.call(...args),
  });
}

module.exports = { createRateLimitStore };
