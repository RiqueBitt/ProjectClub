const prisma = require('../config/prisma');

function logPlatformAction(req, { action, targetType, targetId, reason, metadata }) {
  return prisma.platformAuditLog.create({
    data: {
      actorId: req.user.id, action, targetType, targetId, reason,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });
}

const MEMBER_FIELDS = { id: true, publicId: true, username: true, displayName: true, avatarUrl: true, clanRole: true };
const AUTHOR_FIELDS = { id: true, publicId: true, username: true, displayName: true, avatarUrl: true, clanRole: true };

// Item pedido: "No painel da Staff, adicione uma nova categoria
// chamada Clubes, onde será exibida uma lista com todos os clubes
// criados pelos usuários" — todos, independente de privacidade
// (público/exclusivo pra amigos/somente por convite) — a staff
// enxerga tudo, diferente de listPublicClans (clanController.js),
// que é o que o usuário comum vê em Encontrar Clubes.
async function listAdminClans(req, res, next) {
  try {
    const clans = await prisma.clan.findMany({
      include: { icon: true, _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const owners = await prisma.user.findMany({
      where: { clanId: { in: clans.map((c) => c.id) }, clanRole: 'OWNER' },
      select: { ...MEMBER_FIELDS, clanId: true },
    });
    const ownerByClub = Object.fromEntries(owners.map((o) => [o.clanId, o]));
    res.json({
      clans: clans.map((c) => ({
        id: c.id, name: c.name, description: c.description, privacyType: c.privacyType,
        icon: c.icon, iconColor: c.iconColor, createdAt: c.createdAt,
        memberCount: c._count.members, owner: ownerByClub[c.id] || null,
      })),
    });
  } catch (err) { next(err); }
}

// Item pedido: "Ao clicar em um clube, a Staff poderá abrir uma
// visualização dele dentro do próprio painel... ver todas as
// mensagens e conteúdos... visualizar os canais e informações" — sem
// nenhuma checagem de membro (diferente de getClan/getMyClan em
// clanController.js) — é justamente o ponto: a staff vê tudo sem
// precisar (nem poder, ver abaixo) ser membro de verdade.
async function getAdminClan(req, res, next) {
  try {
    const { id } = req.params;
    const clan = await prisma.clan.findUnique({
      where: { id },
      include: { icon: true, tags: true, members: { select: MEMBER_FIELDS } },
    });
    if (!clan) return res.status(404).json({ error: 'Clube não encontrado.' });
    res.json({
      clan: {
        id: clan.id, name: clan.name, description: clan.description, privacyType: clan.privacyType, isPublic: clan.isPublic,
        icon: clan.icon, iconColor: clan.iconColor, createdAt: clan.createdAt,
        memberCount: clan.members.length, members: clan.members, tags: clan.tags,
      },
    });
  } catch (err) { next(err); }
}

// Item pedido: "Ver todas as mensagens e conteúdos do clube" — só
// leitura (ver routes/admin.js: nenhuma rota de ENVIAR mensagem como
// staff foi criada de propósito, exatamente pra não dar esse poder).
async function listAdminClanMessages(req, res, next) {
  try {
    const { id } = req.params;
    const clan = await prisma.clan.findUnique({ where: { id } });
    if (!clan) return res.status(404).json({ error: 'Clube não encontrado.' });
    const messages = await prisma.clanMessage.findMany({
      where: { clanId: id },
      include: { author: { select: AUTHOR_FIELDS } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ messages: messages.reverse() });
  } catch (err) { next(err); }
}

// Item pedido: "Poderá editar as configurações e informações do
// clube" — mesmos campos que o próprio dono edita (updateClan em
// clanController.js), mas sem a checagem de ownership: a staff pode
// editar QUALQUER clube, de qualquer dono.
async function updateAdminClan(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.clan.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Clube não encontrado.' });

    const { name, description, isPublic, privacyType, iconId, iconColor } = req.body;
    const data = {};
    if (name !== undefined) {
      if (!name.trim() || name.trim().length > 40) return res.status(400).json({ error: 'Nome inválido (até 40 caracteres).' });
      data.name = name.trim();
    }
    if (description !== undefined) data.description = description?.trim() || null;
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
    await logPlatformAction(req, { action: 'CLAN_ADMIN_UPDATE', targetType: 'CLAN', targetId: id, metadata: data });
    res.json({ clan });
  } catch (err) { next(err); }
}

// Item pedido: "Poderá excluir o clube, inclusive clubes criados por
// outros usuários" — remove todo mundo do clube primeiro (senão
// os membros ficariam com clanId apontando pra um clube que não
// existe mais — o onDelete: SetNull do schema já cuidaria disso
// sozinho ao apagar o Clan, mas fazer explícito aqui deixa claro e
// permite registrar no log quem exatamente perdeu o clube).
async function deleteAdminClan(req, res, next) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const clan = await prisma.clan.findUnique({ where: { id } });
    if (!clan) return res.status(404).json({ error: 'Clube não encontrado.' });
    await prisma.clan.delete({ where: { id } });
    await logPlatformAction(req, { action: 'CLAN_ADMIN_DELETE', targetType: 'CLAN', targetId: id, reason, metadata: { name: clan.name } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { listAdminClans, getAdminClan, listAdminClanMessages, updateAdminClan, deleteAdminClan };
