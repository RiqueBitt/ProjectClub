const prisma = require('../config/prisma');
const { hasClanCapability, canActOnMember } = require('../services/clanPermissions');

const AUTHOR_FIELDS = { id: true, publicId: true, username: true, displayName: true, avatarUrl: true, clanRole: true };

// Item pedido: "Canal de Chat: usado para mensagens de texto entre os
// membros... Somente usuários que fazem parte daquele clan poderão
// acessar e utilizar esses canais." — checagem de acesso em toda
// rota, comparando req.user.clanId com o id do clã da URL.
async function listClanMessages(req, res, next) {
  try {
    const { id } = req.params;
    if (req.user.clanId !== id) return res.status(403).json({ error: 'Você não é membro deste clã.' });

    const messages = await prisma.clanMessage.findMany({
      where: { clanId: id },
      include: { author: { select: AUTHOR_FIELDS } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ messages: messages.reverse() });
  } catch (err) { next(err); }
}

async function sendClanMessage(req, res, next) {
  try {
    const { id } = req.params;
    if (req.user.clanId !== id) return res.status(403).json({ error: 'Você não é membro deste clã.' });

    const content = (req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'A mensagem não pode ficar vazia.' });
    if (content.length > 2000) return res.status(400).json({ error: 'Mensagem muito longa.' });

    const message = await prisma.clanMessage.create({
      data: { clanId: id, authorId: req.user.id, content },
      include: { author: { select: AUTHOR_FIELDS } },
    });
    req.app.get('io')?.to(`clan:${id}`).emit('clanMessage:new', message);
    res.status(201).json({ message });
  } catch (err) { next(err); }
}

// Item pedido implícito: o cargo "Moderador" precisa ter uma função
// de verdade — apagar mensagem de outro membro do chat do clã.
async function deleteClanMessage(req, res, next) {
  try {
    const { id, messageId } = req.params;
    if (req.user.clanId !== id) return res.status(403).json({ error: 'Você não é membro deste clã.' });

    const message = await prisma.clanMessage.findUnique({ where: { id: messageId }, include: { author: { select: { clanRole: true } } } });
    if (!message || message.clanId !== id) return res.status(404).json({ error: 'Mensagem não encontrada.' });

    const isOwnMessage = message.authorId === req.user.id;
    const canModerate = hasClanCapability(req.user.clanRole, 'MODERATE_CLAN_CHAT') && canActOnMember(req.user.clanRole, message.author.clanRole);
    if (!isOwnMessage && !canModerate) return res.status(403).json({ error: 'Você não tem permissão pra apagar essa mensagem.' });

    await prisma.clanMessage.delete({ where: { id: messageId } });
    req.app.get('io')?.to(`clan:${id}`).emit('clanMessage:delete', { id: messageId, clanId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { listClanMessages, sendClanMessage, deleteClanMessage };
