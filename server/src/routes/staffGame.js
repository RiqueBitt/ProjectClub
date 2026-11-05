// Painel da equipe → "Jogo" (Club Penguin): pinguins, moedas, itens, iglus,
// móveis, puffles e carimbos. Ver services/waddle/admin.js.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireStaff } = require('../services/staffOps');
const { requireFeature } = require('../config/features');
const { logAction } = require('../services/audit');
const waddle = require('../services/waddle');
const admin = require('../services/waddle/admin');

const router = express.Router();
router.use(requireFeature('plaza'), requireAuth, requireStaff);

async function ctx() {
  const w = await waddle.getWaddle();
  return { w, store: waddle.getStore() };
}

router.get('/catalog', async (req, res, next) => {
  try {
    const { w } = await ctx();
    res.set('Cache-Control', 'private, max-age=600');
    res.json(admin.getCatalog(w));
  } catch (err) { next(err); }
});

router.get('/penguins', async (req, res, next) => {
  try {
    const { w, store } = await ctx();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    res.json(await admin.listPenguins(w, store, { q: req.query.q, page }));
  } catch (err) { next(err); }
});

router.get('/penguins/:id', async (req, res, next) => {
  try {
    const { w, store } = await ctx();
    const p = await admin.getPenguin(w, store, req.params.id);
    if (!p) return res.status(404).json({ error: 'Pinguim não encontrado.' });
    return res.json(p);
  } catch (err) { next(err); }
});

router.patch('/penguins/:id', async (req, res, next) => {
  try {
    const { w, store } = await ctx();
    const out = await admin.updatePenguin(w, store, req.params.id, req.body || {});
    if (!out) return res.status(404).json({ error: 'Pinguim não encontrado.' });
    if (out.changes.length) {
      logAction(req.app.get('io'), {
        actorId: req.user.id, action: 'GAME_PENGUIN_EDIT', targetType: 'USER', targetId: out.penguin.userId || null,
        reason: String(req.body?.reason || '').slice(0, 180) || null,
        metadata: { penguinId: out.penguin.id, penguinName: out.penguin.name, changes: out.changes.slice(0, 40) },
      }).catch(() => {});
    }
    return res.json(out);
  } catch (err) { next(err); }
});

router.post('/penguins/:id/kick', async (req, res, next) => {
  try {
    const { w } = await ctx();
    const ok = await admin.kickPenguin(w, req.params.id);
    if (ok) logAction(req.app.get('io'), { actorId: req.user.id, action: 'GAME_PENGUIN_KICK', targetType: 'PENGUIN', targetId: String(req.params.id) }).catch(() => {});
    return res.json({ ok });
  } catch (err) { next(err); }
});

// Festas de 2013-2017 (ver services/waddle/parties.js): lista, rodízio do mês
// e a festa ligada pela staff (as de outras marcas só rodam por aqui).
router.get('/parties', async (req, res, next) => {
  try {
    await ctx();
    res.json(require('../services/waddle/parties').list());
  } catch (err) { next(err); }
});

router.post('/parties/active', async (req, res, next) => {
  try {
    await ctx();
    const slug = req.body?.slug ? String(req.body.slug) : null;
    const out = require('../services/waddle/parties').setManual(slug, { reload: req.body?.reload !== false });
    logAction(req.app.get('io'), {
      actorId: req.user.id, action: 'GAME_PARTY_SET', targetType: 'PARTY', targetId: slug || 'calendario',
      metadata: { slug, kicked: out.kicked },
    }).catch(() => {});
    res.json(out);
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

module.exports = router;
