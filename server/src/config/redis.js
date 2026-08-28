// Cliente Redis compartilhado — usado pra tudo que é rápido/temporário:
// presença (online/offline), estado dos canais de voz, cache de consultas
// caras, rate limiting, e qualquer coisa com expiração automática (TTL).
// O MySQL continua sendo a fonte de verdade dos dados permanentes —
// nada aqui substitui uma tabela do banco, só acelera/desacopla o que
// muda rápido demais (ou não precisa sobreviver a um restart) pra fazer
// sentido bater no MySQL toda vez.
const Redis = require('ioredis');
const fs = require('fs');
const env = require('./env');

// TLS mútuo (CA + certificado/chave do cliente) — só ativado se as 3
// variáveis apontarem pra arquivos que existem de verdade; sem isso,
// conecta normalmente sem TLS (Redis local de desenvolvimento, por
// exemplo). O rediss:// (com "s" de secure) na URL já liga o TLS no
// ioredis sozinho — isso aqui só adiciona os certificados por cima.
function buildTlsOptions() {
  const { REDIS_CA_PATH, REDIS_CERT_PATH, REDIS_KEY_PATH } = env;
  if (!REDIS_CA_PATH || !REDIS_CERT_PATH || !REDIS_KEY_PATH) return undefined;
  try {
    return {
      ca: fs.readFileSync(REDIS_CA_PATH),
      cert: fs.readFileSync(REDIS_CERT_PATH),
      key: fs.readFileSync(REDIS_KEY_PATH),
    };
  } catch (err) {
    console.error('[redis] não consegui ler os certificados TLS configurados:', err.message);
    return undefined;
  }
}

const redis = new Redis(env.REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
  retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
  tls: buildTlsOptions(),
});

redis.on('error', (err) => {
  // Nunca deixa um erro de conexão do Redis derrubar o processo inteiro —
  // presença/voz/cache degradam graciosamente, mas mensagens/contas/etc
  // continuam funcionando 100% via MySQL, já que nunca dependem do
  // Redis pra nada essencial.
  console.error('[redis] erro de conexão:', err.message);
});

redis.on('connect', () => console.log('[redis] conectado'));

// ---------- Cache genérico (consultas caras, TTL curto) ----------
async function cacheGetOrSet(key, ttlSeconds, compute) {
  try {
    const cached = await redis.get(`cache:${key}`);
    if (cached !== null) return JSON.parse(cached);
  } catch { /* Redis fora do ar — cai pro compute() direto, sem cache */ }

  const fresh = await compute();
  try {
    await redis.set(`cache:${key}`, JSON.stringify(fresh), 'EX', ttlSeconds);
  } catch { /* não trava a resposta só porque não conseguiu cachear */ }
  return fresh;
}

async function cacheInvalidate(key) {
  try { await redis.del(`cache:${key}`); } catch { /* ignora */ }
}

module.exports = { redis, cacheGetOrSet, cacheInvalidate };
