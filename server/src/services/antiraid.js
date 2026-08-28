const prisma = require('../config/prisma');
const { logAction } = require('./audit');

// Como não existe mais "entrar em servidor por convite" (é uma comunidade
// única, todo mundo entra automaticamente ao se cadastrar), o anti-raid
// agora observa a janela de NOVOS CADASTROS — o equivalente mais próximo a
// "muita gente entrando de uma vez" nesse modelo.
const signupWindow = [];

async function getAntiRaidRule() {
  return prisma.autoModRule.findFirst({ where: { type: 'ANTI_RAID', enabled: true } });
}

// Chamado a cada cadastro bem-sucedido (ver authController.register).
// Retorna { raid: boolean, action } — quem chama decide o que fazer (a
// própria função já aplica kick/ban automaticamente quando configurado).
async function recordJoinAndCheck(io, userId) {
  const rule = await getAntiRaidRule();
  if (!rule) return { raid: false };

  let config = {};
  try { config = JSON.parse(rule.config || '{}'); } catch { config = {}; }
  const maxJoins = config.maxJoinsPerWindow ?? 10;
  const windowSeconds = config.windowSeconds ?? 60;
  const windowMs = windowSeconds * 1000;

  const now = Date.now();
  while (signupWindow.length && now - signupWindow[0] > windowMs) signupWindow.shift();
  signupWindow.push(now);

  const raid = signupWindow.length > maxJoins;
  if (raid) {
    const reason = `Anti-raid: ${signupWindow.length} cadastros em ${windowSeconds}s (limite: ${maxJoins}).`;
    await logAction(io, { actorId: 'system', action: 'AUTOMOD_TRIGGER', targetType: 'MEMBER', targetId: userId, reason, metadata: { ruleType: 'ANTI_RAID', ruleAction: rule.action } });
    io?.to('community').emit('automod:raid-alert', { reason, recentJoins: signupWindow.length });

    if (rule.action === 'KICK' || rule.action === 'BAN') {
      await prisma.ban.upsert({
        where: { userId },
        update: { reason, moderatorId: 'system' },
        create: { userId, reason, moderatorId: 'system' },
      }).catch(() => {});
      await prisma.user.update({ where: { id: userId }, data: { isPlatformBanned: true, platformBanReason: reason } }).catch(() => {});
      io?.notifyUser?.(userId, 'account:banned', { reason, automated: true });
    }
  }

  return { raid, action: rule.action };
}

module.exports = { recordJoinAndCheck };
