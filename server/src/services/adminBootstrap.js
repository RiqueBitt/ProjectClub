const prisma = require('../config/prisma');
const env = require('../config/env');
const { PERMISSIONS, toBits } = require('./permissions');

// Optional convenience for fresh deploys: a brand-new prod.db (e.g. after a
// SquareCloud redeploy that runs `prisma db push` from scratch) has zero
// platform admins, and there's no UI to grant the first one — someone has
// to already be ADMIN to open the admin panel and promote anyone else.
// Setting PLATFORM_ADMIN_EMAIL means you don't have to touch the database
// by hand: register the account normally once, set the env var, and the
// next server start promotes that email to ADMIN automatically.
// Idempotent — safe to leave the env var set permanently. No-ops if the
// account hasn't registered yet (just logs a reminder) or is already ADMIN.
// Idempotent: upserts the userId/badgeId pair, so calling this every server
// start is harmless. Silently no-ops if the badge key doesn't exist in the
// catalog (e.g. prisma/seed.js hasn't run yet on a brand-new deploy) rather
// than failing the whole bootstrap over a cosmetic badge.
async function grantBadgeByKey(userId, key) {
  const badge = await prisma.badge.findUnique({ where: { key } }).catch(() => null);
  if (!badge) return;
  await prisma.userBadge.upsert({
    where: { userId_badgeId: { userId, badgeId: badge.id } },
    update: {},
    create: { userId, badgeId: badge.id },
  }).catch(() => {});
}

async function bootstrapPlatformAdmin() {
  const email = (env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) return;

  const user = await prisma.user.findUnique({ where: { email } }).catch(() => null);
  if (!user) {
    console.log(`[admin-bootstrap] PLATFORM_ADMIN_EMAIL definido (${email}), mas nenhuma conta com esse e-mail existe ainda — registre a conta normalmente e reinicie o server para promovê-la.`);
    return;
  }

  if (user.platformRole !== 'ADMIN') {
    await prisma.user.update({ where: { id: user.id }, data: { platformRole: 'ADMIN' } });
    console.log(`[admin-bootstrap] ${user.username} (${user.email}) promovido a ADMIN da plataforma via PLATFORM_ADMIN_EMAIL.`);
  }

  // Runs every start regardless of whether the promotion above just
  // happened — a badge added to the catalog later (or lost from a fresh
  // prod.db after a redeploy) still gets backfilled onto this account
  // instead of only ever being granted the very first time.
  await grantBadgeByKey(user.id, 'STAFF');
  await grantBadgeByKey(user.id, 'PLATFORM_OWNER');
}

// CREATE_POLLS/CREATE_TOPICS are new permission bits added after polls/topics
// already shipped gated only behind SEND_MESSAGES — without this, every
// role created before this update (which can't have bits it didn't know
// about) would suddenly lose access to features members already had.
// Backfill: any role that already has SEND_MESSAGES also gets the two new
// bits, preserving exactly the access everyone already had. Runs on every
// boot but is a no-op past the first time (only touches roles missing the
// bits), same idempotent pattern as the badge grants above. Server owners
// can still go tighten individual roles afterwards via Cargos.
async function backfillPollTopicPermissions() {
  const roles = await prisma.role.findMany({ select: { id: true, permissions: true } });
  const addBits = PERMISSIONS.CREATE_POLLS | PERMISSIONS.CREATE_TOPICS;
  for (const role of roles) {
    const bits = toBits(role.permissions);
    if ((bits & PERMISSIONS.ADMINISTRATOR) || (bits & addBits) === addBits) continue;
    if ((bits & PERMISSIONS.SEND_MESSAGES) === 0n) continue;
    await prisma.role.update({ where: { id: role.id }, data: { permissions: (bits | addBits).toString() } }).catch(() => {});
  }
}

// Same promotion as bootstrapPlatformAdmin, but safe to call on every
// login/register/refresh instead of only once at server boot. Without
// this, setting PLATFORM_ADMIN_EMAIL (or registering the matching account)
// after the server was already running meant the admin panel simply
// wouldn't appear until someone thought to restart the process — there was
// no way to tell from the UI that a restart was even the missing step.
// Cheap (one string compare, no DB write) for every other account, and
// idempotent for the matching one.
async function maybePromoteToPlatformAdmin(user) {
  const email = (env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email || !user || user.email !== email || user.platformRole === 'ADMIN') return user;
  const updated = await prisma.user.update({ where: { id: user.id }, data: { platformRole: 'ADMIN' } });
  console.log(`[admin-bootstrap] ${updated.username} (${updated.email}) promovido a ADMIN da plataforma (checagem em login/refresh).`);
  await grantBadgeByKey(user.id, 'STAFF');
  await grantBadgeByKey(user.id, 'PLATFORM_OWNER');
  return updated;
}

module.exports = { bootstrapPlatformAdmin, grantBadgeByKey, backfillPollTopicPermissions, maybePromoteToPlatformAdmin };
