const prisma = require('../config/prisma');

// Insígnias de apoio: quem é Assinante ganha a insígnia "Assinante"; quem
// é Super Assinante ganha a "Super Assinante". Seguem a categoria atual —
// subiu, troca; perdeu o apoio, a insígnia sai junto (igual ao benefício).
// A staff pode trocar nome/ícone/imagem/prioridade no painel de insígnias;
// aqui só garante que elas existem (sem sobrescrever o que foi editado).
const BADGES = {
  SUBSCRIBER: { key: 'SUPPORTER_SUBSCRIBER', name: 'Assinante', description: 'Apoia o Project Club como Assinante.', icon: '💜', iconUrl: '/badges/SUPPORTER_SUBSCRIBER.png', rarity: 'EPIC', priority: 7 },
  SUPER: { key: 'SUPPORTER_SUPER', name: 'Super Assinante', description: 'Apoia o Project Club como Super Assinante.', icon: '🌟', iconUrl: '/badges/SUPPORTER_SUPER.png', rarity: 'LEGENDARY', priority: 6 },
};
const KEYS = Object.values(BADGES).map((b) => b.key);

let ensured = null;
async function ensureBadges() {
  if (!ensured) {
    ensured = (async () => {
      const out = {};
      for (const [tier, b] of Object.entries(BADGES)) {
        out[tier] = await prisma.badge.upsert({ where: { key: b.key }, update: {}, create: b });
      }
      return out;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

// Deixa as insígnias de apoio da pessoa iguais à categoria dela.
async function syncSupporterBadges(userId, tier) {
  try {
    const badges = await ensureBadges();
    const want = badges[tier]?.id || null;
    const all = Object.values(badges).map((b) => b.id);
    const remove = all.filter((id) => id !== want);
    if (remove.length) await prisma.userBadge.deleteMany({ where: { userId, badgeId: { in: remove } } });
    if (want) await prisma.userBadge.upsert({ where: { userId_badgeId: { userId, badgeId: want } }, update: {}, create: { userId, badgeId: want } });
  } catch (e) {
    console.warn('[apoio] insígnias:', e.message);
  }
}

// Na subida do servidor: acerta todo mundo (quem já era apoiador antes
// das insígnias existirem e quem perdeu o apoio).
async function backfillSupporterBadges() {
  const badges = await ensureBadges();
  const supporters = await prisma.user.findMany({ where: { supporterTier: { in: ['SUBSCRIBER', 'SUPER'] } }, select: { id: true, supporterTier: true } });
  for (const u of supporters) await syncSupporterBadges(u.id, u.supporterTier);
  const ids = new Set(supporters.map((u) => u.id));
  const holders = await prisma.userBadge.findMany({ where: { badgeId: { in: Object.values(badges).map((b) => b.id) } }, select: { userId: true } });
  for (const h of holders) if (!ids.has(h.userId)) await syncSupporterBadges(h.userId, 'NONE');
}

module.exports = { BADGES, KEYS, ensureBadges, syncSupporterBadges, backfillSupporterBadges };
