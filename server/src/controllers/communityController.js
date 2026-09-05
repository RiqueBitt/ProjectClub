const prisma = require('../config/prisma');
const { getEffectivePermissions } = require('../services/authz');
const { has } = require('../services/permissions');

// GET /api/community — carrega tudo que o app precisa pra montar a barra
// lateral e a lista de membros: categorias (com seus canais), canais soltos,
// cargos e membros da comunidade. Substitui o antigo listServers() do
// EmberCord (lá cada servidor vinha com essas mesmas informações; aqui só
// existe uma comunidade, então é uma chamada só). Canais privados ficam de
// fora da resposta pra quem não tem VIEW_CHANNEL neles.
async function getCommunity(req, res, next) {
  try {
    const [categories, looseChannels, roles, users, settings] = await Promise.all([
      prisma.category.findMany({
        orderBy: { position: 'asc' },
        include: { channels: { orderBy: { position: 'asc' } } },
      }),
      prisma.channel.findMany({ where: { categoryId: null }, orderBy: { position: 'asc' } }),
      prisma.role.findMany({ orderBy: { position: 'desc' } }),
      prisma.user.findMany({
        select: {
          id: true, publicId: true, username: true, displayName: true, avatarUrl: true,
          status: true, customStatus: true, customStatusEmoji: true, profileColor: true,
          profileNameFont: true, profileNameEffect: true, profileNameColor: true, profileNameColor2: true, profileNameColors: true,
          accountLevel: true, tagEmoji: true, tagText: true, timeoutUntil: true, idCardUrl: true,
          roles: { select: { roleId: true } },
        },
      }),
      prisma.platformSettings.findUnique({ where: { id: 'singleton' } }),
    ]);

    // Filtra canais privados por permissão (VIEW_CHANNEL efetivo do usuário).
    const allChannelIds = [...categories.flatMap((c) => c.channels), ...looseChannels]
      .filter((ch) => ch.isPrivate).map((ch) => ch.id);
    const visiblePrivateIds = new Set();
    for (const id of allChannelIds) {
      const perms = await getEffectivePermissions(req.user.id, id);
      if (has(perms, 'VIEW_CHANNEL')) visiblePrivateIds.add(id);
    }
    const filterChannel = (ch) => !ch.isPrivate || visiblePrivateIds.has(ch.id);

    const shapedCategories = categories.map((cat) => ({ ...cat, channels: cat.channels.filter(filterChannel) }));
    const shapedLoose = looseChannels.filter(filterChannel);

    const members = users.map((u) => ({
      user: { ...u, roles: undefined },
      roleIds: u.roles.map((r) => r.roleId),
    }));

    res.json({
      community: {
        name: settings?.communityName || 'Project Club',
        iconUrl: settings?.communityIconUrl || null,
        bannerUrl: settings?.communityBannerUrl || null,
      },
      categories: shapedCategories,
      channels: shapedLoose,
      roles,
      members,
    });
  } catch (err) { next(err); }
}

module.exports = { getCommunity };
