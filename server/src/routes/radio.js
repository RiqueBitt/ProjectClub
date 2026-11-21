// Rádio do Project Club (services/radio.js): a equipe configura a lista de
// um canal de voz. Ler: qualquer membro logado. Mudar: MANAGE_CHANNELS.
const express = require('express');
const prisma = require('../config/prisma');
const { requireAuth } = require('../middleware/auth');
const { requireCommunityPermission } = require('../services/authz');
const radio = require('../services/radio');
const { parseVideoId } = require('../sockets/ytWatch');

const router = express.Router();
router.use(requireAuth);

const shape = (st) => (st ? { channelId: st.channelId, enabled: st.enabled, shuffle: st.shuffle, tracks: radio.parsePlaylist(st.playlist) } : null);

router.get('/:channelId', async (req, res, next) => {
  try { res.json({ station: shape(await radio.getStation(req.params.channelId)) }); } catch (err) { next(err); }
});

router.put('/:channelId', express.json({ limit: '64kb' }), async (req, res, next) => {
  try {
    await requireCommunityPermission(req.user.id, 'MANAGE_CHANNELS');
    const ch = await prisma.channel.findUnique({ where: { id: req.params.channelId }, select: { id: true, type: true } });
    if (!ch || ch.type !== 'VOICE') return res.status(400).json({ error: 'A rádio só pode ser um canal de voz.' });
    const st = await radio.saveStation(ch.id, req.body || {}, req.user.id, { parseVideoId });
    res.json({ station: shape(st) });
  } catch (err) { next(err); }
});

router.delete('/:channelId', async (req, res, next) => {
  try {
    await requireCommunityPermission(req.user.id, 'MANAGE_CHANNELS');
    await prisma.radioStation.delete({ where: { channelId: req.params.channelId } }).catch(() => null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
