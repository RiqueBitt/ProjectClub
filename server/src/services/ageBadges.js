const prisma = require('../config/prisma');

// Auto-grants any "account age" badges (Badge.ageYears set — see
// schema.prisma's comment) the account has reached but doesn't have yet.
// Called lazily wherever a user's own data is fetched (authController.me),
// same "check it as a side effect of a normal read, not a background job"
// pattern as ensurePublicId — cheap enough (a handful of badge rows,
// checked at most once per session) that it doesn't need a cron job.
async function grantDueAgeBadges(userId, accountCreatedAt) {
  try {
    const ageYears = Math.floor((Date.now() - new Date(accountCreatedAt).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    if (ageYears < 1) return;

    const dueBadges = await prisma.badge.findMany({ where: { ageYears: { lte: ageYears, not: null } } });
    if (dueBadges.length === 0) return;

    const owned = await prisma.userBadge.findMany({
      where: { userId, badgeId: { in: dueBadges.map((b) => b.id) } }, select: { badgeId: true },
    });
    const ownedIds = new Set(owned.map((o) => o.badgeId));
    const missing = dueBadges.filter((b) => !ownedIds.has(b.id));
    if (missing.length === 0) return;

    await prisma.userBadge.createMany({
      data: missing.map((b) => ({ userId, badgeId: b.id })),
      skipDuplicates: true,
    });
  } catch {
    // Never let a badge-grant hiccup break loading someone's own account.
  }
}

module.exports = { grantDueAgeBadges };
