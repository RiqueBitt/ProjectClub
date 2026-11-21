// Bolinha vermelha "novo" nas seções (Anúncios, Eventos, Coleções da Loja):
// conta o que apareceu depois da última vez que a pessoa abriu cada seção
// (SectionSeen). Quem nunca abriu conta a partir da criação da conta.
//
// Barato: o "mais recente" de cada seção fica num cache de 30s pra todo
// mundo; só quando tem coisa mais nova que a última visita da pessoa é que
// faz um COUNT (até 99) daquela seção.

const SECTION_SOURCES = {
  anuncios: { model: 'staffAnnouncement', where: { published: true } },
  eventos: { model: 'event', where: {} },
  colecoes: { model: 'shopCollection', where: { active: true, showInShop: true } },
};
const SECTIONS = Object.keys(SECTION_SOURCES);
const MAX_COUNT = 99;
const LATEST_TTL_MS = 30 * 1000;

let latestCache = { at: 0, value: null };
function resetCache() { latestCache = { at: 0, value: null }; }

async function latestBySection(prisma, now = Date.now()) {
  if (latestCache.value && now - latestCache.at < LATEST_TTL_MS) return latestCache.value;
  const entries = await Promise.all(SECTIONS.map(async (key) => {
    const src = SECTION_SOURCES[key];
    const row = await prisma[src.model].findFirst({ where: src.where, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }).catch(() => null);
    return [key, row?.createdAt || null];
  }));
  latestCache = { at: now, value: Object.fromEntries(entries) };
  return latestCache.value;
}

// Algo novo publicado: o próximo pedido já enxerga (sem esperar o cache).
function touchSection() { resetCache(); }

async function badgesFor(prisma, user, now = Date.now()) {
  const [latest, seenRows] = await Promise.all([
    latestBySection(prisma, now),
    prisma.sectionSeen.findMany({ where: { userId: user.id }, select: { section: true, seenAt: true } }).catch(() => []),
  ]);
  const seen = Object.fromEntries(seenRows.map((r) => [r.section, r.seenAt]));
  const floor = user.createdAt ? new Date(user.createdAt) : new Date(0);
  const out = {};
  await Promise.all(SECTIONS.map(async (key) => {
    const seenAt = seen[key] ? new Date(seen[key]) : floor;
    const latestAt = latest[key] ? new Date(latest[key]) : null;
    let count = 0;
    if (latestAt && latestAt > seenAt) {
      const src = SECTION_SOURCES[key];
      count = await prisma[src.model].count({ where: { ...src.where, createdAt: { gt: seenAt } }, take: MAX_COUNT }).catch(() => 1);
      count = Math.min(Math.max(count, 1), MAX_COUNT);
    }
    out[key] = { count, latestAt, seenAt: seen[key] || null };
  }));
  return out;
}

async function markSeen(prisma, userId, section, now = new Date()) {
  if (!SECTIONS.includes(section)) return null;
  await prisma.sectionSeen.upsert({
    where: { userId_section: { userId, section } },
    create: { userId, section, seenAt: now },
    update: { seenAt: now },
  });
  return now;
}

// ---- Rotas ----
function routes() {
  // eslint-disable-next-line global-require
  const prisma = require('../config/prisma');
  return {
    async list(req, res, next) {
      try {
        res.set('Cache-Control', 'private, no-cache');
        res.json({ sections: await badgesFor(prisma, req.user) });
      } catch (err) { next(err); }
    },
    async seen(req, res, next) {
      try {
        const { section } = req.params;
        if (!SECTIONS.includes(section)) return res.status(404).json({ error: 'Seção desconhecida.' });
        const at = await markSeen(prisma, req.user.id, section);
        // Os outros aparelhos da pessoa apagam a bolinha também.
        req.app.get('io')?.to(`user:${req.user.id}`).emit('section-badges:seen', { section, seenAt: at });
        res.json({ ok: true, section, seenAt: at });
      } catch (err) { next(err); }
    },
  };
}

module.exports = { SECTIONS, SECTION_SOURCES, MAX_COUNT, latestBySection, badgesFor, markSeen, touchSection, resetCache, routes };
