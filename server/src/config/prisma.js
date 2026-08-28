const { PrismaClient } = require('@prisma/client');

// Reuse a single PrismaClient instance (important in dev with nodemon reloads).
const globalForPrisma = globalThis;

const prisma = globalForPrisma.__prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

module.exports = prisma;
