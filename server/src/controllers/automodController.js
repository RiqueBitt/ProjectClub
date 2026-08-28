const prisma = require('../config/prisma');
const { requireCommunityPermission } = require('../services/authz');
const { logAction } = require('../services/audit');
const { invalidateCache } = require('../services/automod');

const VALID_TYPES = ['BANNED_WORDS', 'SPAM_LINKS', 'MENTION_SPAM', 'MESSAGE_RATE', 'ANTI_RAID'];
const VALID_ACTIONS = ['DELETE', 'WARN', 'TIMEOUT', 'KICK', 'BAN'];

function shapeRule(rule) {
  let config = {};
  try { config = JSON.parse(rule.config || '{}'); } catch { config = {}; }
  return { ...rule, config };
}

async function listRules(req, res, next) {
  try {
    await requireCommunityPermission(req.user.id, 'MANAGE_COMMUNITY');
    const rules = await prisma.autoModRule.findMany({ orderBy: { createdAt: 'asc' } });
    res.json({ rules: rules.map(shapeRule) });
  } catch (err) { next(err); }
}

async function createRule(req, res, next) {
  try {
    const { type, action, enabled, config } = req.body || {};
    await requireCommunityPermission(req.user.id, 'MANAGE_COMMUNITY');
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'Tipo de regra inválido.' });
    const actionValue = VALID_ACTIONS.includes(action) ? action : 'DELETE';

    const rule = await prisma.autoModRule.create({
      data: {
        type, action: actionValue,
        enabled: enabled === undefined ? true : !!enabled,
        config: JSON.stringify(config || {}),
      },
    });
    invalidateCache();
    const io = req.app.get('io');
    io?.to('community').emit('automod:update', {});
    await logAction(io, { actorId: req.user.id, action: 'AUTOMOD_RULE_CREATE', targetType: 'AUTOMOD', targetId: rule.id, metadata: { type, action: actionValue } });
    res.status(201).json({ rule: shapeRule(rule) });
  } catch (err) { next(err); }
}

async function updateRule(req, res, next) {
  try {
    const { id } = req.params;
    await requireCommunityPermission(req.user.id, 'MANAGE_COMMUNITY');
    const existing = await prisma.autoModRule.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Regra não encontrada.' });

    const data = {};
    if (req.body.enabled !== undefined) data.enabled = !!req.body.enabled;
    if (VALID_ACTIONS.includes(req.body.action)) data.action = req.body.action;
    if (req.body.config !== undefined) data.config = JSON.stringify(req.body.config || {});

    const rule = await prisma.autoModRule.update({ where: { id }, data });
    invalidateCache();
    const io = req.app.get('io');
    io?.to('community').emit('automod:update', {});
    await logAction(io, { actorId: req.user.id, action: 'AUTOMOD_RULE_UPDATE', targetType: 'AUTOMOD', targetId: rule.id });
    res.json({ rule: shapeRule(rule) });
  } catch (err) { next(err); }
}

async function deleteRule(req, res, next) {
  try {
    const { id } = req.params;
    await requireCommunityPermission(req.user.id, 'MANAGE_COMMUNITY');
    const existing = await prisma.autoModRule.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Regra não encontrada.' });
    await prisma.autoModRule.delete({ where: { id } });
    invalidateCache();
    const io = req.app.get('io');
    io?.to('community').emit('automod:update', {});
    await logAction(io, { actorId: req.user.id, action: 'AUTOMOD_RULE_DELETE', targetType: 'AUTOMOD', targetId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { listRules, createRule, updateRule, deleteRule };
