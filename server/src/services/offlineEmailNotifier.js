const prisma = require('../config/prisma');
const presenceStore = require('./presenceStore');
const { sendOfflineNotification } = require('./email');
const env = require('../config/env');

// Item pedido: verificar se todos os toggles de Configurações têm efeito
// real. "Notificações por e-mail" já existia na tela ("Recebe um e-mail
// para eventos importantes, como pedidos de amizade e menções, quando
// você está offline") mas nenhum código de verdade mandava esse e-mail —
// era um toggle sem nada pra controlar. Usado em friendController.js
// (pedido de amizade) e messageController.js (menção).
//
// Fire-and-forget por natureza: chamado sem await do lado de quem chama,
// depois que a ação principal (criar o pedido, enviar a mensagem) já
// terminou e respondeu — uma falha de e-mail aqui nunca deve derrubar a
// ação principal, só o extra.
async function maybeSendOfflineEmail(userId, payload) {
  try {
    const online = await presenceStore.isOnline(userId);
    if (online) return;
    const settings = await prisma.userSettings.findUnique({ where: { userId }, select: { emailNotifications: true } });
    if (settings?.emailNotifications === false) return;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user?.email) return;
    await sendOfflineNotification(user.email, { ...payload, appUrl: env.CLIENT_ORIGIN });
  } catch { /* nunca deixa uma falha de e-mail derrubar a ação principal */ }
}

module.exports = { maybeSendOfflineEmail };
