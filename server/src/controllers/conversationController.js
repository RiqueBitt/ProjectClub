const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');
const { getDirectMessageDenial, DM_DENIAL_MESSAGES, canSendDirectMessage } = require('../services/dmPermissions');
const { maskUserStatus } = require('../utils/presenceVisibility');

// Campos da última mensagem que a lista de conversas usa (prévia, hora,
// não lida) — nada de anexos/reações/autor completo.
const LAST_MESSAGE_SELECT = {
  id: true, content: true, authorId: true, createdAt: true, conversationId: true, embed: true, stickerUrl: true,
  _count: { select: { attachments: true } },
};

// "Confirmação de leitura" — recíproca (igual WhatsApp): só aparece se as
// DUAS pessoas deixam ligado. Devolve o Set de quem desligou.
async function readReceiptsOff(userIds) {
  if (!userIds.length) return new Set();
  const rows = await prisma.userSettings.findMany({
    where: { userId: { in: userIds }, showReadReceipts: false }, select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

async function listConversations(req, res, next) {
  try {
    const me = req.user.id;
    const memberships = await prisma.conversationMember.findMany({
      where: { userId: me },
      include: {
        conversation: {
          include: {
            members: { orderBy: { joinedAt: 'asc' }, include: { user: { select: PUBLIC_USER_FIELDS } } },
          },
        },
      },
    });

    // Última mensagem NÃO apagada de cada conversa — antes vinha a última
    // de qualquer jeito (uma mensagem apagada aparecia como prévia vazia
    // e ainda acendia "não lida"). Uma consulta agrupada pra achar o
    // horário + uma pra buscar as linhas, em vez de uma por conversa.
    const ids = memberships.map((m) => m.conversationId);
    const lastByConversation = new Map();
    // "Visto" nas DMs 1:1: quando a outra pessoa leu pela última vez. Não
    // depende das últimas mensagens — roda em paralelo com elas.
    const directOthers = memberships
      .filter((m) => !m.conversation.isGroup)
      .map((m) => m.conversation.members.find((cm) => cm.userId !== me)?.userId)
      .filter(Boolean);
    const offPromise = readReceiptsOff([me, ...directOthers]);
    offPromise.catch(() => {}); // erro é tratado no await abaixo
    if (ids.length) {
      const maxes = await prisma.message.groupBy({
        by: ['conversationId'], where: { conversationId: { in: ids }, deleted: false }, _max: { createdAt: true },
      });
      const pairs = maxes.filter((x) => x.conversationId && x._max.createdAt);
      if (pairs.length) {
        const rows = await prisma.message.findMany({
          where: { deleted: false, OR: pairs.map((x) => ({ conversationId: x.conversationId, createdAt: x._max.createdAt })) },
          select: LAST_MESSAGE_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        rows.forEach((r) => { if (!lastByConversation.has(r.conversationId)) lastByConversation.set(r.conversationId, r); });
      }
    }

    const off = await offPromise;

    const conversations = memberships.map((m) => {
      const c = m.conversation;
      const last = lastByConversation.get(c.id) || null;
      const other = !c.isGroup ? c.members.find((cm) => cm.userId !== me) : null;
      return {
        id: c.id,
        isGroup: c.isGroup,
        name: c.name,
        icon: c.icon,
        ownerId: c.isGroup ? (c.ownerId || c.members[0]?.userId || null) : null,
        members: c.members.map((cm) => maskUserStatus(cm.user, me)),
        lastMessage: last ? { ...last, attachmentCount: last._count?.attachments || 0, _count: undefined } : null,
        lastReadAt: m.lastReadAt,
        inbox: m.inbox || 'main',
        pinnedAt: m.pinnedAt || null,
        otherReadAt: other && !off.has(me) && !off.has(other.userId) ? other.lastReadAt : null,
      };
    });
    res.json({ conversations });
  } catch (err) { next(err); }
}

async function createConversation(req, res, next) {
  try {
    const { userIds = [], name } = req.body || {};
    if (!Array.isArray(userIds) || !userIds.every((id) => typeof id === 'string' && id)) {
      return res.status(400).json({ error: 'Lista de usuários inválida.' });
    }
    const memberIds = Array.from(new Set([req.user.id, ...userIds]));
    if (memberIds.length < 2) return res.status(400).json({ error: 'Selecione ao menos um usuário.' });

    const isGroup = memberIds.length > 2;

    // Item pedido: "Permissão de mensagem... Quem pode me enviar
    // mensagens? Todos / Amigos / Pessoas que compartilham grupos
    // comigo / Ninguém... verificar configurações... Só depois
    // criar a conversa." — checagem única em services/dmPermissions.js
    // (compartilhada com messageController.js). Vale também pra GRUPO:
    // antes, colocar alguém num grupo novo ignorava tanto o dmPrivacy
    // quanto bloqueios — um jeito fácil de furar o "Ninguém" ou de
    // mandar mensagem pra quem te bloqueou.
    for (const otherId of memberIds) {
      if (otherId === req.user.id) continue;
      const denial = await getDirectMessageDenial(req.user.id, otherId);
      if (denial) {
        if (!isGroup) return res.status(403).json({ error: DM_DENIAL_MESSAGES[denial] });
        const other = await prisma.user.findUnique({ where: { id: otherId }, select: { displayName: true, username: true } });
        const who = other?.displayName || other?.username || 'Uma das pessoas';
        return res.status(403).json({
          error: denial === 'blocked'
            ? `Não é possível adicionar ${who} a um grupo com você.`
            : `${who} não aceita ser adicionado(a) a conversas por você (privacidade de mensagens).`,
        });
      }
    }

    if (!isGroup) {

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
        name: isGroup ? (String(name || '').trim().slice(0, 100) || 'Novo grupo') : null,
        ownerId: isGroup ? req.user.id : null,
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
    ownerId: conversation.isGroup ? (conversation.ownerId || conversation.members[0]?.userId || null) : null,
    members: conversation.members.map((cm) => maskUserStatus(cm.user, null)),
  };
}

// Tira todos os sockets de uma pessoa da sala da conversa (sair/ser
// removida do grupo) — antes ela continuava recebendo as mensagens em
// tempo real até recarregar a página.
function removeFromConversationRoom(io, userId, conversationId) {
  try { io?.in(`user:${userId}`).socketsLeave(`conversation:${conversationId}`); } catch { /* sem socket */ }
  try { io?.in(`user:${userId}`).socketsLeave(`voice:dm:${conversationId}`); } catch { /* sem socket */ }
}

async function addMember(req, res, next) {
  try {
    const { id } = req.params;
    const { userId } = req.body || {};
    if (typeof userId !== 'string' || !userId) return res.status(400).json({ error: 'Usuário inválido.' });
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

    if (typeof userId !== 'string' || !userId) return res.status(400).json({ error: 'Usuário inválido.' });
    // Mesmas regras de privacidade de DM/bloqueio de createConversation:
    // quem adiciona precisa poder mandar DM pra pessoa, e a pessoa nova
    // não pode ter bloqueio (em nenhum sentido) com quem já está no grupo.
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true, username: true } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const denial = await getDirectMessageDenial(req.user.id, userId);
    if (denial) {
      return res.status(403).json({
        error: denial === 'blocked'
          ? 'Não é possível adicionar esta pessoa ao grupo.'
          : `${target.displayName || target.username} não aceita ser adicionado(a) a conversas por você (privacidade de mensagens).`,
      });
    }
    const memberIds = (await prisma.conversationMember.findMany({ where: { conversationId: id }, select: { userId: true } })).map((m) => m.userId);
    const blockWithMember = await prisma.friendship.findFirst({
      where: {
        status: 'BLOCKED',
        OR: [
          { requesterId: userId, addresseeId: { in: memberIds } },
          { addresseeId: userId, requesterId: { in: memberIds } },
        ],
      },
      select: { id: true },
    });
    if (blockWithMember) return res.status(403).json({ error: 'Não é possível adicionar esta pessoa ao grupo.' });

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
    const at = new Date();
    const result = await prisma.conversationMember.updateMany({
      where: { conversationId: id, userId: req.user.id },
      data: { lastReadAt: at },
    });
    res.json({ ok: true, lastReadAt: at });
    if (!result.count) return;
    // "Visto" em tempo real pro outro lado de uma DM 1:1 — respeitando a
    // opção "mostrar confirmação de leitura" das duas pessoas.
    const conversation = await prisma.conversation.findUnique({
      where: { id }, select: { isGroup: true, members: { select: { userId: true } } },
    });
    if (!conversation || conversation.isGroup) return;
    const other = conversation.members.find((m) => m.userId !== req.user.id);
    if (!other) return;
    const off = await readReceiptsOff([req.user.id, other.userId]);
    if (off.size) return;
    req.app.get('io')?.notifyUser?.(other.userId, 'conversation:read', { conversationId: id, userId: req.user.id, lastReadAt: at });
  } catch (err) { next(err); }
}

// "Fixar conversa" (igual às DMs fixadas do Discord/WhatsApp): cada pessoa
// fixa até MAX_PINNED conversas no topo da própria lista. Guardado na linha
// de ConversationMember dela (pinnedAt), então sincroniza entre aparelhos —
// os outros sockets da mesma conta recebem 'conversation:pin'.
const MAX_PINNED_CONVERSATIONS = 10;

// PATCH /conversations/:id/pin { pinned: boolean }
async function setPinned(req, res, next) {
  try {
    const { id } = req.params;
    if (typeof req.body?.pinned !== 'boolean') return res.status(400).json({ error: 'Informe se a conversa deve ficar fixada.' });
    const pinned = req.body.pinned;
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: req.user.id } },
      select: { id: true, pinnedAt: true },
    });
    if (!membership) return res.status(404).json({ error: 'Conversa não encontrada.' });

    let pinnedAt = membership.pinnedAt;
    if (pinned && !pinnedAt) {
      const count = await prisma.conversationMember.count({ where: { userId: req.user.id, pinnedAt: { not: null } } });
      if (count >= MAX_PINNED_CONVERSATIONS) {
        return res.status(400).json({ error: `Você pode fixar no máximo ${MAX_PINNED_CONVERSATIONS} conversas.` });
      }
      pinnedAt = new Date();
    } else if (!pinned) {
      pinnedAt = null;
    }
    if (pinnedAt !== membership.pinnedAt) {
      await prisma.conversationMember.update({ where: { id: membership.id }, data: { pinnedAt } });
    }
    req.app.get('io')?.notifyUser?.(req.user.id, 'conversation:pin', { conversationId: id, pinnedAt });
    res.json({ conversationId: id, pinnedAt });
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

// Dono efetivo do grupo: ownerId gravado, ou (grupos antigos, sem dono)
// o membro mais antigo.
async function effectiveOwnerId(conversation) {
  if (conversation.ownerId) return conversation.ownerId;
  const first = await prisma.conversationMember.findFirst({
    where: { conversationId: conversation.id }, orderBy: { joinedAt: 'asc' }, select: { userId: true },
  });
  return first?.userId || null;
}

// Tira alguém do grupo e acerta o resto: apaga o grupo vazio, passa a
// posse adiante se quem saiu era o dono, remove os sockets da sala e
// avisa todo mundo.
async function removeMemberAndNotify(io, conversation, membership) {
  const id = conversation.id;
  await prisma.conversationMember.delete({ where: { id: membership.id } });
  const remaining = await prisma.conversationMember.count({ where: { conversationId: id } });
  if (remaining === 0) {
    await prisma.conversation.delete({ where: { id } });
  } else if (conversation.ownerId === membership.userId || !conversation.ownerId) {
    const heir = await prisma.conversationMember.findFirst({
      where: { conversationId: id }, orderBy: { joinedAt: 'asc' }, select: { userId: true },
    });
    if (heir) await prisma.conversation.update({ where: { id }, data: { ownerId: heir.userId } });
  }
  removeFromConversationRoom(io, membership.userId, id);
  io?.notifyUser?.(membership.userId, 'conversation:left', { conversationId: id });
  if (remaining > 0) {
    const hydrated = await hydrate(id);
    hydrated.members.forEach((m) => io?.notifyUser?.(m.id, 'conversation:new', { conversation: hydrated }));
  }
}

// DELETE /conversations/:id/members/me — sair de um grupo. Uma DM 1:1 não
// pode ser "deixada" (não sobraria ninguém).
async function leaveConversation(req, res, next) {
  try {
    const { id } = req.params;
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation?.isGroup) return res.status(400).json({ error: 'Você não pode sair de uma conversa direta.' });
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: req.user.id } },
    });
    if (!membership) return res.status(403).json({ error: 'Você não é membro deste grupo.' });

    await removeMemberAndNotify(req.app.get('io'), conversation, membership);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// DELETE /conversations/:id/members/:userId — o DONO do grupo remove
// alguém. (Pra sair você mesmo, use /members/me.)
async function removeMember(req, res, next) {
  try {
    const { id, userId } = req.params;
    if (userId === req.user.id) return leaveConversation(req, res, next);
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation?.isGroup) return res.status(400).json({ error: 'Grupo inválido.' });
    const ownerId = await effectiveOwnerId(conversation);
    if (ownerId !== req.user.id) return res.status(403).json({ error: 'Só o dono do grupo pode remover membros.' });
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId } },
    });
    if (!membership) return res.status(404).json({ error: 'Essa pessoa não está no grupo.' });
    await removeMemberAndNotify(req.app.get('io'), { ...conversation, ownerId }, membership);
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
  updateConversation, uploadIcon, leaveConversation, removeMember, setPinned, MAX_PINNED_CONVERSATIONS,
};
