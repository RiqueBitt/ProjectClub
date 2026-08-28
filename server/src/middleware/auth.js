const { verifyAccessToken } = require('../services/tokens');
const prisma = require('../config/prisma');

// Cached for a few seconds so every single authenticated request doesn't
// hit the DB just to check one boolean — a platform admin flipping
// maintenance mode takes effect for everyone within this window, not
// instantly, which is a fine trade-off for how rarely this actually
// changes.
let maintenanceCache = { value: null, at: 0 };
async function isMaintenanceOn() {
  if (Date.now() - maintenanceCache.at < 5000 && maintenanceCache.value !== null) return maintenanceCache.value;
  const row = await prisma.platformSettings.findUnique({ where: { id: 'singleton' } });
  maintenanceCache = { value: !!row?.maintenanceMode, at: Date.now() };
  return maintenanceCache.value;
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Não autenticado.' });

    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });

    // Enforced on every request (not just at login) so a ban/suspension
    // applied by an admin takes effect immediately, even mid-session.
    if (user.isPlatformBanned) {
      return res.status(403).json({ error: 'Sua conta foi banida da plataforma.', platformBanned: true, reason: user.platformBanReason || undefined });
    }
    if (user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) {
      return res.status(403).json({ error: 'Sua conta está temporariamente suspensa.', suspendedUntil: user.suspendedUntil });
    }

    // "Em reforma" (see adminController.setMaintenanceMode / platformController.
    // getStatus): only the platform's own staff (ADMIN/MODERATOR) can still
    // use the API while this is on — everyone else gets a 503 with a flag
    // the client recognizes as "show the maintenance screen", checked on
    // literally every authenticated request so it takes effect immediately,
    // even mid-session, same as a ban.
    if (await isMaintenanceOn() && !['ADMIN', 'MODERATOR'].includes(user.platformRole)) {
      return res.status(503).json({ error: 'A plataforma está em manutenção no momento.', maintenance: true });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

module.exports = { requireAuth };
