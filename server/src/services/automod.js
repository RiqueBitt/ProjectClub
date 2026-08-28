const prisma = require('../config/prisma');
const { logAction } = require('./audit');

let ruleCache = null;

function invalidateCache() {
  ruleCache = null;
}

async function getRules() {
  if (ruleCache) return ruleCache;
  const rules = await prisma.autoModRule.findMany({ where: { enabled: true } });
  const parsed = rules.map((r) => {
    let config = {};
    try { config = JSON.parse(r.config || '{}'); } catch { config = {}; }
    return { ...r, config };
  });
  ruleCache = parsed;
  return parsed;
}

const messageWindows = new Map(); // `${channelId}:${userId}` -> timestamps[]

function recordMessageAndCheckRate(channelId, userId, { maxMessages = 5, windowSeconds = 10 } = {}) {
  const key = `${channelId}:${userId}`;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const list = (messageWindows.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  messageWindows.set(key, list);
  return list.length > maxMessages;
}

const URL_RE = /https?:\/\/[^\s]+/gi;

function extractLinks(content) {
  return content ? content.match(URL_RE) || [] : [];
}

async function checkMessage({ channelId, userId, content }) {
  const rules = await getRules();
  const text = (content || '').toLowerCase();

  for (const rule of rules) {
    if (rule.type === 'BANNED_WORDS') {
      const words = Array.isArray(rule.config.words) ? rule.config.words : [];
      const hit = words.find((w) => w && text.includes(String(w).toLowerCase()));
      if (hit) return { rule, reason: `Palavra bloqueada: "${hit}"` };
    }

    if (rule.type === 'SPAM_LINKS') {
      const links = extractLinks(content);
      if (links.length > 0) {
        const allowed = Array.isArray(rule.config.allowedDomains) ? rule.config.allowedDomains : [];
        const blocked = links.some((link) => {
          try {
            const host = new URL(link).hostname.replace(/^www\./, '');
            return !allowed.some((d) => host === d || host.endsWith(`.${d}`));
          } catch { return true; }
        });
        if (blocked) return { rule, reason: 'Link não permitido detectado na mensagem.' };
      }
    }

    if (rule.type === 'MENTION_SPAM') {
      const maxMentions = rule.config.maxMentions ?? 5;
      const count = (content || '').split('@').length - 1;
      if (count > maxMentions) return { rule, reason: `Excesso de menções (${count}).` };
    }

    if (rule.type === 'MESSAGE_RATE') {
      const maxMessages = rule.config.maxMessages ?? 5;
      const windowSeconds = rule.config.windowSeconds ?? 10;
      if (recordMessageAndCheckRate(channelId, userId, { maxMessages, windowSeconds })) {
        return { rule, reason: `Envio de mensagens muito rápido (mais de ${maxMessages} em ${windowSeconds}s).` };
      }
    }
  }

  return null;
}

// Aplica a ação configurada de uma regra disparada. Como agora só existe
// uma comunidade, "expulsar" equivale a banir (não há mais um segundo
// servidor pra onde o membro continua podendo ir).
async function applyAction(io, { userId, rule, reason }) {
  await logAction(io, {
    actorId: 'system', action: 'AUTOMOD_TRIGGER', targetType: 'MEMBER', targetId: userId,
    reason, metadata: { ruleType: rule.type, ruleAction: rule.action },
  });

  if (rule.action === 'WARN') {
    await prisma.warning.create({ data: { userId, reason, moderatorId: 'system' } }).catch(() => {});
    io?.notifyUser?.(userId, 'moderation:warning', { reason, automated: true });
  } else if (rule.action === 'TIMEOUT') {
    const minutes = rule.config?.timeoutMinutes ?? 10;
    const timeoutUntil = new Date(Date.now() + minutes * 60 * 1000);
    await prisma.user.update({ where: { id: userId }, data: { timeoutUntil } }).catch(() => {});
    io?.notifyUser?.(userId, 'moderation:timeout', { timeoutUntil, reason, automated: true });
  } else if (rule.action === 'KICK' || rule.action === 'BAN') {
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (target && target.platformRole !== 'ADMIN') {
      await prisma.ban.upsert({
        where: { userId },
        update: { reason, moderatorId: 'system' },
        create: { userId, reason, moderatorId: 'system' },
      }).catch(() => {});
      await prisma.user.update({ where: { id: userId }, data: { isPlatformBanned: true, platformBanReason: reason } }).catch(() => {});
      io?.notifyUser?.(userId, 'account:banned', { reason, automated: true });
    }
  }
  // 'DELETE' não precisa de ação extra além de não criar a mensagem + o log de auditoria acima.
}

module.exports = { checkMessage, applyAction, invalidateCache, extractLinks };
