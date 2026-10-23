const prisma = require('../config/prisma');

// Gate for the /api/admin/* routes — separate from the per-server permission
// system (services/authz.js), since this is a platform-wide role stored
// directly on User.platformRole, not tied to any one Server.
async function requirePlatformAdmin(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { platformRole: true } });
    if (!user || user.platformRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Acesso restrito a administradores da plataforma.' });
    }
    next();
  } catch (err) { next(err); }
}

module.exports = { requirePlatformAdmin };
