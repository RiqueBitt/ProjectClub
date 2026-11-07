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

// Mensagens da EPF (telefone espião dentro do jogo)
router.get('/epf', async (req, res, next) => {
  try {
    await ctx();
    const epf = require('../services/waddle/epf');
    res.json({ messages: epf.list(), mascots: epf.MASCOTS });
  } catch (err) { next(err); }
});

router.post('/epf', async (req, res, next) => {
  try {
    await ctx();
    const out = require('../services/waddle/epf').add(req.body?.message, req.body?.mascot);
    logAction(req.app.get('io'), {
      actorId: req.user.id, action: 'GAME_EPF_MESSAGE', targetType: 'EPF', targetId: 'phone',
      metadata: { message: String(req.body?.message || '').slice(0, 300) },
    }).catch(() => {});
    res.json(out);
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

router.delete('/epf', async (req, res, next) => {
  try {
    await ctx();
    res.json(require('../services/waddle/epf').remove(req.body?.time, req.body?.message));
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

// ---- Eventos da Praça (services/waddle/events.js) ----
const events = require('../services/waddle/events');
const parties = require('../services/waddle/parties');
const evWrap = (fn) => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Não encontrado.' });
    if (err && err.message && !/prisma|ECONN/i.test(err.message)) return res.status(400).json({ error: err.message });
    return next(err);
  }
};
router.get('/events', evWrap(async () => ({ events: await events.listEvents(), codes: await events.listCodes(), visits: await events.listVisits(), party: parties.status().active || null })));
router.get('/events/template', evWrap(async () => {
  const st = parties.status();
  const p = st.active ? parties._data.parties.find((x) => x.slug === st.active.slug) : null;
  const rooms = p ? Object.keys(p.rooms || {}).map(Number).filter(Boolean) : [];
  return events.templateForParty(p ? { slug: p.slug, name: p.name, label: p.label } : null, rooms);
}));
router.put('/events', evWrap(async (req) => {
  const row = await events.saveEvent(req.body || {});
  await logAction(req.app.get('io'), { actorId: req.user.id, action: 'PLAZA_EVENT_SAVE', targetType: 'PLAZA_EVENT', targetId: row.slug, metadata: { name: row.name } }).catch(() => {});
  return row;
}));
router.delete('/events/:slug', evWrap(async (req) => { await events.deleteEvent(req.params.slug); await logAction(req.app.get('io'), { actorId: req.user.id, action: 'PLAZA_EVENT_DELETE', targetType: 'PLAZA_EVENT', targetId: req.params.slug }).catch(() => {}); return { ok: true }; }));
router.put('/codes', evWrap(async (req) => { const c = await events.saveCode(req.body || {}); await logAction(req.app.get('io'), { actorId: req.user.id, action: 'PLAZA_CODE_SAVE', targetType: 'PLAZA_CODE', targetId: c.code }).catch(() => {}); return c; }));
router.delete('/codes/:code', evWrap(async (req) => { await events.deleteCode(req.params.code); return { ok: true }; }));
router.put('/visits', evWrap(async (req) => { const v = await events.saveVisit(req.body || {}); await logAction(req.app.get('io'), { actorId: req.user.id, action: 'PLAZA_MASCOT_VISIT', targetType: 'PLAZA_VISIT', targetId: v.id, metadata: { name: v.name, room: v.room } }).catch(() => {}); return v; }));
router.delete('/visits/:id', evWrap(async (req) => { await events.deleteVisit(req.params.id); return { ok: true }; }));
// modelos prontos (eventPresets.js): lista, corpo pronto pra editar e códigos sugeridos
const presets = require('../services/waddle/eventPresets');
router.get('/events/presets', evWrap(async () => presets.list()));
router.get('/events/presets/:key', evWrap(async (req) => { const b = presets.build(req.params.key); if (!b) throw new Error('Modelo desconhecido.'); return b; }));
router.post('/events/presets/:key/codes', evWrap(async (req) => {
  const b = presets.build(req.params.key); if (!b) throw new Error('Modelo desconhecido.');
  const out = []; for (const c of b.codes) out.push(await events.saveCode({ ...c, eventSlug: b.slug }));
  await logAction(req.app.get('io'), { actorId: req.user.id, action: 'PLAZA_CODE_SAVE', targetType: 'PLAZA_CODE', targetId: req.params.key, metadata: { n: out.length } }).catch(() => {});
  return out;
}));

// ---- Concursos (contests.js) ----
const contests = require('../services/waddle/contests');
router.get('/contests', evWrap(async () => contests.list()));
router.get('/contests/:id', evWrap(async (req) => contests.detail(req.params.id)));
router.put('/contests', evWrap(async (req) => { const c = await contests.save(req.body || {}); await logAction(req.app.get('io'), { actorId: req.user.id, action: 'PLAZA_CONTEST_SAVE', targetType: 'PLAZA_CONTEST', targetId: c.id, metadata: { title: c.title } }).catch(() => {}); return c; }));
router.delete('/contests/:id', evWrap(async (req) => { await contests.remove(req.params.id); return { ok: true }; }));
router.post('/contests/:id/winners', evWrap(async (req) => { const out = await contests.pickWinners(req.params.id, req.body?.entryIds || []); await logAction(req.app.get('io'), { actorId: req.user.id, action: 'PLAZA_CONTEST_WINNERS', targetType: 'PLAZA_CONTEST', targetId: req.params.id, metadata: { winners: out.map((w) => w.userId) } }).catch(() => {}); return out; }));
router.post('/contests/entries/:entryId/hide', evWrap(async (req) => contests.hideEntry(req.params.entryId, req.body?.hidden !== false)));

// ---- Jigsaw Jam (puzzles.js) ----
const puzzles = require('../services/waddle/puzzles');
router.get('/puzzles', evWrap(async () => puzzles.list()));
router.patch('/puzzles/:id', evWrap(async (req) => puzzles.review(req.params.id, req.body || {})));
router.delete('/puzzles/:id', evWrap(async (req) => { await puzzles.remove(req.params.id); return { ok: true }; }));
router.put('/puzzles/settings', evWrap(async (req) => puzzles.saveSettings(req.body || {})));

// ---- Ilha 2015 (island.js): mapa de junho/2015 + salas do hotel/parque/escola ----
const island = require('../services/waddle/island');
router.get('/island', evWrap(async () => island.status()));
router.put('/island', evWrap(async (req) => { const st = await island.setEnabled(req.body?.enabled !== false); await logAction(req.app.get('io'), { actorId: req.user.id, action: 'PLAZA_ISLAND_TOGGLE', targetType: 'PLAZA', targetId: 'island-2015', metadata: { enabled: st.enabled } }).catch(() => {}); return st; }));
router.post('/island/download', evWrap(async () => island.ensureFiles()));

// ---- Arquivos da Club Penguin Archives (assets.js) ----
const assets = require('../services/waddle/assets');
router.get('/assets', evWrap(async () => assets.list()));
router.post('/assets', evWrap(async (req) => { const a = await assets.add(req.body || {}); await logAction(req.app.get('io'), { actorId: req.user.id, action: 'PLAZA_ASSET_ADD', targetType: 'PLAZA_ASSET', targetId: a.id, metadata: { kind: a.kind, target: a.target, source: a.source } }).catch(() => {}); return a; }));
router.patch('/assets/:id', evWrap(async (req) => assets.update(req.params.id, req.body || {})));
router.delete('/assets/:id', evWrap(async (req) => { await assets.remove(req.params.id); return { ok: true }; }));

// salas do jogo (id + nome) pra equipe montar quests sem decorar números
router.get('/rooms', async (req, res, next) => {
  try {
    const { ROOMS } = require('../../waddle/dist/server/game-data/rooms.js');
    const island = require('../services/waddle/island');
    res.json(Object.entries(ROOMS).map(([key, r]) => ({ key, id: r.id, name: island.roomName(key) || r.name })).filter((r) => r.id).sort((a, b) => a.id - b.id));
  } catch (err) { next(err); }
});
// contas da equipe (pra marcar quem "veste" um mascote)
router.get('/staff-accounts', async (req, res, next) => {
  try {
    const prisma = require('../config/prisma');
    res.json(await prisma.user.findMany({ where: { platformRole: { in: ['ADMIN', 'MODERATOR'] } }, select: { id: true, username: true, displayName: true }, take: 100 }));
  } catch (err) { next(err); }
});

module.exports = router;
