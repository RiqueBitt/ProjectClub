// Tirar banimento / suspensão da plataforma — o MESMO caminho usado pelo
// Painel da Equipe (adminController.unbanUser/unsuspendUser), pela moderação
// da comunidade (moderationController.unbanMember) e pela revisão de punição
// aceita (services/appeals.js). Um lugar só, pra os três nunca divergirem.
const getPrisma = () => require('../config/prisma');

// Banimento: apaga o registro de Ban (se existir — o ban pelo painel não
// cria um) e libera a conta.
async function liftBan(userId, { db = getPrisma() } = {}) {
  await db.ban.deleteMany({ where: { userId } });
  return db.user.update({ where: { id: userId }, data: { isPlatformBanned: false, platformBanReason: null } });
}

async function liftSuspension(userId, { db = getPrisma() } = {}) {
  return db.user.update({ where: { id: userId }, data: { suspendedUntil: null } });
}

module.exports = { liftBan, liftSuspension };
