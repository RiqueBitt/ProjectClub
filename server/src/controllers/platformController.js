const prisma = require('../config/prisma');

// GET /api/platform/status — deliberately public (no auth) so the client
// can check this BEFORE even knowing if the person is logged in, and show
// the maintenance screen immediately instead of only discovering it after
// some other request 503s.
async function getStatus(req, res, next) {
  try {
    const row = await prisma.platformSettings.findUnique({ where: { id: 'singleton' } });
    let disabledSystems = [];
    try { disabledSystems = JSON.parse(row?.disabledSystems || '[]'); } catch { disabledSystems = []; }
    res.json({ maintenanceMode: !!row?.maintenanceMode, maintenanceMessage: row?.maintenanceMessage || null, disabledSystems });
  } catch (err) { next(err); }
}

// Item pedido: "mostra informações sobre a plataforma" (categoria
// Início) — números públicos simples, sem inventar nenhuma tabela
// nova, só contando o que já existe no banco.
async function getPlatformStats(req, res, next) {
  try {
    const [memberCount, postCount, communityCount, messageCount] = await Promise.all([
      prisma.user.count(),
      prisma.post.count(),
      prisma.community.count(),
      prisma.message.count(),
    ]);
    res.json({ memberCount, postCount, communityCount, messageCount });
  } catch (err) { next(err); }
}

// Pulso público da página inicial: só contagens agregadas (ninguém é
// identificado), guardadas por 30 s para não pesar no banco.
const { cacheGetOrSet } = require('../config/redis');
async function getPublicPulse(req, res) {
  try {
    const data = await cacheGetOrSet('platform:pulse', 30, async () => {
      const since = new Date(); since.setHours(0, 0, 0, 0);
      const [members, online, messagesToday] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { status: { in: ['ONLINE', 'IDLE', 'DND'] } } }), // quem está invisível não conta
        prisma.message.count({ where: { createdAt: { gte: since } } }),
      ]);
      return { members, online, messagesToday, at: new Date().toISOString() };
    });
    res.set('Cache-Control', 'public, max-age=20');
    res.json(data);
  } catch {
    res.json({ members: null, online: null, messagesToday: null });
  }
}

module.exports = { getStatus, getPlatformStats, getPublicPulse };
