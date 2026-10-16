const prisma = require('../config/prisma');
const missions = require('../services/missions');
const achievements = require('../services/achievements');

async function listMyMissions(req, res, next) {
  try {
    res.json(await missions.listForUser(req.user.id));
  } catch (err) { next(err); }
}

async function claimMission(req, res, next) {
  try {
    const io = req.app.get('io');
    const result = await missions.claim(req.user.id, req.params.id, io);
    const newAchievements = await achievements.checkAndUnlock(req.user.id, io).catch(() => []);
    res.json({ ...result, newAchievements });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// Eventos que só o cliente enxerga (ex: abrir a Loja). Lista fechada.
async function trackClientEvent(req, res, next) {
  try {
    const type = String(req.body?.type || '');
    if (!missions.CLIENT_TRACKABLE.has(type)) return res.status(400).json({ error: 'Evento inválido.' });
    await missions.track(req.user.id, type, 1, req.app.get('io'));
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// --- Staff (Admin → Economia → Missões) ---

const INT_FIELDS = ['target', 'rewardCoins', 'rewardGems', 'rewardXp', 'position'];

function sanitize(body, { partial }) {
  const data = {};
  if (body.title !== undefined) data.title = String(body.title).trim().slice(0, 120);
  if (body.description !== undefined) data.description = body.description ? String(body.description).trim().slice(0, 500) : null;
  if (body.period !== undefined) {
    if (!missions.PERIODS.includes(body.period)) throw Object.assign(new Error('Período inválido.'), { status: 400 });
    data.period = body.period;
  }
  if (body.type !== undefined) {
    if (!missions.MISSION_TYPES[body.type]) throw Object.assign(new Error('Tipo de missão inválido.'), { status: 400 });
    data.type = body.type;
  }
  if (body.enabled !== undefined) data.enabled = !!body.enabled;
  for (const k of INT_FIELDS) {
    if (body[k] === undefined) continue;
    const n = parseInt(body[k], 10);
    data[k] = Number.isFinite(n) ? Math.max(k === 'target' ? 1 : 0, Math.min(1000000, n)) : (k === 'target' ? 1 : 0);
  }
  if (!partial) {
    if (!data.title) throw Object.assign(new Error('Dê um nome para a missão.'), { status: 400 });
    if (!data.type) throw Object.assign(new Error('Escolha o tipo da missão.'), { status: 400 });
  }
  if (data.title !== undefined && !data.title) throw Object.assign(new Error('Dê um nome para a missão.'), { status: 400 });
  // Item da Loja como recompensa (opcional, com prazo em dias).
  if (body.rewardItemKind !== undefined || body.rewardItemId !== undefined) {
    const kind = ['deco', 'effect', 'font', 'style'].includes(body.rewardItemKind) ? body.rewardItemKind : null;
    const id = kind && body.rewardItemId ? String(body.rewardItemId).slice(0, 64) : null;
    data.rewardItemKind = id ? kind : null;
    data.rewardItemId = id;
  }
  if (body.rewardItemDays !== undefined) {
    const n = parseInt(body.rewardItemDays, 10);
    data.rewardItemDays = Number.isFinite(n) && n > 0 ? Math.min(365, n) : null;
  }
  return data;
}

async function checkRewardItem(data) {
  if (!data.rewardItemId) return;
  const { findItem, isLimited } = require('./shopController');
  const it = await findItem(prisma, data.rewardItemKind, data.rewardItemId);
  if (!it) throw Object.assign(new Error('O item da recompensa não existe.'), { status: 400 });
  if (isLimited(it)) throw Object.assign(new Error('Itens limitados (com estoque) não podem ser recompensa de missão.'), { status: 400 });
}

function changed(req) {
  missions.invalidateCache();
  req.app.get('io')?.to('community').emit('missions:update');
}

async function adminListMissions(req, res, next) {
  try {
    const list = await prisma.mission.findMany({ orderBy: [{ period: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }] });
    res.json({ missions: list, types: missions.MISSION_TYPES, periods: missions.PERIODS });
  } catch (err) { next(err); }
}

async function adminCreateMission(req, res, next) {
  try {
    const data = sanitize(req.body || {}, { partial: false });
    await checkRewardItem(data);
    if (data.position === undefined) data.position = await prisma.mission.count();
    const mission = await prisma.mission.create({ data });
    changed(req);
    res.status(201).json({ mission });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function adminUpdateMission(req, res, next) {
  try {
    const data = sanitize(req.body || {}, { partial: true });
    await checkRewardItem(data);
    const mission = await prisma.mission.update({ where: { id: req.params.id }, data });
    changed(req);
    res.json({ mission });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Missão não encontrada.' });
    next(err);
  }
}

async function adminDeleteMission(req, res, next) {
  try {
    await prisma.mission.delete({ where: { id: req.params.id } });
    changed(req);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Missão não encontrada.' });
    next(err);
  }
}

module.exports = {
  listMyMissions, claimMission, trackClientEvent,
  adminListMissions, adminCreateMission, adminUpdateMission, adminDeleteMission,
};
