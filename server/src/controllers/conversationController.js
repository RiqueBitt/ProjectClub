const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');
const { canSendDirectMessage } = require('../services/dmPermissions');

async function listConversations(req, res, next) {
  try {
    const memberships = await prisma.conversationMember.findMany({
      where: { userId: req.user.id },
      include: {
        conversation: {
          include: {
            members: { orderBy: { joinedAt: 'asc' }, include: { user: { select: PUBLIC_USER_FIELDS } } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
    });

    const conversations = memberships.map((m) => ({
      id: m.conversation.id,
      isGroup: m.conversation.isGroup,
      name: m.conversation.name,
      icon: m.conversation.icon,
      members: m.conversation.members.map((cm) => cm.user),
      lastMessage: m.conversation.messages[0] || null,
      lastReadAt: m.lastReadAt,
    }));
    res.json({ conversations });
  } catch (err) { next(err); }
}

async function createConversation(req, res, next) {
  try {
    const { userIds = [], name } = req.body;
    const memberIds = Array.from(new Set([req.user.id, ...userIds]));
    if (memberIds.length < 2) return res.status(400).json({ error: 'Selecione ao menos um usuário.' });

    const isGroup = memberIds.length > 2;

    if (!isGroup) {
      const otherId = memberIds.find((id) => id !== req.user.id);
      if (otherId) {
        // Item pedido: "Permissão de mensagem... Quem pode me enviar
        // mensagens? Todos / Amigos / Pessoas que compartilham grupos
        // comigo / Ninguém... verificar configurações... Só depois
        // criar a conversa." — checagem única em services/dmPermissions.js
        // (compartilhada com messageController.js).
        const allowed = await canSendDirectMessage(req.user.id, otherId);
        if (!allowed) {
          const settings = await prisma.userSettings.findUnique({ where: { userId: otherId }, select: { dmPrivacy: true } });
          // BUG CORRIGIDO: mesmo desalinhamento já visto em
          // dmPermissions.js — o valor de reserva aqui dizia
          // 'friends', mas o padrão de verdade do schema é
          // 'everyone' (dmPrivacy @default("everyone")).
          const dmPrivacy = settings?.dmPrivacy || 'everyone';
          return res.status(403).json({
            error: dmPrivacy === 'none' ? 'Esta pessoa não está aceitando novas mensagens diretas.' : 'Vocês precisam ser amigos para iniciar uma conversa direta.',
          });
        }
      }

      // Reuse an existing 1:1 conversation if it already exists.
      const existing = await prisma.conversation.findFirst({
        where: {
          isGroup: false,
          AND: memberIds.map((id) => ({ members: { some: { userId: id } } })),
        },
        include: { members: true },
      });
      if (existing && existing.members.length === 2) {
        return res.json({ conversation: await hydrate(existing.id) });
      }
    }

    const conversation = await prisma.conversation.create({
      data: {
        isGroup,
        name: isGroup ? (name || 'Novo grupo') : null,
        members: { create: memberIds.map((userId) => ({ userId })) },
      },
    });
    const hydrated = await hydrate(conversation.id);
    // Without this, everyone except the person who clicked "start
    // conversation" would only see the new DM/group after a page refresh —
    // the friend-request-accept flow already notifies both sides this way
    // (see friendController.js), this just covers the other way a
    // conversation gets created (direct "message" button / new group).
    const io = req.app.get('io');
    memberIds.forEach((memberId) => {
      if (memberId !== req.user.id) io?.notifyUser?.(memberId, 'conversation:new', { conversation: hydrated });
    });
    res.status(201).json({ conversation: hydrated });
  } catch (err) { next(err); }
}

async function hydrate(id) {
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: { members: { orderBy: { joinedAt: 'asc' }, include: { user: { select: PUBLIC_USER_FIELDS } } } },
  });
  return {
    id: conversation.id,
    isGroup: conversation.isGroup,
    name: conversation.name,
    icon: conversation.icon,
    members: conversation.members.map((cm) => cm.user),
  };
}

async function addMember(req, res, next) {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation || !conversation.isGroup) return res.status(400).json({ error: 'Grupo inválido.' });

    // SECURITY: this had no membership check at all — any authenticated
    // user who knew (or guessed) a group conversation id could add
    // themselves or anyone else to it, joining a private group chat they
    // were never invited to. Now requires the caller to already be a
    // member of the group they're adding someone to.
    const requester = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: req.user.id } },
    });
    if (!requester) return res.status(403).json({ error: 'Você não é membro deste grupo.' });

    const already = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId } },
    });
    if (already) return res.status(409).json({ error: 'Este usuário já está no grupo.' });

    await prisma.conversationMember.create({ data: { conversationId: id, userId } });
    const hydrated = await hydrate(id);
    // Reuses conversation:new for existing members too (not just the
    // newly-added one) — the client's upsertConversation replaces by id, so
    // this doubles as the "member list changed" signal for everyone already
    // in the group, not just an intro for the new person.
    const io = req.app.get('io');
    hydrated.members.forEach((m) => io?.notifyUser?.(m.id, 'conversation:new', { conversation: hydrated }));
    res.json({ conversation: hydrated });
  } catch (err) { next(err); }
}

