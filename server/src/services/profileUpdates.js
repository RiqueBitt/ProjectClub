const prisma = require('../config/prisma');
const { createNotice } = require('./notices');

// Avisos sociais (igual ao Discord):
// - "Amigos atualizam o perfil deles": quando alguém muda bio/foto/banner/
//   mural, os amigos que deixaram esse aviso ligado recebem um aviso
//   (no máximo 1 a cada 6h por pessoa, pra não virar spam).
// - "Um amigo e eu chegamos a um aniversário de amizade": 1x por dia,
//   checa as amizades que fazem aniversário hoje.
// Preferências em UserSettings.extraPrefs (ver settingsController.js).

const PROFILE_COOLDOWN_MS = 6 * 3600 * 1000;
const lastProfileNotice = new Map();

async function friendIdsOf(userId) {
  const rows = await prisma.friendship.findMany({
    where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return rows.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));
}

async function profileChanged(req, userId) {
  const last = lastProfileNotice.get(userId) || 0;
  if (Date.now() - last < PROFILE_COOLDOWN_MS) return;
  lastProfileNotice.set(userId, Date.now());
  const { getExtraPrefs, getExtraPrefsMany } = require('../controllers/settingsController');
  const mine = await getExtraPrefs(userId);
  if (mine.shareProfileUpdates === false) return;
  const [user, friends] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, displayName: true, avatarUrl: true } }),
    friendIdsOf(userId),
  ]);
  if (!user || !friends.length) return;
  const prefs = await getExtraPrefsMany(friends);
  const io = req?.app?.get?.('io');
  for (const fid of friends) {
    if (prefs[fid]?.notifyFriendProfile === false) continue;
    await createNotice(io, fid, {
      kind: 'FRIEND_PROFILE', title: `${user.displayName} atualizou o perfil`,
      body: 'Dá uma olhada no que mudou.', link: require('./linkResolver').userPath(user), data: { userId },
    });
  }
}

// ---------- Aniversário de amizade ----------
const spDay = (d = new Date()) => new Date(d.getTime() - 3 * 3600 * 1000); // horário de Brasília
let lastAnnivDay = null;
async function runFriendAnniversaries(io) {
  const now = spDay();
  const key = now.toISOString().slice(0, 10);
  if (lastAnnivDay === key) return;
  lastAnnivDay = key;
  const rows = await prisma.friendship.findMany({ where: { status: 'ACCEPTED' }, select: { id: true, requesterId: true, addresseeId: true, updatedAt: true } });
  const today = rows.filter((f) => {
    const d = spDay(new Date(f.updatedAt));
    return d.getUTCMonth() === now.getUTCMonth() && d.getUTCDate() === now.getUTCDate() && d.getUTCFullYear() < now.getUTCFullYear();
  });
  if (!today.length) return;
  const ids = [...new Set(today.flatMap((f) => [f.requesterId, f.addresseeId]))];
  const { getExtraPrefsMany } = require('../controllers/settingsController');
  const [prefs, users, already] = await Promise.all([
    getExtraPrefsMany(ids),
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, displayName: true } }),
    prisma.userNotice.findMany({ where: { kind: 'FRIEND_ANNIV', createdAt: { gte: new Date(Date.now() - 20 * 3600 * 1000) } }, select: { userId: true, data: true } }),
  ]);
  const name = Object.fromEntries(users.map((u) => [u.id, u.displayName]));
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const sent = new Set(already.map((n) => `${n.userId}|${(() => { try { return JSON.parse(n.data).friendshipId; } catch { return ''; } })()}`));
  for (const f of today) {
    const years = now.getUTCFullYear() - spDay(new Date(f.updatedAt)).getUTCFullYear();
    for (const [me, other] of [[f.requesterId, f.addresseeId], [f.addresseeId, f.requesterId]]) {
      if (prefs[me]?.notifyFriendAnniversary === false || sent.has(`${me}|${f.id}`)) continue;
      await createNotice(io, me, {
        kind: 'FRIEND_ANNIV',
        title: `${years} ${years === 1 ? 'ano' : 'anos'} de amizade com ${name[other] || 'um amigo'}! 🎉`,
        body: 'Que tal mandar um oi pra comemorar?', link: require('./linkResolver').userPath(byId[other] || { id: other }), data: { friendshipId: f.id, userId: other, years },
      });
    }
  }
}

function startSocialJobs(io) {
  const tick = () => runFriendAnniversaries(io).catch((e) => console.error('[social] aniversários:', e?.message || e));
  setTimeout(tick, 90 * 1000);
  setInterval(tick, 60 * 60 * 1000).unref?.();
}

module.exports = { profileChanged, runFriendAnniversaries, startSocialJobs, friendIdsOf };
