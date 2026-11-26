// LGPD (art. 18, VI): apagar/anonimizar os dados pessoais de quem pediu.
//
// "Excluir conta" (authController.deleteAccount) só DESATIVA — mensagens e
// posts continuam onde estavam pra não quebrar a conversa dos outros, como a
// política de privacidade explica. Quem pede pelo Suporte pra remover os
// dados recebia isso feito na mão. Agora um administrador da plataforma
// anonimiza a conta com um clique (Painel → Usuários), e o que a pessoa
// escreveu continua na conversa assinado como "Conta excluída".
//
// Regras:
// - só ADMIN (rota em routes/admin.js, atrás de requirePlatformAdmin);
// - só conta JÁ excluída (accountDisabledAt) — nunca de surpresa numa
//   conta ativa; não dá pra desfazer;
// - some: e-mail, nome, @, senha, foto, banners, bio, links, aniversário,
//   status, 2FA, sessões (IP/navegador), aparelhos de notificação, passkeys,
//   logins vinculados (Google/Discord…), códigos e a inscrição aprovada
//   (e-mail, data de nascimento, respostas, IP);
// - fica: o id interno (pras mensagens/posts antigos não quebrarem), as
//   punições e o registro de segurança (legítimo interesse: segurança das
//   contas — a política de privacidade diz isso);
// - tudo numa transação e registrado na auditoria (quem fez, quando).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ERASED_NAME = 'Conta excluída';

function erasedFields(userId) {
  const tag = crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 10);
  return {
    username: `excluido_${tag}`,
    displayName: ERASED_NAME,
    email: `excluido+${tag}@conta-excluida.invalid`,
    emailVerified: false,
    avatarUrl: null,
    bannerUrl: null,
    miniProfileBannerUrl: null,
    bannerFraming: null,
    miniProfileBannerFraming: null,
    idCardUrl: null,
    idCardFraming: null,
    customPendantUrl: null,
    bio: null,
    pronouns: null,
    birthDate: null,
    customStatus: null,
    customStatusEmoji: null,
    customStatusExpiresAt: null,
    youtubeUrl: null,
    steamUrl: null,
    robloxUrl: null,
    xUrl: null,
    tagEmoji: null,
    tagText: null,
    relationshipPartnerId: null,
    profileShowcase: null,
    profileWidgets: null,
    profileWishlist: null,
    featuredModJson: null,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    twoFactorLastUsedStep: null,
    status: 'OFFLINE',
  };
}

class ErasureError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Anonimiza a conta `userId`. Devolve `{ ok, username }`.
 * Lança ErasureError(404/409) com texto pra staff.
 */
async function anonymizeUser(userId, { actorId, reason = null, io = null } = {}, {
  prisma = require('../config/prisma'),
  logAction = require('./audit').logAction,
  markSessionsRevoked = require('./sessionKeep').markSessionsRevoked,
} = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, username: true, accountDisabledAt: true, platformRole: true },
  });
  if (!user) throw new ErasureError(404, 'Usuário não encontrado.');
  if (!user.accountDisabledAt) {
    throw new ErasureError(409, 'A conta precisa estar excluída antes (Configurações → Excluir conta, ou a staff desativa).');
  }
  if (user.platformRole === 'ADMIN') throw new ErasureError(409, 'Tire o cargo de administrador antes de anonimizar.');
  if (String(user.email).endsWith('@conta-excluida.invalid')) throw new ErasureError(409, 'Essa conta já foi anonimizada.');

  // Senha impossível de acertar (ninguém sabe o texto que gerou o hash).
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  const fields = { ...erasedFields(user.id), passwordHash };
  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: fields }),
    prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
    prisma.pushToken.deleteMany({ where: { userId: user.id } }),
    prisma.passkey.deleteMany({ where: { userId: user.id } }),
    prisma.oAuthAccount.deleteMany({ where: { userId: user.id } }),
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    prisma.emailVerificationCode.deleteMany({ where: { userId: user.id } }),
    prisma.accountSwitchToken.deleteMany({ where: { userId: user.id } }),
    // A inscrição aprovada guarda e-mail, nascimento, respostas e IP. As
    // recusadas por banimento ficam (são o que impede a volta de quem foi
    // banido — legítimo interesse).
    prisma.membershipApplication.updateMany({
      where: { status: 'APPROVED', OR: [{ email: user.email }, { username: user.username }] },
      data: {
        email: fields.email, username: fields.username, displayName: ERASED_NAME, passwordHash,
        birthDate: null, answers: null, ipAddress: null, ipGeo: null, oauthEmail: null, oauthProviderUserId: null,
      },
    }),
  ]);
  await markSessionsRevoked(user.id);
  await logAction(io, {
    actorId, action: 'USER_ANONYMIZED', targetType: 'USER', targetId: user.id,
    reason: reason || 'Pedido de remoção de dados (LGPD)', metadata: { at: now.toISOString() },
  });
  return { ok: true, username: fields.username };
}

module.exports = { anonymizeUser, erasedFields, ErasureError, ERASED_NAME };
