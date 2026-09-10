const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');
const { ensureDirectConversation } = require('./conversationController');
const { maybeSendOfflineEmail } = require('../services/offlineEmailNotifier');

async function sendRequest(req, res, next) {
  try {
    const { username } = req.body;
    const target = await prisma.user.findUnique({ where: { username } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'Você não pode se adicionar.' });

    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: req.user.id, addresseeId: target.id },
          { requesterId: target.id, addresseeId: req.user.id },
        ],
      },
    });
    if (existing) {
      if (existing.status === 'BLOCKED') return res.status(403).json({ error: 'Não é possível enviar pedido.' });
      return res.status(409).json({ error: 'Pedido já existe ou vocês já são amigos.' });
    }

    // Privacidade de pedidos de amizade (item pedido) — checada aqui, no
    // servidor, não só escondendo o botão na tela.
    if (target.friendRequestPrivacy === 'NOBODY') {
      return res.status(403).json({ error: 'Esta pessoa não está aceitando pedidos de amizade.' });
    }
    if (target.friendRequestPrivacy === 'FRIENDS_OF_FRIENDS') {
      const hasMutualFriend = await hasAtLeastOneMutualFriend(req.user.id, target.id);
      if (!hasMutualFriend) {
        return res.status(403).json({ error: 'Esta pessoa só aceita pedidos de amigos em comum.' });
      }
    }

    const friendship = await prisma.friendship.create({
      data: { requesterId: req.user.id, addresseeId: target.id, status: 'PENDING' },
    });

    req.app.get('io')?.notifyUser?.(target.id, 'friend:request', { friendship, from: req.user });
    maybeSendOfflineEmail(target.id, { type: 'friend_request', actorName: req.user.displayName });
    res.status(201).json({ friendship });
  } catch (err) { next(err); }
}

// Verifica se `userId` e `targetId` têm pelo menos 1 amigo em comum —
// mesma lógica de "amigos em comum" já usada no perfil (userController.js
// getUser), só que aqui só precisa saber SE existe algum, não a lista
// inteira, então para assim que acha o primeiro.
async function hasAtLeastOneMutualFriend(userId, targetId) {
  const [myFriendships, theirFriendships] = await Promise.all([
    prisma.friendship.findMany({ where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] } }),
    prisma.friendship.findMany({ where: { status: 'ACCEPTED', OR: [{ requesterId: targetId }, { addresseeId: targetId }] } }),
  ]);
  const otherIdOf = (f, selfId) => (f.requesterId === selfId ? f.addresseeId : f.requesterId);
  const myFriendIds = new Set(myFriendships.map((f) => otherIdOf(f, userId)));
  return theirFriendships.some((f) => myFriendIds.has(otherIdOf(f, targetId)));
}

async function respondRequest(req, res, next) {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'accept' | 'decline' | 'block'
    const friendship = await prisma.friendship.findUnique({ where: { id } });
    if (!friendship || friendship.addresseeId !== req.user.id) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    const statusMap = { accept: 'ACCEPTED', decline: 'DECLINED', block: 'BLOCKED' };
    const status = statusMap[action];
    if (!status) return res.status(400).json({ error: 'Ação inválida.' });

    const updated = await prisma.friendship.update({ where: { id }, data: { status } });
    const io = req.app.get('io');
    io?.notifyUser?.(friendship.requesterId, 'friend:update', { friendship: updated });

    // Accepting a request should behave like Discord: the DM is just there,
    // ready to use, instead of making both people go find each other again
    // to start one manually.
    if (status === 'ACCEPTED') {
      const conversation = await ensureDirectConversation(friendship.requesterId, friendship.addresseeId);
      if (conversation) {
        io?.notifyUser?.(friendship.requesterId, 'conversation:new', { conversation });
        io?.notifyUser?.(friendship.addresseeId, 'conversation:new', { conversation });
      }
      // primeiro_amigo / circulo_social / rede_gigante — checa os DOIS
      // lados, já que aceitar um pedido conta como +1 amigo pra cada um.
      const achievements = require('../services/achievements');
      achievements.checkAndUnlock(friendship.requesterId, io);
      achievements.checkAndUnlock(friendship.addresseeId, io);
    }

    res.json({ friendship: updated });
  } catch (err) { next(err); }
}

async function removeFriend(req, res, next) {
  try {
    const { id } = req.params;
    const friendship = await prisma.friendship.findUnique({ where: { id } });
    if (!friendship || ![friendship.requesterId, friendship.addresseeId].includes(req.user.id)) {
      return res.status(404).json({ error: 'Amizade não encontrada.' });
    }
    await prisma.friendship.delete({ where: { id } });
    const otherId = friendship.requesterId === req.user.id ? friendship.addresseeId : friendship.requesterId;
    req.app.get('io')?.notifyUser?.(otherId, 'friend:removed', { friendshipId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function blockUser(req, res, next) {
  try {
    const { username } = req.body;
    const target = await prisma.user.findUnique({ where: { username } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: req.user.id, addresseeId: target.id },
          { requesterId: target.id, addresseeId: req.user.id },
        ],
      },
    });

    if (existing) {
      await prisma.friendship.update({
        where: { id: existing.id },
        data: { status: 'BLOCKED', requesterId: req.user.id, addresseeId: target.id },
      });
    } else {
      await prisma.friendship.create({
        data: { requesterId: req.user.id, addresseeId: target.id, status: 'BLOCKED' },
      });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function listFriends(req, res, next) {
  try {
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [{ requesterId: req.user.id }, { addresseeId: req.user.id }],
      },
      include: {
        requester: { select: PUBLIC_USER_FIELDS },
        addressee: { select: PUBLIC_USER_FIELDS },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const shaped = friendships.map((f) => ({
      id: f.id,
      status: f.status,
      isIncoming: f.addresseeId === req.user.id,
      user: f.requesterId === req.user.id ? f.addressee : f.requester,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    }));
    res.json({ friendships: shaped });
  } catch (err) { next(err); }
}

module.exports = { sendRequest, respondRequest, removeFriend, blockUser, listFriends };