async function markRead(req, res, next) {
  try {
    const { id } = req.params;
    await prisma.conversationMember.updateMany({
      where: { conversationId: id, userId: req.user.id },
      data: { lastReadAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// PATCH /conversations/:id — rename a group DM. Only groups have a name at
// all (a 1:1 DM's "name" is always just the other person, computed
// client-side), and only an actual member gets to rename it.
async function updateConversation(req, res, next) {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: req.user.id } },
    });
    if (!membership) return res.status(403).json({ error: 'Você não é membro desta conversa.' });
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation?.isGroup) return res.status(400).json({ error: 'Apenas grupos podem ser renomeados.' });
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Nome inválido.' });

    await prisma.conversation.update({ where: { id }, data: { name: name.trim().slice(0, 100) } });
    const hydrated = await hydrate(id);
    const io = req.app.get('io');
    hydrated.members.forEach((m) => io?.notifyUser?.(m.id, 'conversation:new', { conversation: hydrated }));
    res.json({ conversation: hydrated });
  } catch (err) { next(err); }
}

// POST /conversations/:id/icon — custom group photo. Without one, the
// client renders a mosaic of the members' own avatars instead (see
// ConversationIcon in DMSidebar.jsx) — this is purely optional, never
// required to have a working group.
async function uploadIcon(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: req.user.id } },
    });
    if (!membership) return res.status(403).json({ error: 'Você não é membro desta conversa.' });
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation?.isGroup) return res.status(400).json({ error: 'Apenas grupos podem ter uma foto própria.' });

    const icon = req.file.url;
    await prisma.conversation.update({ where: { id }, data: { icon } });
    const hydrated = await hydrate(id);
    const io = req.app.get('io');
    hydrated.members.forEach((m) => io?.notifyUser?.(m.id, 'conversation:new', { conversation: hydrated }));
    res.json({ conversation: hydrated });
  } catch (err) { next(err); }
}

// DELETE /conversations/:id/members/me — leave a group DM. Deliberately
// self-only for now (no "remove someone else" action) — there's no
// group-admin/owner concept on Conversation yet, so the only safe,
// unambiguous permission rule is "you can always remove yourself". A 1:1
// DM can't be left this way (there'd be nobody left to talk to) — the
// UI simply doesn't offer this action outside a group.
async function leaveConversation(req, res, next) {
  try {
    const { id } = req.params;
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation?.isGroup) return res.status(400).json({ error: 'Você não pode sair de uma conversa direta.' });
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: req.user.id } },
    });
    if (!membership) return res.status(403).json({ error: 'Você não é membro deste grupo.' });

    await prisma.conversationMember.delete({ where: { id: membership.id } });
    const remaining = await prisma.conversationMember.count({ where: { conversationId: id } });
    if (remaining === 0) await prisma.conversation.delete({ where: { id } });

    const io = req.app.get('io');
    io?.notifyUser?.(req.user.id, 'conversation:left', { conversationId: id });
    if (remaining > 0) {
      const hydrated = await hydrate(id);
      hydrated.members.forEach((m) => io?.notifyUser?.(m.id, 'conversation:new', { conversation: hydrated }));
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Reuses the same "find existing 1:1 or create it" logic as createConversation,
// exposed as a plain function so other controllers (friendController, on
// accepting a friend request) can get-or-create a DM without going through
// the HTTP layer. Always returns a hydrated conversation.
//
// Deliberately does NOT re-check dmPrivacy (unlike the HTTP
// createConversation above): this is only ever called right after the two
// people involved just became friends, which already satisfies every
// dmPrivacy level except 'none' — and someone who set 'none' still gets a
// DM opened automatically here on purpose, since it mirrors how accepting
// a friend request already works today; treating that as a separate,
// deliberate action out of scope for this pass.
async function ensureDirectConversation(userIdA, userIdB) {
  if (userIdA === userIdB) return null;
  const memberIds = [userIdA, userIdB];
  const existing = await prisma.conversation.findFirst({
    where: {
      isGroup: false,
      AND: memberIds.map((id) => ({ members: { some: { userId: id } } })),
    },
    include: { members: true },
  });
  if (existing && existing.members.length === 2) {
    return hydrate(existing.id);
  }
  const conversation = await prisma.conversation.create({
    data: { isGroup: false, name: null, members: { create: memberIds.map((userId) => ({ userId })) } },
  });
  return hydrate(conversation.id);
}

module.exports = {
  listConversations, createConversation, addMember, markRead, ensureDirectConversation,
  updateConversation, uploadIcon, leaveConversation,
};
