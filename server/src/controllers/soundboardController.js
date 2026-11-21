// Soundboard nas calls (item "Soundboard nas calls").
//
// A staff (permissão MANAGE_EMOJIS, a mesma dos emojis) sobe sons curtos
// (até MAX_DURATION_MS); quem está numa call e tem USE_SOUNDBOARD no canal
// toca pra todo mundo da sala pelo socket 'soundboard:play' (sockets/index.js
// → services/soundboard.js). O áudio toca no navegador de cada um (não passa
// pelo servidor de mídia) e respeita quem está ensurdecido.
const prisma = require('../config/prisma');
const { requireCommunityPermission } = require('../services/authz');
const { MAX_SOUNDS, MAX_DURATION_MS, cleanName, cleanEmoji, invalidate } = require('../services/soundboard');

const shape = (s) => ({ id: s.id, name: s.name, emoji: s.emoji, url: s.url, durationMs: s.durationMs });

async function listSounds(_req, res, next) {
  try {
    const sounds = await prisma.soundboardSound.findMany({ orderBy: { createdAt: 'asc' } });
    res.setHeader('Cache-Control', 'private, max-age=30');
    res.json({ sounds: sounds.map(shape) });
  } catch (err) { next(err); }
}

async function createSound(req, res, next) {
  try {
    await requireCommunityPermission(req.user.id, 'MANAGE_EMOJIS');
    if (!req.file?.url) return res.status(400).json({ error: 'Envie um arquivo de áudio (mp3, ogg, wav ou webm).' });
    const name = cleanName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Dê um nome ao som (até 32 letras).' });
    const durationMs = Math.round(Number(req.body.durationMs) || 0);
    if (durationMs > MAX_DURATION_MS + 250) return res.status(400).json({ error: `O som pode ter no máximo ${MAX_DURATION_MS / 1000} segundos.` });
    if (await prisma.soundboardSound.count() >= MAX_SOUNDS) return res.status(400).json({ error: `Limite de ${MAX_SOUNDS} sons atingido.` });
    if (await prisma.soundboardSound.findUnique({ where: { name } })) return res.status(409).json({ error: 'Já existe um som com esse nome.' });
    const sound = await prisma.soundboardSound.create({
      data: { name, emoji: cleanEmoji(req.body.emoji), url: req.file.url, durationMs: Math.max(0, durationMs), createdById: req.user.id },
    });
    invalidate();
    req.app.get('io')?.to('community').emit('soundboard:changed');
    res.status(201).json({ sound: shape(sound) });
  } catch (err) { next(err); }
}

async function updateSound(req, res, next) {
  try {
    await requireCommunityPermission(req.user.id, 'MANAGE_EMOJIS');
    const data = {};
    if (req.body.name !== undefined) {
      data.name = cleanName(req.body.name);
      if (!data.name) return res.status(400).json({ error: 'Nome inválido.' });
      const dup = await prisma.soundboardSound.findUnique({ where: { name: data.name } });
      if (dup && dup.id !== req.params.id) return res.status(409).json({ error: 'Já existe um som com esse nome.' });
    }
    if (req.body.emoji !== undefined) data.emoji = cleanEmoji(req.body.emoji);
    const sound = await prisma.soundboardSound.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!sound) return res.status(404).json({ error: 'Som não encontrado.' });
    invalidate();
    req.app.get('io')?.to('community').emit('soundboard:changed');
    res.json({ sound: shape(sound) });
  } catch (err) { next(err); }
}

async function deleteSound(req, res, next) {
  try {
    await requireCommunityPermission(req.user.id, 'MANAGE_EMOJIS');
    await prisma.soundboardSound.delete({ where: { id: req.params.id } }).catch(() => null);
    invalidate();
    req.app.get('io')?.to('community').emit('soundboard:changed');
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { listSounds, createSound, updateSound, deleteSound };
