const prisma = require('../config/prisma');
const { hasClanCapability, canAssignRole, canActOnMember, CLAN_ROLES } = require('../services/clanPermissions');

const MEMBER_FIELDS = { id: true, publicId: true, username: true, displayName: true, avatarUrl: true, clanRole: true };
const CLAN_LIST_INCLUDE = { icon: true, members: { select: MEMBER_FIELDS } };

function shapeClan(clan) {
  return {
    id: clan.id, name: clan.name, description: clan.description, isPublic: clan.isPublic,
    icon: clan.icon, iconColor: clan.iconColor, createdAt: clan.createdAt,
    memberCount: clan.members?.length ?? clan._count?.members ?? 0,
    members: clan.members,
    tags: clan.tags,
  };
}

// Item pedido: "Uma lista de clans públicos disponíveis para entrar"
// — não mostra os privados aqui (eles só aparecem pra quem já é
// membro, ou via link direto/busca por nome, mais na frente se
// necessário — por ora, o pedido só fala de listar os públicos).
async function listPublicClans(req, res, next) {
  try {
    const clans = await prisma.clan.findMany({
      where: { isPublic: true },
      include: { icon: true, _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ clans: clans.map(shapeClan) });
  } catch (err) { next(err); }
}

// Item pedido: "Uma seção mostrando o clan atual do usuário, caso ele
// esteja em um" — detalhes completos (membros, tags) só pra quem já é
// membro; null se a pessoa não estiver em nenhum clã.
async function getMyClan(req, res, next) {
  try {
    if (!req.user.clanId) return res.json({ clan: null });
    const clan = await prisma.clan.findUnique({
      where: { id: req.user.clanId },
      include: { ...CLAN_LIST_INCLUDE, tags: true },
    });
    if (!clan) return res.json({ clan: null });

    const myCapabilities = Object.fromEntries(
      ['EDIT_CLAN', 'MANAGE_MEMBERS', 'MANAGE_ROLES', 'MANAGE_JOIN_REQUESTS', 'MANAGE_TAGS', 'MODERATE_CLAN_CHAT', 'TRANSFER_OWNERSHIP', 'DELETE_CLAN']
        .map((cap) => [cap, hasClanCapability(req.user.clanRole, cap)]),
    );
    let pendingRequests = null;
    if (myCapabilities.MANAGE_JOIN_REQUESTS) {
      pendingRequests = await prisma.clanJoinRequest.findMany({
        where: { clanId: clan.id, status: 'PENDING' },
        include: { user: { select: MEMBER_FIELDS } },
        orderBy: { createdAt: 'asc' },
      });
    }
    res.json({ clan: shapeClan(clan), myRole: req.user.clanRole, myCapabilities, pendingRequests });
  } catch (err) { next(err); }
}

async function getClan(req, res, next) {
  try {
    const { id } = req.params;
    const clan = await prisma.clan.findUnique({ where: { id }, include: CLAN_LIST_INCLUDE });
    if (!clan) return res.status(404).json({ error: 'Clã não encontrado.' });
    // Item pedido implícito: um clã privado não deveria expor a lista
    // de membros pra quem nem sequer participa dele — só o básico
    // (nome, ícone, contagem) pra decidir se vale pedir pra entrar.
    const isMember = req.user.clanId === clan.id;
    if (!clan.isPublic && !isMember) {
      return res.json({ clan: { id: clan.id, name: clan.name, description: clan.description, isPublic: false, icon: clan.icon, iconColor: clan.iconColor, memberCount: clan.members.length } });
    }
    res.json({ clan: shapeClan(clan) });
  } catch (err) { next(err); }
}

// Item pedido: "O usuário poderá criar seu próprio clan... Quem criar
// o clan será automaticamente o Dono."
async function createClan(req, res, next) {
  try {
    // Item pedido: "Cada usuário pode estar em apenas 1 clan por vez."
    if (req.user.clanId) return res.status(400).json({ error: 'Você já está em um clã — saia dele antes de criar outro.' });
    // Item pedido: "um user só pode criar um clã" — diferente da
    // checagem acima (essa é sobre estar em dois AO MESMO TEMPO), essa
    // é vitalícia: mesmo já tendo saído de um clã anterior, criar um
    // segundo nunca mais é permitido pra essa conta.
    if (req.user.hasCreatedClan) return res.status(400).json({ error: 'Você já criou um clã antes — cada conta só pode criar um.' });

    const { name, description, isPublic, iconId, iconColor } = req.body;
    if (!name?.trim() || name.trim().length > 40) return res.status(400).json({ error: 'Nome inválido (até 40 caracteres).' });

    // Item pedido: "quando eu criar um icon pro clã, deixe ele ser o
    // padrão" — se a pessoa não escolheu nenhum ícone específico, usa
    // o marcado como padrão automaticamente, em vez de ficar sem ícone
    // nenhum (⚔️ genérico) só porque não mexeu nesse campo.
    let finalIconId = iconId || null;
    if (iconId) {
      const icon = await prisma.clanIcon.findUnique({ where: { id: iconId } });
      if (!icon) return res.status(400).json({ error: 'Ícone inválido.' });
    } else {
      const defaultIcon = await prisma.clanIcon.findFirst({ where: { isDefault: true } });
      if (defaultIcon) finalIconId = defaultIcon.id;
    }

    const clan = await prisma.$transaction(async (tx) => {
      const created = await tx.clan.create({
        data: {
          name: name.trim(), description: description?.trim() || null,
          isPublic: isPublic !== false, iconId: finalIconId, iconColor: iconColor || undefined,
        },
      });
      await tx.user.update({ where: { id: req.user.id }, data: { clanId: created.id, clanRole: 'OWNER', hasCreatedClan: true } });
      return created;
    });
    res.status(201).json({ clan });
  } catch (err) { next(err); }
}

// Item pedido: "Editar as configurações do clan... Alterar o nome,
// ícone e informações... Tornar o clan público ou privado."
async function updateClan(req, res, next) {
  try {
    const { id } = req.params;
    if (req.user.clanId !== id || !hasClanCapability(req.user.clanRole, 'EDIT_CLAN')) {
      return res.status(403).json({ error: 'Você não tem permissão pra editar este clã.' });
    }
    const { name, description, isPublic, iconId, iconColor } = req.body;
    const data = {};
    if (name !== undefined) {
      if (!name.trim() || name.trim().length > 40) return res.status(400).json({ error: 'Nome inválido (até 40 caracteres).' });
      data.name = name.trim();
    }
    if (description !== undefined) data.description = description?.trim() || null;
    if (isPublic !== undefined) data.isPublic = !!isPublic;
    if (iconColor !== undefined) data.iconColor = iconColor;
    if (iconId !== undefined) {
      if (iconId) {
        const icon = await prisma.clanIcon.findUnique({ where: { id: iconId } });
        if (!icon) return res.status(400).json({ error: 'Ícone inválido.' });
      }
      data.iconId = iconId || null;
    }
    const clan = await prisma.clan.update({ where: { id }, data });
    res.json({ clan });
  } catch (err) { next(err); }
}

// Item pedido: "Um clan poderá ser Público: qualquer pessoa pode
// entrar. Privado: o usuário precisa enviar uma solicitação."
async function joinClan(req, res, next) {
  try {
    const { id } = req.params;
    if (req.user.clanId) return res.status(400).json({ error: 'Você já está em um clã — saia dele antes de entrar em outro.' });

    const clan = await prisma.clan.findUnique({ where: { id } });
    if (!clan) return res.status(404).json({ error: 'Clã não encontrado.' });

    if (clan.isPublic) {
      await prisma.user.update({ where: { id: req.user.id }, data: { clanId: clan.id, clanRole: 'MEMBER' } });
      return res.json({ joined: true });
    }

    // Clã privado — vira uma solicitação, não entra direto.
    const existing = await prisma.clanJoinRequest.findUnique({ where: { clanId_userId: { clanId: id, userId: req.user.id } } });
    if (existing && existing.status === 'PENDING') return res.status(409).json({ error: 'Você já pediu pra entrar nesse clã — aguarde a resposta.' });

    await prisma.clanJoinRequest.upsert({
      where: { clanId_userId: { clanId: id, userId: req.user.id } },
      update: { status: 'PENDING', createdAt: new Date() },
      create: { clanId: id, userId: req.user.id },
    });
    res.json({ requested: true });
  } catch (err) { next(err); }
}

// Item pedido: "Deve existir uma opção para o usuário sair do clan...
// Ao sair, ele poderá entrar em outro clan normalmente."
async function leaveClan(req, res, next) {
  try {
    if (!req.user.clanId) return res.status(400).json({ error: 'Você não está em nenhum clã.' });
    const clanId = req.user.clanId;

    if (req.user.clanRole === 'OWNER') {
      const otherMembers = await prisma.user.count({ where: { clanId, id: { not: req.user.id } } });
      if (otherMembers > 0) {
        return res.status(400).json({ error: 'Transfira a propriedade do clã pra outro membro antes de sair — um clã com gente dentro precisa sempre ter um dono.' });
      }
      // Dono é o último membro — sair apaga o clã inteiro (tags e
      // solicitações somem junto, ver onDelete: Cascade no schema).
      // Item pedido: "se o usuário apagar o próprio clan, também
      // poderá criar outro clan posteriormente" — hasCreatedClan
      // reseta aqui também, mesmo caso de cima (transferOwnership).
      await prisma.$transaction([
        prisma.user.update({ where: { id: req.user.id }, data: { clanId: null, clanRole: null, clanTagId: null, hasCreatedClan: false } }),
        prisma.clan.delete({ where: { id: clanId } }),
      ]);
      return res.json({ left: true, clanDeleted: true });
    }

    await prisma.user.update({ where: { id: req.user.id }, data: { clanId: null, clanRole: null, clanTagId: null } });
    res.json({ left: true });
  } catch (err) { next(err); }
}

// Item pedido: "Transferir a propriedade do clan para qualquer membro
// do próprio clan... o novo usuário se torna o Dono e o antigo dono
// deixa de ter essa função." — o ex-dono vira sub-dono (mantém uma
// posição de confiança, já que era quem tocava o clã até agora, mas
// perde o controle total que só o dono tem).
async function transferOwnership(req, res, next) {
  try {
    const { id } = req.params;
    const { targetUserId } = req.body;
    if (req.user.clanId !== id || !hasClanCapability(req.user.clanRole, 'TRANSFER_OWNERSHIP')) {
      return res.status(403).json({ error: 'Só o dono do clã pode transferir a propriedade.' });
    }
    if (targetUserId === req.user.id) return res.status(400).json({ error: 'Você já é o dono.' });

    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target || target.clanId !== id) return res.status(400).json({ error: 'Essa pessoa não é membro do clã.' });

    await prisma.$transaction([
      prisma.user.update({ where: { id: targetUserId }, data: { clanRole: 'OWNER' } }),
      // Item pedido: "se o usuário transferir o próprio clan pra
      // outro membro, ele poderá criar um novo clan posteriormente"
      // — hasCreatedClan reseta assim que a pessoa deixa de ser dona
      // por transferência (continua no clã como sub-dono por ora,
      // mas já pode criar outro assim que sair deste).
      prisma.user.update({ where: { id: req.user.id }, data: { clanRole: 'SUB_OWNER', hasCreatedClan: false } }),
    ]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Item pedido: "O dono poderá atribuir cargos aos membros e alterar
// suas permissões" — regras de quem pode dar qual cargo em
// services/clanPermissions.js (canAssignRole).
async function setMemberRole(req, res, next) {
  try {
    const { id, userId } = req.params;
    const { role } = req.body;
    if (req.user.clanId !== id) return res.status(403).json({ error: 'Você não é membro deste clã.' });
    if (!CLAN_ROLES.includes(role)) return res.status(400).json({ error: 'Cargo inválido.' });

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target || target.clanId !== id) return res.status(400).json({ error: 'Essa pessoa não é membro do clã.' });
    if (target.clanRole === 'OWNER') return res.status(400).json({ error: 'O dono não pode ter o cargo alterado por aqui — use a transferência de propriedade.' });

    if (!canAssignRole(req.user.clanRole, role)) {
      return res.status(403).json({ error: 'Você não tem permissão pra atribuir esse cargo.' });
    }
    // Também não pode mexer em alguém de cargo igual/maior que o seu
    // próprio, mesmo tendo permissão geral de atribuir cargos.
    if (!canActOnMember(req.user.clanRole, target.clanRole)) {
      return res.status(403).json({ error: 'Você não pode alterar o cargo de alguém no seu nível ou acima.' });
    }

    await prisma.user.update({ where: { id: userId }, data: { clanRole: role } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Item pedido: "Gerenciar os membros" (expulsar).
async function kickMember(req, res, next) {
  try {
    const { id, userId } = req.params;
    if (req.user.clanId !== id || !hasClanCapability(req.user.clanRole, 'MANAGE_MEMBERS')) {
      return res.status(403).json({ error: 'Você não tem permissão pra gerenciar membros deste clã.' });
    }
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target || target.clanId !== id) return res.status(400).json({ error: 'Essa pessoa não é membro do clã.' });
    if (!canActOnMember(req.user.clanRole, target.clanRole)) {
      return res.status(403).json({ error: 'Você não pode expulsar alguém no seu nível ou acima.' });
    }
    await prisma.user.update({ where: { id: userId }, data: { clanId: null, clanRole: null, clanTagId: null } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Item pedido: "O dono do clan poderá aceitar ou recusar solicitações
// de entrada."
async function respondJoinRequest(req, res, next) {
  try {
    const { id, requestId } = req.params;
    const { approve } = req.body;
    if (req.user.clanId !== id || !hasClanCapability(req.user.clanRole, 'MANAGE_JOIN_REQUESTS')) {
      return res.status(403).json({ error: 'Você não tem permissão pra gerenciar solicitações deste clã.' });
    }
    const request = await prisma.clanJoinRequest.findUnique({ where: { id: requestId } });
    if (!request || request.clanId !== id || request.status !== 'PENDING') {
      return res.status(404).json({ error: 'Solicitação não encontrada.' });
    }

    if (approve) {
      const target = await prisma.user.findUnique({ where: { id: request.userId } });
      if (target.clanId) {
        // A pessoa entrou em outro clã enquanto a solicitação estava
        // pendente — não dá mais pra aprovar.
        await prisma.clanJoinRequest.update({ where: { id: requestId }, data: { status: 'REJECTED' } });
        return res.status(400).json({ error: 'Essa pessoa já está em outro clã.' });
      }
      await prisma.$transaction([
        prisma.user.update({ where: { id: request.userId }, data: { clanId: id, clanRole: 'MEMBER' } }),
        prisma.clanJoinRequest.update({ where: { id: requestId }, data: { status: 'APPROVED' } }),
      ]);
    } else {
      await prisma.clanJoinRequest.update({ where: { id: requestId }, data: { status: 'REJECTED' } });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Item pedido: "O dono/admin deverá conseguir criar, editar e remover
// as tags do clan."
async function createClanTag(req, res, next) {
  try {
    const { id } = req.params;
    if (req.user.clanId !== id || !hasClanCapability(req.user.clanRole, 'MANAGE_TAGS')) {
      return res.status(403).json({ error: 'Você não tem permissão pra gerenciar tags deste clã.' });
    }
    // Item pedido: "o clan só pode criar 1 tag" — antes de aceitar
    // uma nova, confere se o clã já não tem uma.
    const count = await prisma.clanTag.count({ where: { clanId: id } });
    if (count >= 1) return res.status(400).json({ error: 'Este clã já tem uma tag — exclua a atual antes de criar outra.' });

    const { tag } = req.body;
    const clean = (tag || '').trim().toUpperCase();
    // Item pedido: "Cada tag pode ter no máximo 4 caracteres."
    if (!clean || clean.length > 4) return res.status(400).json({ error: 'A tag pode ter no máximo 4 caracteres.' });

    // Item pedido: "Não pode existir uma tag igual à de outro clan" —
    // o @@unique no schema já garante isso no nível do banco, mas
    // uma mensagem clara é melhor que deixar estourar um erro genérico.
    const existing = await prisma.clanTag.findUnique({ where: { tag: clean } });
    if (existing) return res.status(409).json({ error: 'Essa tag já está em uso por outro clã.' });

    const created = await prisma.clanTag.create({ data: { clanId: id, tag: clean } });
    res.status(201).json({ tag: created });
  } catch (err) { next(err); }
}

async function deleteClanTag(req, res, next) {
  try {
    const { id, tagId } = req.params;
    if (req.user.clanId !== id || !hasClanCapability(req.user.clanRole, 'MANAGE_TAGS')) {
      return res.status(403).json({ error: 'Você não tem permissão pra gerenciar tags deste clã.' });
    }
    const tag = await prisma.clanTag.findUnique({ where: { id: tagId } });
    if (!tag || tag.clanId !== id) return res.status(404).json({ error: 'Tag não encontrada.' });
    await prisma.clanTag.delete({ where: { id: tagId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Item pedido: "Os membros do clan poderão selecionar e utilizar as
// tags disponíveis daquele clan em seus perfis." — qualquer membro
// pode escolher (sem precisar de permissão especial), mas só uma tag
// do PRÓPRIO clã, nunca de outro.
async function setMyClanTag(req, res, next) {
  try {
    const { tagId } = req.body;
    if (!tagId) {
      await prisma.user.update({ where: { id: req.user.id }, data: { clanTagId: null } });
      return res.json({ ok: true });
    }
    if (!req.user.clanId) return res.status(400).json({ error: 'Você não está em nenhum clã.' });
    const tag = await prisma.clanTag.findUnique({ where: { id: tagId } });
    // Item pedido: "Um usuário não consiga utilizar tags de clans dos
    // quais não participa."
    if (!tag || tag.clanId !== req.user.clanId) return res.status(403).json({ error: 'Essa tag não pertence ao seu clã.' });
    await prisma.user.update({ where: { id: req.user.id }, data: { clanTagId: tagId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  listPublicClans, getMyClan, getClan, createClan, updateClan,
  joinClan, leaveClan, transferOwnership, setMemberRole, kickMember,
  respondJoinRequest, createClanTag, deleteClanTag, setMyClanTag,
};
