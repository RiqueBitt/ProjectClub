const prisma = require('../config/prisma');
const { hasClanCapability, canAssignRole, canActOnMember, CLAN_ROLES } = require('../services/clanPermissions');

const MEMBER_FIELDS = { id: true, publicId: true, username: true, displayName: true, avatarUrl: true, clanRole: true };
const CLAN_LIST_INCLUDE = { icon: true, members: { select: MEMBER_FIELDS } };

function shapeClan(clan) {
  return {
    id: clan.id, name: clan.name, description: clan.description, isPublic: clan.isPublic, privacyType: clan.privacyType,
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
// Item pedido: "Uma lista de clans públicos disponíveis para entrar" —
// clubes públicos de verdade, mais os "exclusivo para amigos" onde
// algum amigo do usuário já é membro (mostrando uma tag de qual
// amigo é esse) — nunca mostra clubes "somente por convite" aqui, já
// que não tem como entrar por essa lista de qualquer forma.
async function listPublicClans(req, res, next) {
  try {
    const publicClans = await prisma.clan.findMany({
      where: { privacyType: 'PUBLIC' },
      include: { icon: true, _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // Item pedido: "Clubes configurados como Exclusivo para amigos
    // também aparecerão em Encontrar Clubes, mostrando uma tag
    // indicando qual amigo do usuário pertence àquele Clube."
    const myFriends = await prisma.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: req.user.id }, { addresseeId: req.user.id }] },
    });
    const friendIds = myFriends.map((f) => (f.requesterId === req.user.id ? f.addresseeId : f.requesterId));

    let friendsOnlyClans = [];
    if (friendIds.length > 0) {
      const candidates = await prisma.clan.findMany({
        where: { privacyType: 'FRIENDS_ONLY', members: { some: { id: { in: friendIds } } } },
        include: { icon: true, _count: { select: { members: true } }, members: { where: { id: { in: friendIds } }, select: MEMBER_FIELDS } },
        orderBy: { createdAt: 'desc' },
      });
      friendsOnlyClans = candidates.map((c) => ({ ...shapeClan(c), friendMember: c.members[0] || null, members: undefined }));
    }

    res.json({ clans: [...publicClans.map(shapeClan), ...friendsOnlyClans] });
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
    // Item pedido: "usuários poderão criar um Clube somente após
    // atingir o nível 10".
    if ((req.user.accountLevel || 0) < 10) return res.status(400).json({ error: 'Você precisa estar no nível 10 ou mais pra criar um clube.' });

    const { name, description, iconId, iconColor } = req.body;
    if (!name?.trim() || name.trim().length > 40) return res.status(400).json({ error: 'Nome inválido (até 40 caracteres).' });

    // Item pedido: "Clubes poderão ser Públicos ou Privados. Clubes
    // privados terão duas opções: Exclusivo para amigos... Somente por
    // convite" — aceita privacyType direto; isPublic continua aceito
    // por compatibilidade (mapeado pra PUBLIC/FRIENDS_ONLY), mas
    // privacyType tem prioridade quando os dois vierem juntos.
    const ALLOWED_PRIVACY = ['PUBLIC', 'FRIENDS_ONLY', 'INVITE_ONLY'];
    let privacyType = req.body.privacyType;
    if (!privacyType) privacyType = req.body.isPublic === false ? 'INVITE_ONLY' : 'PUBLIC';
    if (!ALLOWED_PRIVACY.includes(privacyType)) return res.status(400).json({ error: 'Tipo de privacidade inválido.' });

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
          privacyType, isPublic: privacyType === 'PUBLIC', iconId: finalIconId, iconColor: iconColor || undefined,
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
    const { name, description, isPublic, privacyType, iconId, iconColor } = req.body;
    const data = {};
    if (name !== undefined) {
      if (!name.trim() || name.trim().length > 40) return res.status(400).json({ error: 'Nome inválido (até 40 caracteres).' });
      data.name = name.trim();
    }
    if (description !== undefined) data.description = description?.trim() || null;
    // Item pedido: "Clubes poderão ser Públicos ou Privados... Exclusivo
    // para amigos... Somente por convite" — privacyType tem prioridade;
    // isPublic sozinho (compatibilidade antiga) só alterna entre
    // PUBLIC e INVITE_ONLY, sem opção de escolher FRIENDS_ONLY por
    // esse campo legado.
    if (privacyType !== undefined) {
      const ALLOWED_PRIVACY = ['PUBLIC', 'FRIENDS_ONLY', 'INVITE_ONLY'];
      if (!ALLOWED_PRIVACY.includes(privacyType)) return res.status(400).json({ error: 'Tipo de privacidade inválido.' });
      data.privacyType = privacyType;
      data.isPublic = privacyType === 'PUBLIC';
    } else if (isPublic !== undefined) {
      data.isPublic = !!isPublic;
      data.privacyType = isPublic ? 'PUBLIC' : 'INVITE_ONLY';
    }
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

    if (clan.privacyType === 'PUBLIC') {
      await prisma.user.update({ where: { id: req.user.id }, data: { clanId: clan.id, clanRole: 'MEMBER' } });
      return res.json({ joined: true });
    }

    // Item pedido: "Exclusivo para amigos — somente amigos do criador
    // poderão entrar" — entra igual um clube público (sem precisar de
    // aprovação manual), mas só se já for amigo de algum membro
    // fundador/dono. Verifica contra o DONO atual (clanRole OWNER),
    // não contra quem originalmente criou — se a posse for transferida,
    // a regra segue o dono de agora.
    if (clan.privacyType === 'FRIENDS_ONLY') {
      const owner = await prisma.user.findFirst({ where: { clanId: clan.id, clanRole: 'OWNER' } });
      const isFriend = owner && await prisma.friendship.findFirst({
        where: { status: 'ACCEPTED', OR: [{ requesterId: req.user.id, addresseeId: owner.id }, { requesterId: owner.id, addresseeId: req.user.id }] },
      });
      if (!isFriend) return res.status(403).json({ error: 'Esse clube é exclusivo para amigos do dono — vocês precisam ser amigos pra entrar.' });
      await prisma.user.update({ where: { id: req.user.id }, data: { clanId: clan.id, clanRole: 'MEMBER' } });
      return res.json({ joined: true });
    }

    // INVITE_ONLY — precisa ter um convite pendente aceito antes (ver
    // respondClanInvite); tentar entrar direto vira uma solicitação
    // normal só como registro, mas não dá acesso — mantém o
    // comportamento antigo de "pedir pra entrar" como sinalização pro
    // dono de que alguém quer um convite, sem contradizer a regra.
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
      return res.json({ clanTagId: null, clanTag: null });
    }
    if (!req.user.clanId) return res.status(400).json({ error: 'Você não está em nenhum clã.' });
    const tag = await prisma.clanTag.findUnique({ where: { id: tagId }, select: { clanId: true, tag: true, clan: { select: { icon: true, iconColor: true } } } });
    // Item pedido: "Um usuário não consiga utilizar tags de clans dos
    // quais não participa."
    if (!tag || tag.clanId !== req.user.clanId) return res.status(403).json({ error: 'Essa tag não pertence ao seu clã.' });
    await prisma.user.update({ where: { id: req.user.id }, data: { clanTagId: tagId } });
    // BUG CORRIGIDO ("quando clico em mostrar tag no perfil não
    // acontece nada"): antes só respondia { ok: true } — o frontend
    // não tinha como saber que a mudança realmente aconteceu sem
    // recarregar a página inteira (o checkbox lê user.clanTagId do
    // estado já carregado na tela, que nunca era atualizado).
    //
    // BUG CORRIGIDO ("mudo pra Nenhuma e não remove a tag"): devolver
    // só o id não bastava — o que decide se o selo aparece em algum
    // canto do app (ClanTagBadge.jsx) é o objeto clanTag aninhado
    // (com o texto da tag em si), não o id sozinho; sem o objeto
    // completo devolvido aqui, o frontend não tinha como saber o que
    // colocar ali além do id, e a tag antiga continuava "grudada" na
    // tela mesmo depois de trocada/removida.
    res.json({ clanTagId: tagId, clanTag: { tag: tag.tag, clan: tag.clan } });
  } catch (err) { next(err); }
}

