// Loja dos criadores (Fase 8) — regras em services/creatorShop.js.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');
const shop = require('../services/creatorShop');

const router = express.Router();
router.use(requireAuth);

const fail = (res, next) => (err) => {
  if (err instanceof shop.CreatorShopError) return res.status(err.status).json({ error: err.message, code: err.code });
  return next(err);
};
const notifier = (req) => (userId, notice) => require('../services/notices').createNotice(req.app.get('io'), userId, notice);
const staffOnly = (req, res, next) => (shop.isStaff(req.user) ? next() : res.status(403).json({ error: 'Acesso restrito à equipe.' }));

router.get('/', (req, res, next) => {
  shop.listApproved(req.user.id, { kind: req.query.kind, q: req.query.q, sort: req.query.sort }).then((r) => res.json(r)).catch(fail(res, next));
});

router.get('/mine', (req, res, next) => {
  shop.mine(req.user.id).then((r) => res.json(r)).catch(fail(res, next));
});

// Figurinhas da loja que a pessoa pode usar (seletor de figurinhas).
router.get('/stickers', (req, res, next) => {
  shop.usableItems(req.user.id, 'STICKER').then((stickers) => res.json({ stickers })).catch(fail(res, next));
});

// Mapa público nome → imagem dos emojis aprovados (pra todo mundo enxergar
// no chat o emoji que alguém comprou).
router.get('/emoji-map', (req, res, next) => {
  shop.publicEmojiMap().then((emojis) => { res.set('Cache-Control', 'private, max-age=60'); res.json({ emojis }); }).catch(fail(res, next));
});

router.post('/submit', uploadImage.single('image'), (req, res, next) => {
  shop.submit(req.user.id, req.body || {}, req.file).then((item) => res.status(201).json({ item })).catch(fail(res, next));
});

router.post('/:id/buy', (req, res, next) => {
  shop.buy(req.user.id, String(req.params.id), { notify: notifier(req) })
    .then(async (r) => {
      const me = await require('../config/prisma').user.findUnique({ where: { id: req.user.id }, select: { coins: true } });
      res.json({ ok: true, price: r.price, coins: me?.coins ?? null });
    })
    .catch(fail(res, next));
});

router.post('/:id/report', (req, res, next) => {
  shop.report(req.user.id, String(req.params.id), req.body?.reason).then((r) => res.json(r)).catch(fail(res, next));
});

router.delete('/:id', (req, res, next) => {
  shop.withdraw(req.user.id, String(req.params.id)).then((r) => res.json(r)).catch(fail(res, next));
});

// ---------- Equipe ----------
router.get('/admin/queue', staffOnly, (req, res, next) => {
  shop.adminQueue(req.user, { status: String(req.query.status || 'PENDING') }).then((r) => res.json(r)).catch(fail(res, next));
});
router.post('/admin/:id/approve', staffOnly, (req, res, next) => {
  shop.review(req.user, String(req.params.id), { approve: true }, { notify: notifier(req) }).then((item) => res.json({ item })).catch(fail(res, next));
});
router.post('/admin/:id/reject', staffOnly, (req, res, next) => {
  shop.review(req.user, String(req.params.id), { approve: false, reason: req.body?.reason }, { notify: notifier(req) }).then((item) => res.json({ item })).catch(fail(res, next));
});
router.post('/admin/:id/remove', staffOnly, (req, res, next) => {
  shop.removeItem(req.user, String(req.params.id), { reason: req.body?.reason }, { notify: notifier(req) }).then((item) => res.json({ item })).catch(fail(res, next));
});
router.post('/admin/reports/:id/resolve', staffOnly, (req, res, next) => {
  shop.resolveReport(req.user, String(req.params.id)).then((r) => res.json(r)).catch(fail(res, next));
});

module.exports = router;
