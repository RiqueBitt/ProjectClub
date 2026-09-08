const prisma = require('../config/prisma');

// Item pedido: "Permissão de mensagem... Quem pode me enviar
// mensagens? Todos / Amigos / Pessoas que compartilham grupos comigo
// / Ninguém." — checagem única, reaproveitada tanto por
// conversationController.js (criar a conversa) quanto por
// messageController.js (mandar a primeira mensagem numa já
// existente), pra nunca mais os dois pontos ficarem
// desalinhados entre si (já aconteceu uma vez — ver histórico de
// commits).
//
// "friends_groups" usa a mesma noção de grupo já usada na privacidade
// do perfil (ver hasFullProfileAccess em userController.js): o clã
// (User.clanId) é o único conceito de "grupo" que o Project Club tem
// hoje fora da amizade.
async function canSendDirectMessage(senderId, recipientId) {
  if (senderId === recipientId) return true;
  const settings = await prisma.userSettings.findUnique({ where: { userId: recipientId }, select: { dmPrivacy: true } });
  // BUG CORRIGIDO: o valor de reserva aqui (pra quando a pessoa nunca
  // abriu a tela de Configurações — settings vem null nesse caso)
  // dizia 'friends', mas o valor padrão de verdade definido no schema
  // (dmPrivacy @default("everyone")) é 'everyone'. Isso restringia
  // silenciosamente as DMs de toda conta que nunca mexeu nas
  // Configurações a só amigos, sem ninguém ter escolhido isso.
  const dmPrivacy = settings?.dmPrivacy || 'everyone';
  if (dmPrivacy === 'everyone') return true;
  if (dmPrivacy === 'none') return false;

  const friendship = await prisma.friendship.findFirst({
    where: {
      status: 'ACCEPTED',
      OR: [
        { requesterId: senderId, addresseeId: recipientId },
        { requesterId: recipientId, addresseeId: senderId },
      ],
    },
  });
  if (friendship) return true;

  if (dmPrivacy === 'friends_groups') {
    const [sender, recipient] = await Promise.all([
      prisma.user.findUnique({ where: { id: senderId }, select: { clanId: true } }),
      prisma.user.findUnique({ where: { id: recipientId }, select: { clanId: true } }),
    ]);
    if (sender?.clanId && recipient?.clanId && sender.clanId === recipient.clanId) return true;
  }

  return false;
}

module.exports = { canSendDirectMessage };