// Item pedido: "Somente por convite — entrada apenas através de
// convite" — convidar é uma ação de quem já está DENTRO do clube
// (precisa de permissão de gerenciar membros), diferente de pedir
// pra entrar (ação de quem está de fora).
async function createClanInvite(req, res, next) {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    if (req.user.clanId !== id || !hasClanCapability(req.user.clanRole, 'MANAGE_MEMBERS')) {
      return res.status(403).json({ error: 'Você não tem permissão pra convidar pessoas pra este clube.' });
    }
    if (!userId) return res.status(400).json({ error: 'Escolha uma pessoa pra convidar.' });
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (target.clanId) return res.status(400).json({ error: 'Essa pessoa já está em um clube.' });

    const invite = await prisma.clanInvite.upsert({
      where: { clanId_invitedUserId: { clanId: id, invitedUserId: userId } },
      update: { status: 'PENDING', createdAt: new Date(), invitedById: req.user.id },
      create: { clanId: id, invitedUserId: userId, invitedById: req.user.id },
    });
    res.status(201).json({ invite });
  } catch (err) { next(err); }
}

// Convites que EU recebi — pra mostrar na aba Social/Clubes, já que
// "somente por convite" não aparece em Encontrar Clubes de jeito
// nenhum (só chega por aqui).
async function listMyClanInvites(req, res, next) {
  try {
    const invites = await prisma.clanInvite.findMany({
      where: { invitedUserId: req.user.id, status: 'PENDING' },
      include: { clan: { include: { icon: true, _count: { select: { members: true } } } }, invitedBy: { select: MEMBER_FIELDS } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ invites: invites.map((inv) => ({ id: inv.id, clan: shapeClan(inv.clan), invitedBy: inv.invitedBy, createdAt: inv.createdAt })) });
  } catch (err) { next(err); }
}

async function respondClanInvite(req, res, next) {
  try {
    const { inviteId } = req.params;
    const { accept } = req.body;
    const invite = await prisma.clanInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.invitedUserId !== req.user.id) return res.status(404).json({ error: 'Convite não encontrado.' });
    if (invite.status !== 'PENDING') return res.status(400).json({ error: 'Esse convite já foi respondido.' });

    if (!accept) {
      await prisma.clanInvite.update({ where: { id: inviteId }, data: { status: 'REJECTED' } });
      return res.json({ accepted: false });
    }
    // Item pedido: "Cada usuário poderá participar de apenas um Clube
    // por vez" — mesma regra de sempre, checada de novo aqui (o
    // convite pode ter sido enviado antes da pessoa entrar em outro
    // clube nesse meio tempo).
    if (req.user.clanId) return res.status(400).json({ error: 'Você já está em um clube — saia dele antes de aceitar este convite.' });
    await prisma.$transaction([
      prisma.clanInvite.update({ where: { id: inviteId }, data: { status: 'ACCEPTED' } }),
      prisma.user.update({ where: { id: req.user.id }, data: { clanId: invite.clanId, clanRole: 'MEMBER' } }),
    ]);
    res.json({ accepted: true });
  } catch (err) { next(err); }
}

module.exports = {
  listPublicClans, getMyClan, getClan, createClan, updateClan,
  joinClan, leaveClan, transferOwnership, setMemberRole, kickMember,
  respondJoinRequest, createClanTag, deleteClanTag, setMyClanTag,
  createClanInvite, listMyClanInvites, respondClanInvite,
};
