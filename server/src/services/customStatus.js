const prisma = require('../config/prisma');

// Custom statuses can carry an expiry (see userController.setCustomStatus).
// Rather than running a background job, we clear expired ones lazily the
// next time the user record is read — good enough at this scale and avoids
// an extra scheduled task in the SquareCloud deployment.
function clearIfExpired(user) {
  if (!user) return user;
  if (user.customStatusExpiresAt && new Date(user.customStatusExpiresAt) <= new Date()) {
    const cleared = { ...user, customStatus: null, customStatusEmoji: null, customStatusExpiresAt: null };
    prisma.user.update({
      where: { id: user.id },
      data: { customStatus: null, customStatusEmoji: null, customStatusExpiresAt: null },
    }).catch(() => {});
    return cleared;
  }
  return user;
}

module.exports = { clearIfExpired };
