const express = require('express');
const prisma = require('../config/prisma');
const { requireAuth } = require('../middleware/auth');
const wiki = require('../services/pingu/wiki');
const { logAction } = require('../services/audit');

// Wiki da comunidade (/wiki): todo mundo logado lê; a equipe
// (ADMIN/MODERATOR) cria, edita e apaga. Ver services/pingu/wiki.js.
const router = express.Router();
router.use(requireAuth);

async function requireStaff(req, res, next) {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { platformRole: true } });
    if (!u || !['ADMIN', 'MODERATOR'].includes(u.platformRole)) return res.status(403).json({ error: 'Só a equipe pode editar a wiki.' });
    next();
  } catch (err) { next(err); }
}

const handle = (fn, action) => async (req, res, next) => {
  try {
    const out = await fn(req);
    if (action) logAction(req.app.get('io'), { actorId: req.user.id, action, targetType: 'WIKI', targetId: out?.slug || req.params.slug || null }).catch(() => {});
    res.json(out);
  } catch (err) {
    if (err?.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    next(err);
  }
};

router.get('/', handle(async (req) => ({ pages: await wiki.listPages(String(req.query.q || '').slice(0, 100)) })));
router.get('/:slug', handle(async (req) => {
  const page = await wiki.getPage(req.params.slug);
  if (!page) throw Object.assign(new Error('Página não encontrada.'), { status: 404 });
  return { page };
}));
router.post('/', requireStaff, handle((req) => wiki.createPage(req.body || {}, req.user.id), 'WIKI_CREATE'));
router.put('/:slug', requireStaff, handle((req) => wiki.updatePage(req.params.slug, req.body || {}, req.user.id), 'WIKI_UPDATE'));
router.delete('/:slug', requireStaff, handle((req) => wiki.deletePage(req.params.slug), 'WIKI_DELETE'));

module.exports = router;
