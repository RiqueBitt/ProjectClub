const { PrismaClient } = require('@prisma/client');

// Reuse a single PrismaClient instance (important in dev with nodemon reloads).
const globalForPrisma = globalThis;

// Economia de RAM no MySQL: o Prisma abre por padrão (nº de CPUs × 2 + 1)
// conexões — no servidor da hospedagem isso dava dezenas de conexões
// paradas, e cada uma reserva memória no banco. Limita a 6 (sobra pro
// tráfego do app) sem mexer na variável de ambiente: só acrescenta o
// parâmetro se a URL ainda não tiver um connection_limit próprio.
function pooledUrl() {
  const url = process.env.DATABASE_URL;
  if (!url || /[?&]connection_limit=/.test(url)) return undefined;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}connection_limit=6&pool_timeout=20`;
}
const dbUrl = pooledUrl();
const prisma = globalForPrisma.__prisma || new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

module.exports = prisma;
