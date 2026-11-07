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

// Otimização de memória: antes cada par canal+usuário que já mandou uma
// mensagem ficava no Map PRA SEMPRE (só o array era filtrado). Com muita
// gente e muitos canais isso crescia sem parar. Agora uma varredura
// periódica apaga as janelas já vazias (ninguém falou nos últimos 60s).
const SWEEP_MS = 60 * 1000;
const MAX_WINDOW_MS = 60 * 1000; // maior janela que alguém configura na prática
setInterval(() => {
  const now = Date.now();
  for (const [key, list] of messageWindows) {
    if (!list.length || now - list[list.length - 1] > MAX_WINDOW_MS) messageWindows.delete(key);
  }
}, SWEEP_MS).unref?.();

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

// Golpes conhecidos (sempre ligado, sem precisar de regra): sites que imitam
// Discord/Steam/Project Club pra roubar conta, "Nitro grátis", links com
// endereço disfarçado (punycode) e IP no lugar do site.
const OFFICIAL = ['discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media', 'discordstatus.com',
  'steampowered.com', 'steamcommunity.com', 'steamstatic.com', 'steam-chat.com', 'shardweb.app'];
// Erros de digitação de propósito (dlscord, steamcommunlty...) e iscas no nome
// do site (discord-gift, steam-nitro-free...). Sites de verdade como
// discord.js.org não caem aqui.
const TYPO = /(d[l1|]sc[o0]rd|disc0rd|dlsc|d1sc|dicsord|discrod|discorcl|steamc[o0]mmun[l1|]ty|steamcommunlty|stearn(community|powered)|steampovvered|projectc[1|]ub)/i;
const BAIT_BRAND = /(discord|steam|nitro|projectclub)/i;
const BAIT_WORD = /(gift|nitro|free|promo|claim|airdrop|bonus|reward|gratis|presente)/i;
const SCAM_TEXT = /(nitro\s*(gr[aá]tis|free|de\s*gra[cç]a)|free\s*nitro|gift\s*nitro|steam\s*gift|ganhe?\s*skins?\s*gr[aá]tis|airdrop)/i;
function phishingReason(content) {
  const links = extractLinks(content);
  if (!links.length) return null;
  for (const link of links) {
    if (/\/\/([^/]*\.)?xn--/i.test(link)) return 'Link com endereço disfarçado (possível golpe).';
    let host;
    try { host = new URL(link).hostname.toLowerCase().replace(/^www\./, ''); } catch { continue; }
    if (OFFICIAL.some((d) => host === d || host.endsWith(`.${d}`))) continue;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return 'Link para um endereço IP (possível golpe).';
    if (TYPO.test(host)) return 'Site que imita Discord/Steam/Project Club (golpe de roubo de conta).';
    const name = host.split('.').slice(0, -1).join('.');
    if (BAIT_BRAND.test(name) && BAIT_WORD.test(name)) return 'Site com isca de presente falso (golpe de roubo de conta).';
  }
  if (SCAM_TEXT.test(content || '')) return 'Mensagem com cara de golpe ("Nitro grátis"/presente falso com link).';
  return null;
}

async function checkMessage({ channelId, userId, content }) {
  const phish = phishingReason(content);
  if (phish) return { rule: { type: 'PHISHING', action: 'DELETE', config: {} }, reason: phish };
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
      io?.kickUser?.(userId, 'account:banned', { reason, automated: true });
    }
  }
  // 'DELETE' não precisa de ação extra além de não criar a mensagem + o log de auditoria acima.
}

module.exports = { checkMessage, applyAction, invalidateCache, extractLinks, phishingReason };
