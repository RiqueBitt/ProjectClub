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

module.exports = { getStatus };
