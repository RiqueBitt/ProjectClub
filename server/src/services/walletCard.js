// Cartão da carteira (Economia): estilo e cartões mostrados no chat.
//
// Estilos: DEFAULT (azul, todo mundo), GOLD (preto e dourado, Assinante)
// e RAINBOW (preto e arco-íris, Super Assinante). Quem assina usa por
// padrão o estilo da sua categoria e pode trocar, na Loja, entre os que a
// categoria libera. Se a assinatura acaba, volta pro que ainda pode usar.
//
// "Mostrar cartão" no chat grava uma FOTO do cartão naquele instante
// (WalletCardShare): o link na mensagem aponta pra essa foto, então
// ninguém consegue inventar saldo nem ver o cartão de quem não mostrou.
const { normalizeTier } = require('./supporters');

const STYLES = ['DEFAULT', 'GOLD', 'RAINBOW'];
const ALLOWED = { NONE: ['DEFAULT'], SUBSCRIBER: ['DEFAULT', 'GOLD'], SUPER: ['DEFAULT', 'GOLD', 'RAINBOW'] };
const TIER_DEFAULT = { NONE: 'DEFAULT', SUBSCRIBER: 'GOLD', SUPER: 'RAINBOW' };
const SHARE_COOLDOWN_MS = 10 * 1000;

function effectiveTier(user, now = new Date()) {
  if (user?.supporterUntil && new Date(user.supporterUntil) <= now) return 'NONE';
  return normalizeTier(user?.supporterTier);
}
const allowedStyles = (tier) => ALLOWED[normalizeTier(tier)];
function styleFor(user, now) {
  const tier = effectiveTier(user, now);
  const pref = user?.walletCardStyle;
  return pref && allowedStyles(tier).includes(pref) ? pref : TIER_DEFAULT[tier];
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

async function setStyle(db, userId, style) {
  const want = String(style || '').toUpperCase();
  if (!STYLES.includes(want)) throw httpError(400, 'Estilo de cartão inválido.');
  const user = await db.user.findUnique({ where: { id: userId }, select: { supporterTier: true, supporterUntil: true } });
  const tier = effectiveTier(user);
  if (!allowedStyles(tier).includes(want)) throw httpError(403, want === 'RAINBOW' ? 'O cartão arco-íris é do Super Assinante.' : 'O cartão dourado é de Assinante.');
  await db.user.update({ where: { id: userId }, data: { walletCardStyle: want } });
  return { style: want, styles: allowedStyles(tier) };
}

async function share(db, userId, now = new Date()) {
  const last = await db.walletCardShare.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  if (last && now - new Date(last.createdAt) < SHARE_COOLDOWN_MS) throw httpError(429, 'Espere uns segundos pra mostrar o cartão de novo.');
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { coins: true, gems: true, accountLevel: true, supporterTier: true, supporterUntil: true, walletCardStyle: true },
  });
  if (!user) throw httpError(404, 'Conta não encontrada.');
  const row = await db.walletCardShare.create({
    data: { userId, coins: user.coins, gems: user.gems, level: user.accountLevel || 1, style: styleFor(user, now) },
  });
  return { id: row.id };
}

async function getShared(db, id) {
  const row = await db.walletCardShare.findUnique({ where: { id: String(id || '') } });
  if (!row) throw httpError(404, 'Cartão não encontrado.');
  const user = await db.user.findUnique({
    where: { id: row.userId },
    select: { id: true, displayName: true, username: true, avatarUrl: true, avatarDecoration: true, profileColor: true, createdAt: true },
  });
  return { card: { id: row.id, coins: row.coins, gems: row.gems, level: row.level, style: row.style, createdAt: row.createdAt }, user };
}

module.exports = { STYLES, ALLOWED, TIER_DEFAULT, effectiveTier, allowedStyles, styleFor, setStyle, share, getShared };
