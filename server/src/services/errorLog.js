// Erros persistidos no banco (tabela ErrorLog) — complemento do errorRing
// (que só guarda os últimos 50 em memória e some num restart/deploy).
//
// - Agrupa pelo "fingerprint": sha1(origem + mensagem normalizada + 1ª
//   linha útil da pilha). Números/ids/UUIDs viram "#", então o mesmo erro
//   com ids diferentes cai no mesmo grupo.
// - No máximo 1 gravação por fingerprint a cada 10s: as repetições dentro
//   da janela só somam num contador em memória e vão juntas na próxima
//   gravação (nada se perde, e um erro em loop não martela o banco).
// - Nunca lança: falha ao gravar o log de erro não pode virar outro erro.
const crypto = require('crypto');

const WRITE_WINDOW_MS = 10_000;
const MAX_TRACKED = 500; // fingerprints acompanhados em memória
const RETENTION_DAYS = 30;

const clip = (v, n) => {
  if (v === undefined || v === null || v === '') return null;
  return String(v).slice(0, n);
};

// Sem query string (pode carregar token/código) e cortado no limite da coluna.
function cleanUrl(url) {
  if (!url) return null;
  const s = String(url);
  const q = s.search(/[?#]/);
  return clip(q === -1 ? s : s.slice(0, q), 512);
}

function normalizeMessage(msg) {
  return String(msg || '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '#')
    .replace(/\b[0-9a-f]{16,}\b/gi, '#')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function topFrame(stack) {
  if (!stack) return '';
  const lines = String(stack).split('\n').map((l) => l.trim()).filter((l) => l.startsWith('at '));
  const frame = lines.find((l) => !l.includes('node_modules') && !l.includes('node:internal')) || lines[0] || '';
  return frame.replace(/:\d+:\d+\)?$/, '').slice(0, 200);
}

function fingerprintOf({ source, message, stack }) {
  return crypto.createHash('sha1')
    .update(`${source}|${normalizeMessage(message)}|${topFrame(stack)}`)
    .digest('hex');
}

// fingerprint -> { lastWrite, pending, latest, timer }
const tracked = new Map();
let prismaRef = null;
function getPrisma() {
  if (!prismaRef) prismaRef = require('../config/prisma');
  return prismaRef;
}

async function writeRow(fp, entry, increment) {
  const prisma = getPrisma();
  if (!prisma?.errorLog) return; // client do Prisma antigo (sem a tabela) — ignora
  const e = entry.latest;
  const { safeUpsert } = require('../utils/prismaSafe');
  await safeUpsert(prisma.errorLog, {
    where: { fingerprint: fp },
    create: {
      fingerprint: fp, source: e.source, message: e.message, stack: e.stack,
      url: e.url, userAgent: e.userAgent, userId: e.userId, count: increment,
    },
    update: {
      count: { increment },
      // Guarda o contexto da ocorrência mais recente.
      url: e.url, userAgent: e.userAgent, userId: e.userId,
      ...(e.stack ? { stack: e.stack } : {}),
    },
    select: { id: true },
  });
}

function flush(fp) {
  const entry = tracked.get(fp);
  if (!entry || entry.pending <= 0) return Promise.resolve();
  const increment = entry.pending;
  entry.pending = 0;
  entry.lastWrite = Date.now();
  return writeRow(fp, entry, increment).catch((err) => {
    // Não perde a contagem se o banco piscou.
    entry.pending += increment;
    if (process.env.NODE_ENV !== 'test') console.error('[error-log] falha ao gravar:', err?.message || err);
  });
}

function evictIfNeeded() {
  if (tracked.size <= MAX_TRACKED) return;
  // Tira os mais antigos que não têm nada pendente.
  for (const [fp, entry] of tracked) {
    if (tracked.size <= MAX_TRACKED * 0.8) break;
    if (!entry.pending && !entry.timer) tracked.delete(fp);
  }
}

// source: 'server' | 'client' | 'process'
function persistError({ source, message, stack, url, userAgent, userId } = {}) {
  try {
    const src = clip(source, 32) || 'server';
    const latest = {
      source: src,
      message: clip(message, 4000) || 'Erro sem mensagem',
      stack: clip(stack, 8000),
      url: cleanUrl(url),
      userAgent: clip(userAgent, 512),
      userId: clip(userId, 64),
    };
    const fp = fingerprintOf(latest);
    let entry = tracked.get(fp);
    if (!entry) {
      entry = { lastWrite: 0, pending: 0, latest, timer: null };
      tracked.set(fp, entry);
      evictIfNeeded();
    }
    entry.latest = latest;
    entry.pending += 1;
    const wait = entry.lastWrite + WRITE_WINDOW_MS - Date.now();
    if (wait <= 0 && !entry.timer) return flush(fp);
    if (!entry.timer) {
      entry.timer = setTimeout(() => { entry.timer = null; flush(fp); }, Math.max(wait, 0));
      entry.timer.unref?.();
    }
  } catch { /* nunca propaga */ }
  return Promise.resolve();
}

// GET /api/admin/errors — só ADMIN (router de /admin já exige). Filtros:
// ?source=server|client|process, ?q=texto, ?limit=1..200 (padrão 50).
async function listErrors(req, res, next) {
  try {
    const prisma = getPrisma();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const where = {};
    if (['server', 'client', 'process'].includes(req.query.source)) where.source = req.query.source;
    if (typeof req.query.q === 'string' && req.query.q.trim()) where.message = { contains: req.query.q.trim().slice(0, 100) };
    const [errors, total] = await Promise.all([
      prisma.errorLog.findMany({ where, orderBy: { lastSeen: 'desc' }, take: limit }),
      prisma.errorLog.count({ where }),
    ]);
    res.set('Cache-Control', 'private, no-store');
    res.json({ errors, total, retentionDays: RETENTION_DAYS });
  } catch (err) { next(err); }
}

function _resetForTests() {
  for (const e of tracked.values()) if (e.timer) clearTimeout(e.timer);
  tracked.clear();
  prismaRef = null;
}
function _setPrismaForTests(p) { prismaRef = p; }

module.exports = {
  persistError, listErrors, fingerprintOf, normalizeMessage, cleanUrl,
  WRITE_WINDOW_MS, RETENTION_DAYS, _resetForTests, _setPrismaForTests,
};
