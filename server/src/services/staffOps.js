// Painel de saúde da staff (uma tela só): erros agrupados do ErrorLog, quem
// está em call agora (salas do Redis), saúde do servidor de mídia
// (/stats?deep=1 com x-media-secret), processo (uptime/memória), latência
// do banco e do Redis, versão publicada e estado dos backups.
//
// Acesso: staff = platformRole ADMIN ou MODERATOR (mesma regra usada no
// resto do servidor — ver middleware/auth.js, sockets 'staff'). Disparar
// backup é só ADMIN.
const fs = require('fs');
const path = require('path');
const os = require('os');

const STAFF_ROLES = new Set(['ADMIN', 'MODERATOR']);
const isStaff = (user) => STAFF_ROLES.has(user?.platformRole);

function requireStaff(req, res, next) {
  if (!isStaff(req.user)) return res.status(403).json({ error: 'Acesso restrito à equipe da plataforma.' });
  return next();
}
function requireAdmin(req, res, next) {
  if (req.user?.platformRole !== 'ADMIN') return res.status(403).json({ error: 'Apenas administradores podem fazer isso.' });
  return next();
}

const withTimeout = (p, ms, label = 'demorou demais') => Promise.race([
  p, new Promise((_, rej) => { const t = setTimeout(() => rej(new Error(label)), ms); t.unref?.(); }),
]);
async function timed(fn, ms = 4000) {
  const t = Date.now();
  try { await withTimeout(Promise.resolve().then(fn), ms); return { ok: true, ms: Date.now() - t }; } catch (e) { return { ok: false, ms: Date.now() - t, error: e?.message || String(e) }; }
}

// wss://midia.exemplo.com/ws → https://midia.exemplo.com/stats?deep=1
function mediaStatsUrl(env = process.env) {
  const raw = String(env.MEDIA_SERVER_URL || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === 'ws:') u.protocol = 'http:';
    else if (u.protocol === 'wss:') u.protocol = 'https:';
    u.pathname = '/stats'; u.search = '?deep=1'; u.hash = '';
    return u.toString();
  } catch { return null; }
}

async function fetchMediaHealth({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  const url = mediaStatsUrl(env);
  const secret = env.MEDIA_SERVER_SECRET;
  if (!url || !secret) return { configured: false };
  const started = Date.now();
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => { try { ctrl?.abort(); } catch { /* ok */ } }, timeoutMs);
  try {
    const r = await fetchImpl(url, { headers: { 'x-media-secret': secret }, signal: ctrl?.signal });
    const ms = Date.now() - started;
    if (!r.ok) return { configured: true, ok: false, ms, status: r.status, error: r.status === 401 ? 'segredo recusado (MEDIA_SERVER_SECRET diferente)' : `HTTP ${r.status}` };
    const data = await r.json();
    // Só o que interessa pro painel (o deep traz detalhe por consumer).
    const rooms = Array.isArray(data?.rooms) ? data.rooms.slice(0, 50).map((room) => ({
      room: room.room,
      peers: (room.peers || []).slice(0, 50).map((p) => ({
        id: p.id, name: p.name, producers: p.producers, consumers: p.consumers,
        transports: (p.transports || []).map((t) => ({ ice: t.ice, dtls: t.dtls, dir: t.dir, tuple: t.tuple })),
        stalled: (p.consumersDetail || []).filter((c) => !c.paused && !c.producerPaused && (c.bytes === 0 || c.bytes === null)).length,
      })),
    })) : [];
    const { rooms: _omit, ...summary } = data || {};
    return { configured: true, ok: true, ms, summary, rooms };
  } catch (err) {
    return { configured: true, ok: false, ms: Date.now() - started, error: err?.name === 'AbortError' ? 'tempo esgotado' : (err?.message || String(err)) };
  } finally { clearTimeout(timer); }
}

// Salas de voz do Redis + nomes de quem está nelas.
async function voiceSnapshot({ prisma, voiceStore }) {
  const ids = await voiceStore.getActiveRoomIds();
  const rooms = [];
  for (const id of ids.slice(0, 200)) {
    // eslint-disable-next-line no-await-in-loop
    const [room, startedAt] = await Promise.all([voiceStore.getRoom(id), voiceStore.getStartedAt?.(id).catch(() => null)]);
    const entries = Object.entries(room || {});
    if (!entries.length) continue;
    rooms.push({
      id,
      kind: id.startsWith('dm:') ? 'dm' : id.startsWith('clan:') ? 'clan' : 'channel',
      startedAt: startedAt ? new Date(Number(startedAt)).toISOString() : null,
      participants: entries.map(([userId, p]) => ({
        userId, muted: !!p.muted, deafened: !!p.deafened, video: !!p.video, screenSharing: !!p.screenSharing,
        serverMuted: !!p.serverMuted, provider: p.provider || null, joinedAt: p.joinedAt ? new Date(p.joinedAt).toISOString() : null,
      })),
    });
  }
  const userIds = [...new Set(rooms.flatMap((r) => r.participants.map((p) => p.userId)))];
  const channelIds = rooms.filter((r) => r.kind === 'channel').map((r) => r.id);
  const [users, channels] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, username: true, avatarUrl: true } }) : [],
    channelIds.length ? prisma.channel.findMany({ where: { id: { in: channelIds } }, select: { id: true, name: true } }) : [],
  ]);
  const uMap = new Map(users.map((u) => [u.id, u]));
  const cMap = new Map(channels.map((c) => [c.id, c.name]));
  for (const r of rooms) {
    r.name = r.kind === 'channel' ? (cMap.get(r.id) || 'Canal removido') : r.kind === 'dm' ? 'Chamada privada' : 'Call de clube';
    for (const p of r.participants) {
      const u = uMap.get(p.userId);
      p.displayName = u?.displayName || 'Conta removida';
      p.username = u?.username || null;
      p.avatarUrl = u?.avatarUrl || null;
    }
  }
  rooms.sort((a, b) => b.participants.length - a.participants.length);
  return { rooms, totalParticipants: rooms.reduce((n, r) => n + r.participants.length, 0) };
}

