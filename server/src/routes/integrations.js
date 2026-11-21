// Integrações (Fase 6): status do Minecraft, YouTube → Novidades e webhooks
// de canais. Ver services/minecraftStatus.js, youtubeAnnouncer.js, webhooks.js.
const express = require('express');
const prisma = require('../config/prisma');
const { requireAuth } = require('../middleware/auth');
const { requireCommunityPermission } = require('../services/authz');
const config = require('../services/integrationConfig');
const minecraft = require('../services/minecraftStatus');
const youtube = require('../services/youtubeAnnouncer');
const webhooks = require('../services/webhooks');
const env = require('../config/env');

const router = express.Router();
router.use(requireAuth);

const isAdmin = (req) => req.user?.platformRole === 'ADMIN';
const fail = (res, err, next) => (err?.status ? res.status(err.status).json({ error: err.message }) : next(err));

// ---- Minecraft (qualquer membro vê) ----
router.get('/minecraft', async (_req, res, next) => {
  try {
    const cfg = await config.getConfig('minecraft', minecraft.DEFAULT);
    res.setHeader('Cache-Control', 'private, max-age=30');
    res.json({ status: await minecraft.getStatus(cfg) });
  } catch (err) { next(err); }
});

// ---- Painel (só ADMIN) ----
router.get('/admin', async (req, res, next) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Só a administração.' });
    const [yt, mc] = await Promise.all([config.getConfig(youtube.KEY, youtube.DEFAULT), config.getConfig('minecraft', minecraft.DEFAULT)]);
    res.json({
      youtube: { enabled: !!yt.enabled, channelId: yt.channelId, channelTitle: yt.channelTitle, primed: !!yt.primed },
      minecraft: { enabled: mc.enabled !== false, host: mc.host, port: mc.port, name: mc.name },
    });
  } catch (err) { next(err); }
});

router.put('/admin/youtube', express.json({ limit: '8kb' }), async (req, res, next) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Só a administração.' });
    const cur = await config.getConfig(youtube.KEY, youtube.DEFAULT);
    const enabled = !!req.body?.enabled;
    let { channelId, channelTitle, seen, primed } = cur;
    if (req.body?.channel !== undefined && String(req.body.channel).trim()) {
      const id = await youtube.resolveChannelId(req.body.channel);
      if (!id) return res.status(400).json({ error: 'Não achei esse canal. Cole o link do canal (youtube.com/@nome ou /channel/UC…).' });
      if (id !== channelId) { channelId = id; channelTitle = null; seen = []; primed = false; }
    }
    if (enabled && !channelId) return res.status(400).json({ error: 'Escolha o canal do YouTube.' });
    const saved = await config.setConfig(youtube.KEY, { enabled, channelId, channelTitle, seen, primed, byUserId: req.user.id }, req.user.id);
    // Liga já: marca os vídeos atuais como vistos (não despeja os antigos).
    if (enabled) youtube.tick(req.app.get('io')).catch(() => {});
    res.json({ youtube: { enabled: saved.enabled, channelId: saved.channelId, channelTitle: saved.channelTitle } });
  } catch (err) { next(err); }
});

router.put('/admin/minecraft', express.json({ limit: '8kb' }), async (req, res, next) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Só a administração.' });
    const host = String(req.body?.host || '').trim().toLowerCase();
    const port = Number(req.body?.port) || 25565;
    if (!minecraft.HOST_RE.test(host) || port < 1 || port > 65535) return res.status(400).json({ error: 'Endereço ou porta inválidos.' });
    const data = { enabled: req.body?.enabled !== false, host, port, name: String(req.body?.name || '').trim().slice(0, 40) || host };
    await config.setConfig('minecraft', data, req.user.id);
    minecraft._reset();
    res.json({ minecraft: data, status: await minecraft.getStatus(data) });
  } catch (err) { next(err); }
});

// ---- Webhooks (MANAGE_CHANNELS) ----
const baseUrl = () => String(env.CLIENT_ORIGIN || '').replace(/\/+$/, '');

router.get('/webhooks', async (req, res, next) => {
  try {
    await requireCommunityPermission(req.user.id, 'MANAGE_CHANNELS');
    const where = req.query.channelId ? { channelId: String(req.query.channelId) } : {};
    const rows = await prisma.channelWebhook.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
    res.json({ webhooks: rows.map((w) => webhooks.publicWebhook(w)) });
  } catch (err) { fail(res, err, next); }
});

router.post('/webhooks', express.json({ limit: '4kb' }), async (req, res, next) => {
  try {
    await requireCommunityPermission(req.user.id, 'MANAGE_CHANNELS');
    const { webhook, token } = await webhooks.createWebhook({ channelId: String(req.body?.channelId || ''), name: req.body?.name, actorId: req.user.id });
    require('../services/sharedCache').invalidateShared?.('community');
    res.status(201).json({ webhook: webhooks.publicWebhook(webhook, baseUrl(), token) });
  } catch (err) { fail(res, err, next); }
});

router.post('/webhooks/:id/rotate', async (req, res, next) => {
  try {
    await requireCommunityPermission(req.user.id, 'MANAGE_CHANNELS');
    const { webhook, token } = await webhooks.rotateToken(req.params.id);
    res.json({ webhook: webhooks.publicWebhook(webhook, baseUrl(), token) });
  } catch (err) { fail(res, err, next); }
});

router.delete('/webhooks/:id', async (req, res, next) => {
  try {
    await requireCommunityPermission(req.user.id, 'MANAGE_CHANNELS');
    await webhooks.deleteWebhook(req.params.id);
    res.json({ ok: true });
  } catch (err) { fail(res, err, next); }
});

// ---- Envio externo (SEM login: a URL secreta é a credencial) ----
const publicRouter = express.Router();
publicRouter.post('/:id/:token', express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const { messageInclude, roomFor } = require('../controllers/messageController');
    const io = req.app.get('io');
    const message = await webhooks.execute(req.params.id, req.params.token, req.body, {
      post: async ({ channelId, authorId, content, embed }) => {
        const m = await prisma.message.create({
          data: { content, embed: embed ? JSON.stringify(embed) : null, authorId, channelId, quickReactions: '[]' },
          include: messageInclude,
        });
        io?.to(roomFor({ channelId })).emit('message:new', m);
        return m;
      },
    });
    if (req.query.wait === 'true') res.json({ id: message.id });
    else res.status(204).end();
  } catch (err) {
    res.status(err?.status || 500).json({ error: err?.status ? err.message : 'Falha ao postar.' });
  }
});

module.exports = router;
module.exports.publicRouter = publicRouter;
