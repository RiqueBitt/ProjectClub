const prisma = require('../config/prisma');

// Bloqueia toda a rota quando a staff desligou aquele sistema (ver
// adminController.getSystemToggles/adminUpdateSystemToggles) — membros
// comuns recebem 503; ADMIN sempre passa (pra poder religar o sistema
// mesmo com ele desligado).
function requireSystemEnabled(systemKey) {
  return async function (req, res, next) {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { platformRole: true } });
      if (user?.platformRole === 'ADMIN') return next();

      const settings = await prisma.platformSettings.findUnique({ where: { id: 'singleton' } });
      let disabled = [];
      try { disabled = JSON.parse(settings?.disabledSystems || '[]'); } catch { disabled = []; }
      if (disabled.includes(systemKey)) {
        return res.status(503).json({ error: 'Este sistema está temporariamente desativado pela equipe.', systemDisabled: systemKey });
      }
      next();
    } catch (err) { next(err); }
  };
}

module.exports = { requireSystemEnabled };
