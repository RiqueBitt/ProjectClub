const prisma = require('../config/prisma');
const dice = require('../services/dice');
const yt = require('../services/youtubeBrowse');

// Atividades do chat (botão "Atividades" da barra de mensagem).
//   POST /api/activities/dice           rola (no servidor) e guarda; o chat manda o link /dados/<id>
//   GET  /api/activities/dice/:id       resultado pro cartão do chat
//   GET  /api/activities/youtube/:id    título/canal do vídeo pros cartões de YouTube e Música

const USER_SELECT = { id: true, username: true, displayName: true, avatarUrl: true };
const lastRoll = new Map(); // userId -> timestamp (1 rolagem a cada 1,5 s)

async function rollDice(req, res, next) {
  try {
    const now = Date.now();
    if (now - (lastRoll.get(req.user.id) || 0) < 1500) return res.status(429).json({ error: 'Calma! Espere um instante pra rolar de novo.' });
    const r = dice.roll(req.body || {});
    lastRoll.set(req.user.id, now);
    if (lastRoll.size > 5000) lastRoll.delete(lastRoll.keys().next().value);
    const row = await prisma.diceRoll.create({
      data: { userId: req.user.id, total: r.total, data: JSON.stringify({ groups: r.groups, modifier: r.modifier, label: r.label }) },
    });
    res.status(201).json({ id: row.id, ...r, notation: dice.notation(r), createdAt: row.createdAt });
  } catch (err) { next(err); }
}

async function getDice(req, res, next) {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: 'Rolagem não encontrada.' });
    const row = await prisma.diceRoll.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: 'Rolagem não encontrada.' });
    const user = await prisma.user.findUnique({ where: { id: row.userId }, select: USER_SELECT });
    let data = {};
    try { data = JSON.parse(row.data); } catch { /* registro estragado */ }
    const r = { groups: data.groups || [], modifier: data.modifier || 0, label: data.label || null, total: row.total };
    res.json({ id: row.id, ...r, notation: dice.notation(r), user, createdAt: row.createdAt });
  } catch (err) { next(err); }
}

async function youtubeInfo(req, res, next) {
  try {
    const info = await yt.videoInfo(req.params.id);
    if (!info) return res.status(404).json({ error: 'Vídeo não encontrado.' });
    res.json({ videoId: info.videoId, title: info.title, channel: info.channel, durationSec: info.durationSec, playable: info.playable });
  } catch (err) { next(err); }
}

module.exports = { rollDice, getDice, youtubeInfo };
