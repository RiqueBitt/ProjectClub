const prisma = require('../config/prisma');
const { safeUpsert } = require('../utils/prismaSafe');
const { getEffectivePermissions, getEffectivePermissionsForChannels } = require('../services/authz');
const { getShared } = require('../services/sharedCache');
const { has } = require('../services/permissions');
const { requireCommunityPermission } = require('../services/authz');
const { FEATURED_KEYS, featuredVisibility } = require('../utils/channelNames');
const { maskUserStatus } = require('../utils/presenceVisibility');

// GET /api/community — carrega tudo que o app precisa pra montar a barra
// lateral e a lista de membros: categorias (com seus canais), canais soltos,
// cargos e membros da comunidade. Substitui o antigo listServers() do
// EmberCord (lá cada servidor vinha com essas mesmas informações; aqui só
// existe uma comunidade, então é uma chamada só). Canais privados ficam de
// fora da resposta pra quem não tem VIEW_CHANNEL neles.
// Parte da resposta que é igual pra todo mundo — fica no cache compartilhado
// (Redis, ~30s, apagado em qualquer escrita de comunidade/perfil; ver
// services/sharedCache.js). A tabela inteira de usuários era lida a cada
// abertura do app e a cada refresh ao vivo.
async function loadCommunityShared() {
  const [categories, looseChannels, roles, users, settings] = await Promise.all([
    prisma.category.findMany({
      orderBy: { position: 'asc' },
      include: { channels: { orderBy: { position: 'asc' } } },
    }),
    prisma.channel.findMany({ where: { categoryId: null }, orderBy: { position: 'asc' } }),
    prisma.role.findMany({ orderBy: { position: 'desc' } }),
    prisma.user.findMany({
      select: {
        id: true, publicId: true, username: true, displayName: true, avatarUrl: true, avatarDecoration: true,
        status: true, customStatus: true, customStatusEmoji: true, profileColor: true,
        profileNameFont: true, profileNameEffect: true, profileNameColor: true, profileNameColor2: true, profileNameColors: true,
        accountLevel: true, tagEmoji: true, tagText: true, timeoutUntil: true, idCardUrl: true,
        roles: { select: { roleId: true } },
        clanTag: { select: { tag: true, clan: { select: { icon: true, iconColor: true } } } },
      },
    }),
    prisma.platformSettings.findUnique({
      where: { id: 'singleton' },
      select: { communityName: true, communityIconUrl: true, communityBannerUrl: true, hiddenFeaturedChannels: true },
    }),
  ]);
  return {
    categories,
    looseChannels,
    roles,
    members: users.map(({ roles: userRoles, ...u }) => ({ user: u, roleIds: userRoles.map((r) => r.roleId) })),
    community: {
      name: settings?.communityName || 'Project Club',
      iconUrl: settings?.communityIconUrl || null,
      bannerUrl: settings?.communityBannerUrl || null,
      // Canais em destaque (Eventos/Feed/Galeria): { eventos: true, ... }
      featuredChannels: featuredVisibility(settings?.hiddenFeaturedChannels),
    },
  };
}

async function getCommunity(req, res, next) {
  try {
    const shared = await getShared('community', loadCommunityShared);
    const { categories, looseChannels, roles } = shared;

    // Filtra canais privados por permissão (VIEW_CHANNEL efetivo do
    // usuário) — por pessoa, em cima do dado compartilhado. Em lote: antes
    // eram ~5 consultas POR canal privado, uma depois da outra.
    const privateChannels = [...categories.flatMap((c) => c.channels), ...looseChannels].filter((ch) => ch.isPrivate);
    const permsByChannel = await getEffectivePermissionsForChannels(req.user.id, privateChannels);
    const visiblePrivateIds = new Set(privateChannels
      .filter((ch) => has(permsByChannel.get(ch.id) || 0n, 'VIEW_CHANNEL'))
      .map((ch) => ch.id));
    const filterChannel = (ch) => !ch.isPrivate || visiblePrivateIds.has(ch.id);

    const shapedCategories = categories.map((cat) => ({ ...cat, channels: cat.channels.filter(filterChannel) }));
    const shapedLoose = looseChannels.filter(filterChannel);

    const members = shared.members.map((m) => ({
      // "Invisível" aparece como "Offline" pra todo mundo menos a própria pessoa.
      user: maskUserStatus(m.user, req.user.id),
      roleIds: m.roleIds,
    }));

    res.json({
      community: shared.community,
      categories: shapedCategories,
      channels: shapedLoose,
      roles,
      members,
    });
  } catch (err) { next(err); }
}

// PATCH /community/featured-channels — mostra/esconde os canais em
// destaque. Body: { eventos?: bool, feed?: bool, galeria?: bool }.
// Quem gerencia canais pode mexer (mesma permissão da lista de canais).
async function updateFeaturedChannels(req, res, next) {
  try {
    await requireCommunityPermission(req.user.id, 'MANAGE_CHANNELS');
    const settings = await safeUpsert(prisma.platformSettings, {
      where: { id: 'singleton' }, update: {}, create: { id: 'singleton' },
    });
    const visible = featuredVisibility(settings.hiddenFeaturedChannels);
    for (const key of FEATURED_KEYS) {
      if (typeof req.body?.[key] === 'boolean') visible[key] = req.body[key];
    }
    const hidden = FEATURED_KEYS.filter((k) => !visible[k]);
    const updated = await prisma.platformSettings.update({
      where: { id: 'singleton' },
      data: { hiddenFeaturedChannels: hidden.length ? JSON.stringify(hidden) : null },
    });
    req.app.get('io')?.to('community').emit('community:update', updated);
    res.json({ featuredChannels: visible });
  } catch (err) { next(err); }
}

module.exports = { getCommunity, updateFeaturedChannels };