const VERSION_FILE = path.resolve(__dirname, '../../../client/dist/version.json');
function readVersion(file = VERSION_FILE) {
  let web = null;
  let builtAt = null;
  try {
    const st = fs.statSync(file);
    web = JSON.parse(fs.readFileSync(file, 'utf8'));
    builtAt = st.mtime.toISOString();
  } catch { /* sem build local */ }
  let serverVersion = null;
  try { serverVersion = require('../../package.json').version; } catch { /* ok */ }
  return { web, builtAt, server: serverVersion, node: process.version, commit: process.env.GIT_COMMIT || process.env.SOURCE_VERSION || null };
}

async function errorSummary(prisma) {
  if (!prisma.errorLog) return { groups: [], last24h: 0, total: 0 };
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [groups, last24h, total] = await Promise.all([
    prisma.errorLog.findMany({ orderBy: { lastSeen: 'desc' }, take: 30 }),
    prisma.errorLog.count({ where: { lastSeen: { gte: since } } }),
    prisma.errorLog.count(),
  ]);
  return {
    groups: groups.map((g) => ({
      id: g.id, source: g.source, message: String(g.message || '').slice(0, 600), stack: g.stack ? String(g.stack).slice(0, 4000) : null,
      url: g.url, count: g.count, firstSeen: g.firstSeen, lastSeen: g.lastSeen,
    })),
    last24h,
    total,
  };
}

async function buildHealth({
  prisma = require('../config/prisma'),
  redis = require('../config/redis').redis,
  voiceStore = require('./voiceRoomStore'),
  io = null, env = process.env, fetchImpl = globalThis.fetch,
} = {}) {
  const settle = (p, fallback = null) => withTimeout(Promise.resolve().then(() => p()), 5000).catch((e) => ({ ...(fallback || {}), error: e?.message || String(e) }));
  const [db, redisPing, errors, voice, media, backup] = await Promise.all([
    timed(() => prisma.$queryRaw`SELECT 1`),
    timed(() => redis.ping()),
    settle(() => errorSummary(prisma), { groups: [], last24h: 0, total: 0 }),
    settle(() => voiceSnapshot({ prisma, voiceStore }), { rooms: [], totalParticipants: 0 }),
    fetchMediaHealth({ env, fetchImpl }),
    settle(() => require('./dbBackup').getStatus({ prisma, env }), { recent: [] }),
  ]);
  const mem = process.memoryUsage();
  const mb = (b) => Math.round((b / 1024 / 1024) * 10) / 10;
  return {
    at: new Date().toISOString(),
    db,
    redis: { ...redisPing, status: redis?.status || null },
    process: {
      uptimeSec: Math.round(process.uptime()), pid: process.pid, node: process.version,
      rssMb: mb(mem.rss), heapUsedMb: mb(mem.heapUsed), heapTotalMb: mb(mem.heapTotal), externalMb: mb(mem.external),
      loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100), cpus: os.cpus()?.length || null,
      systemFreeMb: mb(os.freemem()), systemTotalMb: mb(os.totalmem()),
      sockets: io ? io.of('/').sockets.size : null,
    },
    version: readVersion(),
    errors,
    voice,
    media,
    backup,
  };
}

// ---------- HTTP ----------
async function getHealth(req, res, next) {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await buildHealth({ io: req.app.get('io') }));
  } catch (err) { next(err); }
}

async function getBackups(req, res, next) {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await require('./dbBackup').getStatus());
  } catch (err) { next(err); }
}

// Dispara em segundo plano (um dump pode levar minutos — a requisição não
// fica presa); só espera um instante pra devolver 409 se já tem um rodando.
async function postBackupRun(req, res, next) {
  try {
    const backup = require('./dbBackup');
    const p = backup.runBackup({ trigger: 'MANUAL', userId: req.user.id, io: req.app.get('io') });
    const early = await Promise.race([
      p.then((r) => ({ done: r }), (err) => ({ err })),
      new Promise((r) => { const t = setTimeout(() => r(null), 800); t.unref?.(); }),
    ]);
    if (early?.err?.status === 409) return res.status(409).json({ error: early.err.message });
    if (!early) p.catch(() => {}); // segue em segundo plano; falha vira aviso + ErrorLog
    try {
      require('../config/prisma').platformAuditLog?.create({ data: { actorId: req.user.id, action: 'DB_BACKUP_RUN', targetType: 'BACKUP' } })?.catch?.(() => {});
    } catch { /* registro é best-effort */ }
    if (early?.err) return res.status(early.err.status || 500).json({ error: early.err.message });
    return res.status(early?.done ? 200 : 202).json({ ok: true, started: true, backup: early?.done || null });
  } catch (err) { next(err); }
}

module.exports = {
  isStaff, requireStaff, requireAdmin, mediaStatsUrl, fetchMediaHealth, voiceSnapshot, readVersion,
  errorSummary, buildHealth, getHealth, getBackups, postBackupRun,
};
