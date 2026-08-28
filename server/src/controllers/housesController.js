const prisma = require('../config/prisma');
const achievements = require('../services/achievements');

const PLACED_FURNITURE_INCLUDE = { furniture: true };

async function getMyHouseSummary(userId) {
  const owned = await prisma.userHouse.findMany({
    where: { userId }, include: { house: { include: { group: true } }, mapBackground: true }, orderBy: { purchasedAt: 'asc' },
  });
  return owned;
}

// --- Catálogo / loja ---

async function listHouseCatalog(req, res, next) {
  try {
    const [catalog, owned] = await Promise.all([
      prisma.houseCatalog.findMany({ orderBy: { price: 'asc' }, include: { group: true } }),
      prisma.userHouse.findMany({ where: { userId: req.user.id }, select: { houseId: true } }),
    ]);
    const ownedIds = new Set(owned.map((o) => o.houseId));
    res.json({ houses: catalog.map((h) => ({ ...h, owned: ownedIds.has(h.id) })) });
  } catch (err) { next(err); }
}

async function buyHouse(req, res, next) {
  try {
    const { id } = req.params;
    const house = await prisma.houseCatalog.findUnique({ where: { id } });
    if (!house) return res.status(404).json({ error: 'Casa não encontrada.' });
    if (house.stock !== null && house.stock <= 0) return res.status(400).json({ error: 'Essa casa está fora de estoque.' });

    const existing = await prisma.userHouse.findUnique({ where: { userId_houseId: { userId: req.user.id, houseId: id } } });
    if (existing) return res.status(400).json({ error: 'Você já tem esta casa.' });

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: req.user.id }, select: { coins: true } });
      if (user.coins < house.price) { const e = new Error('Moedas insuficientes.'); e.status = 400; throw e; }

      await tx.user.update({ where: { id: req.user.id }, data: { coins: { decrement: house.price } } });
      if (house.stock !== null) await tx.houseCatalog.update({ where: { id }, data: { stock: { decrement: 1 } } });
      const hasAnyHouse = await tx.userHouse.count({ where: { userId: req.user.id } });
      const userHouse = await tx.userHouse.create({
        data: { userId: req.user.id, houseId: id, isActive: hasAnyHouse === 0 },
      });
      return userHouse;
    });

    const newAchievements = await achievements.checkAndUnlock(req.user.id, req.app.get('io'));
    res.status(201).json({ userHouse: result, newAchievements });
  } catch (err) { next(err); }
}

async function listFurnitureCatalog(req, res, next) {
  try {
    const [categories, owned] = await Promise.all([
      prisma.furnitureCategory.findMany({ include: { items: { orderBy: { price: 'asc' } } } }),
      prisma.userFurniture.findMany({ where: { userId: req.user.id } }),
    ]);
    const qtyByFurniture = Object.fromEntries(owned.map((o) => [o.furnitureId, o.quantity]));
    res.json({
      categories: categories.map((cat) => ({
        ...cat,
        items: cat.items.map((it) => ({ ...it, ownedQuantity: qtyByFurniture[it.id] || 0 })),
      })),
    });
  } catch (err) { next(err); }
}

async function buyFurniture(req, res, next) {
  try {
    const { id } = req.params;
    const item = await prisma.furniture.findUnique({ where: { id } });
    if (!item) return res.status(404).json({ error: 'Móvel não encontrado.' });

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: req.user.id }, select: { coins: true } });
      if (user.coins < item.price) { const e = new Error('Moedas insuficientes.'); e.status = 400; throw e; }

      await tx.user.update({ where: { id: req.user.id }, data: { coins: { decrement: item.price } } });
      const owned = await tx.userFurniture.upsert({
        where: { userId_furnitureId: { userId: req.user.id, furnitureId: id } },
        update: { quantity: { increment: 1 } },
        create: { userId: req.user.id, furnitureId: id, quantity: 1 },
      });
      return owned;
    });

    res.json({ ok: true, quantity: result.quantity });
  } catch (err) { next(err); }
}

// --- Minha(s) casa(s) / editor ---

async function listMyHouses(req, res, next) {
  try {
    const houses = await getMyHouseSummary(req.user.id);
    res.json({ houses });
  } catch (err) { next(err); }
}

async function getHouseLayout(req, res, next) {
  try {
    const { houseId } = req.params;
    const userHouse = await prisma.userHouse.findUnique({
      where: { userId_houseId: { userId: req.user.id, houseId } },
      include: { house: { include: { group: true } }, mapBackground: true, items: { include: PLACED_FURNITURE_INCLUDE, orderBy: { zIndex: 'asc' } } },
    });
    if (!userHouse) return res.status(404).json({ error: 'Você não possui esta casa.' });
    res.json({ userHouse });
  } catch (err) { next(err); }
}

async function setActiveHouse(req, res, next) {
  try {
    const { houseId } = req.params;
    const owns = await prisma.userHouse.findUnique({ where: { userId_houseId: { userId: req.user.id, houseId } } });
    if (!owns) return res.status(404).json({ error: 'Você não possui esta casa.' });

    await prisma.$transaction([
      prisma.userHouse.updateMany({ where: { userId: req.user.id }, data: { isActive: false } }),
      prisma.userHouse.update({ where: { id: owns.id }, data: { isActive: true } }),
    ]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// --- Fundos (mapas) — adaptado do sistema de mapas do bot Robbie ---

async function listMapBackgrounds(req, res, next) {
  try {
    const maps = await prisma.mapBackground.findMany();
    const owned = await prisma.userMapBackground.findMany({ where: { userId: req.user.id }, select: { mapBackgroundId: true } });
    const ownedIds = new Set(owned.map((o) => o.mapBackgroundId));
    res.json({ maps: maps.map((m) => ({ ...m, owned: m.price === 0 || ownedIds.has(m.id) })) });
  } catch (err) { next(err); }
}

async function buyMapBackground(req, res, next) {
  try {
    const { id } = req.params;
    const map = await prisma.mapBackground.findUnique({ where: { id } });
    if (!map) return res.status(404).json({ error: 'Fundo não encontrado.' });
    if (map.stock !== null && map.stock <= 0) return res.status(400).json({ error: 'Esse fundo está fora de estoque.' });

    const already = await prisma.userMapBackground.findUnique({ where: { userId_mapBackgroundId: { userId: req.user.id, mapBackgroundId: id } } });
    if (already || map.price === 0) return res.status(400).json({ error: 'Você já tem este fundo.' });

    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { coins: true } });
    if (user.coins < map.price) return res.status(400).json({ error: 'Moedas insuficientes.' });

    await prisma.$transaction([
      prisma.user.update({ where: { id: req.user.id }, data: { coins: { decrement: map.price } } }),
      prisma.userMapBackground.create({ data: { userId: req.user.id, mapBackgroundId: id } }),
      ...(map.stock !== null ? [prisma.mapBackground.update({ where: { id }, data: { stock: { decrement: 1 } } })] : []),
    ]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// --- Administração de fundos (staff pode cadastrar mais fundos além dos
// 8 originais do bot Robbie, com upload de imagem próprio). ---

async function adminCreateMapBackground(req, res, next) {
  try {
    const { id, name, price, groupSlots } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'ID e nome são obrigatórios.' });
    if (!req.file) return res.status(400).json({ error: 'Envie uma imagem de fundo.' });
    const map = await prisma.mapBackground.create({
      data: {
        id, name, imageUrl: req.file.url,
        price: price !== undefined ? parseInt(price, 10) || 0 : undefined,
        groupSlots: groupSlots !== undefined ? parseInt(groupSlots, 10) || 0 : undefined,
      },
    });
    res.status(201).json({ map });
  } catch (err) { next(err); }
}

async function adminUpdateMapBackground(req, res, next) {
  try {
    const { id } = req.params;
    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.price !== undefined) data.price = parseInt(req.body.price, 10) || 0;
    if (req.body.groupSlots !== undefined) data.groupSlots = parseInt(req.body.groupSlots, 10) || 0;
    if (req.file) data.imageUrl = req.file.url;
    const map = await prisma.mapBackground.update({ where: { id }, data });
    res.json({ map });
  } catch (err) { next(err); }
}

async function adminDeleteMapBackground(req, res, next) {
  try {
    const { id } = req.params;
    await prisma.mapBackground.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function setHouseMapBackground(req, res, next) {
  try {
    const { houseId } = req.params;
    const { mapBackgroundId } = req.body; // null = volta pra cor sólida padrão (só permitido se a casa não tiver grupo)
    const owns = await prisma.userHouse.findUnique({ where: { userId_houseId: { userId: req.user.id, houseId } }, include: { house: true } });
    if (!owns) return res.status(404).json({ error: 'Você não possui esta casa.' });

    // Casas com grupo (igual o bot Robbie tinha) não têm fundo próprio — o
    // mapa É o fundo, obrigatoriamente. Sem ele a casa não teria onde
    // desenhar a sprite nem de que tamanho fazer o quadro.
    if (owns.house.groupId != null && !mapBackgroundId) {
      return res.status(400).json({ error: 'Esta casa pertence a um grupo e precisa de um mapa escolhido.' });
    }

    if (mapBackgroundId) {
      const map = await prisma.mapBackground.findUnique({ where: { id: mapBackgroundId } });
      if (!map) return res.status(404).json({ error: 'Fundo não encontrado.' });
      if (map.price > 0) {
        const owned = await prisma.userMapBackground.findUnique({ where: { userId_mapBackgroundId: { userId: req.user.id, mapBackgroundId } } });
        if (!owned) return res.status(403).json({ error: 'Você ainda não comprou este fundo.' });
      }
    }

    const updated = await prisma.userHouse.update({
      where: { id: owns.id }, data: { mapBackgroundId: mapBackgroundId || null },
      include: { mapBackground: true, house: { include: { group: true } } },
    });
    res.json({ userHouse: updated });
  } catch (err) { next(err); }
}

// Salva o layout inteiro de uma vez (substitui todos os itens colocados) —
// mais simples e seguro contra dessincronia do que tentar diffar item a
// item; o editor manda o estado completo do "placed" a cada salvamento,
// igual ao body de /casa/save do bot original.
async function saveHouseLayout(req, res, next) {
  try {
    const { houseId } = req.params;
    const { items } = req.body; // [{ furnitureId, x, y, width, height, zIndex }]
    const userHouse = await prisma.userHouse.findUnique({
      where: { userId_houseId: { userId: req.user.id, houseId } },
    });
    if (!userHouse) return res.status(404).json({ error: 'Você não possui esta casa.' });
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Lista de itens inválida.' });

    // Valida que o usuário não está colocando mais unidades de um móvel do
    // que possui (mesma regra do bot original).
    const counts = {};
    for (const it of items) counts[it.furnitureId] = (counts[it.furnitureId] || 0) + 1;
    const owned = await prisma.userFurniture.findMany({ where: { userId: req.user.id, furnitureId: { in: Object.keys(counts) } } });
    const ownedQty = Object.fromEntries(owned.map((o) => [o.furnitureId, o.quantity]));
    for (const [furnitureId, count] of Object.entries(counts)) {
      if (count > (ownedQty[furnitureId] || 0)) {
        return res.status(400).json({ error: `Você não tem unidades suficientes de um dos móveis usados.` });
      }
    }

    await prisma.$transaction([
      prisma.placedFurniture.deleteMany({ where: { userHouseId: userHouse.id } }),
      prisma.placedFurniture.createMany({
        data: items.map((it) => ({
          userHouseId: userHouse.id,
          furnitureId: it.furnitureId,
          x: Math.round(it.x) || 0,
          y: Math.round(it.y) || 0,
          width: Math.max(20, Math.round(it.width) || 100),
          height: Math.max(20, Math.round(it.height) || 100),
          zIndex: Math.round(it.zIndex) || 0,
          flipped: !!it.flipped,
        })),
      }),
      prisma.userHouse.update({ where: { id: userHouse.id }, data: { updatedAt: new Date() } }),
    ]);

    const newAchievements = await achievements.checkAndUnlock(req.user.id, req.app.get('io'));
    res.json({ ok: true, newAchievements });
  } catch (err) { next(err); }
}

// --- Curtidas e livro de visitas (adaptado de house_likes/house_comments
// do bot Robbie) ---

async function toggleLike(req, res, next) {
  try {
    const { houseId } = req.params;
    const userHouse = await prisma.userHouse.findFirst({ where: { houseId, isActive: true }, select: { id: true, userId: true } });
    if (!userHouse) return res.status(404).json({ error: 'Casa não encontrada ou não está ativa.' });

    const existing = await prisma.houseLike.findUnique({
      where: { userHouseId_likerId: { userHouseId: userHouse.id, likerId: req.user.id } },
    });
    if (existing) {
      await prisma.houseLike.delete({ where: { id: existing.id } });
      return res.json({ liked: false });
    }
    await prisma.houseLike.create({ data: { userHouseId: userHouse.id, likerId: req.user.id } });
    if (userHouse.userId !== req.user.id) await achievements.checkAndUnlock(userHouse.userId, req.app.get('io'));
    res.json({ liked: true });
  } catch (err) { next(err); }
}

async function listComments(req, res, next) {
  try {
    const { houseId } = req.params;
    const userHouse = await prisma.userHouse.findFirst({ where: { houseId, isActive: true }, select: { id: true } });
    if (!userHouse) return res.status(404).json({ error: 'Casa não encontrada ou não está ativa.' });

    const comments = await prisma.houseComment.findMany({
      where: { userHouseId: userHouse.id },
      include: { author: { select: { id: true, displayName: true, avatarUrl: true, profileColor: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ comments });
  } catch (err) { next(err); }
}

async function addComment(req, res, next) {
  try {
    const { houseId } = req.params;
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Escreva um recado.' });

    const userHouse = await prisma.userHouse.findFirst({ where: { houseId, isActive: true }, select: { id: true, userId: true } });
    if (!userHouse) return res.status(404).json({ error: 'Casa não encontrada ou não está ativa.' });

    const comment = await prisma.houseComment.create({
      data: { userHouseId: userHouse.id, authorId: req.user.id, content: content.trim().slice(0, 300) },
      include: { author: { select: { id: true, displayName: true, avatarUrl: true, profileColor: true } } },
    });
    await achievements.checkAndUnlock(req.user.id, req.app.get('io'));
    if (userHouse.userId !== req.user.id) await achievements.checkAndUnlock(userHouse.userId, req.app.get('io'));
    res.status(201).json({ comment });
  } catch (err) { next(err); }
}

// Dono da casa OU autor do recado podem apagar — mesma regra do bot original.
async function deleteComment(req, res, next) {
  try {
    const { commentId } = req.params;
    const comment = await prisma.houseComment.findUnique({ where: { id: commentId }, include: { userHouse: true } });
    if (!comment) return res.status(404).json({ error: 'Recado não encontrado.' });
    if (comment.authorId !== req.user.id && comment.userHouse.userId !== req.user.id) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }
    await prisma.houseComment.delete({ where: { id: commentId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// --- Conquistas ---

async function getAchievements(req, res, next) {
  try {
    const { ACHIEVEMENTS } = require('../data/achievementsCatalog');
    const unlocked = await prisma.userAchievement.findMany({ where: { userId: req.user.id } });
    const unlockedMap = Object.fromEntries(unlocked.map((u) => [u.achievementId, u.unlockedAt]));

    const list = await Promise.all(ACHIEVEMENTS.map(async (def) => {
      const isUnlocked = !!unlockedMap[def.id];
      const progress = isUnlocked ? def.target : await achievements.getProgress(req.user.id, def.id);
      return { ...def, progress: Math.min(progress, def.target), unlocked: isUnlocked, unlockedAt: unlockedMap[def.id] || null };
    }));
    res.json({ achievements: list });
  } catch (err) { next(err); }
}

// --- Galeria (ver a casa ativa de outros membros, somente leitura) ---

async function getGallery(req, res, next) {
  try {
    const activeHouses = await prisma.userHouse.findMany({
      where: { isActive: true },
      include: {
        house: { include: { group: true } },
        mapBackground: true,
        items: { include: PLACED_FURNITURE_INCLUDE, orderBy: { zIndex: 'asc' } },
        user: { select: { id: true, displayName: true, avatarUrl: true, profileColor: true } },
        _count: { select: { likes: true, comments: true } },
        likes: { where: { likerId: req.user.id }, select: { id: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 60,
    });
    res.json({
      houses: activeHouses.map((h) => ({
        ...h, likeCount: h._count.likes, commentCount: h._count.comments, likedByMe: h.likes.length > 0,
        _count: undefined, likes: undefined,
      })),
    });
  } catch (err) { next(err); }
}

// ============================================================
// Administração de casas e móveis (staff) — equivalente às telas
// /staff/config/casa e /staff/config/moveis do bot Robbie.
// ============================================================

async function adminListHouseCatalog(req, res, next) {
  try {
    const houses = await prisma.houseCatalog.findMany({ orderBy: { price: 'asc' } });
    res.json({ houses });
  } catch (err) { next(err); }
}

async function adminCreateHouse(req, res, next) {
  try {
    const { id, name, price, backgroundColor, width, height, stock, groupId } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'ID e nome são obrigatórios.' });
    const house = await prisma.houseCatalog.create({
      data: {
        id, name, price: parseInt(price, 10) || 0, backgroundColor: backgroundColor || '#BFEFFF',
        width: parseInt(width, 10) || 1000, height: parseInt(height, 10) || 632,
        stock: stock !== undefined && stock !== '' ? parseInt(stock, 10) : null,
        groupId: groupId !== undefined && groupId !== '' ? parseInt(groupId, 10) : null,
        imageUrl: req.file ? req.file.url : undefined,
      },
    });
    res.status(201).json({ house });
  } catch (err) { next(err); }
}

async function adminUpdateHouse(req, res, next) {
  try {
    const { id } = req.params;
    const allowed = ['name', 'price', 'backgroundColor', 'width', 'height', 'stock', 'groupId'];
    const data = {};
    for (const key of allowed) if (req.body[key] !== undefined) data[key] = req.body[key];
    ['price', 'width', 'height'].forEach((k) => { if (data[k] !== undefined) data[k] = parseInt(data[k], 10); });
    if (data.stock !== undefined) data.stock = data.stock === '' ? null : parseInt(data.stock, 10);
    if (data.groupId !== undefined) data.groupId = data.groupId === '' ? null : parseInt(data.groupId, 10);
    if (req.file) data.imageUrl = req.file.url;
    const house = await prisma.houseCatalog.update({ where: { id }, data });
    res.json({ house });
  } catch (err) { next(err); }
}

async function adminDeleteHouse(req, res, next) {
  try {
    const { id } = req.params;
    await prisma.houseCatalog.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// --- Grupos (igual o bot Robbie tinha) — posição/tamanho (x,y,width,
// height) compartilhados por todas as casas do catálogo ligadas a esse
// número de grupo (1-1000). Mover/redimensionar um grupo afeta todas de
// uma vez, sem precisar editar casa por casa. ---

async function adminListHouseGroups(req, res, next) {
  try {
    const groups = await prisma.houseGroup.findMany({ orderBy: { id: 'asc' }, include: { houses: { select: { id: true, name: true } } } });
    res.json({ groups });
  } catch (err) { next(err); }
}

async function adminSetHouseGroup(req, res, next) {
  try {
    const groupId = parseInt(req.params.id, 10);
    if (!Number.isFinite(groupId) || groupId < 1 || groupId > 1000) {
      return res.status(400).json({ error: 'Grupo precisa ser um número de 1 a 1000.' });
    }
    const { x, y, width, height } = req.body;
    const group = await prisma.houseGroup.upsert({
      where: { id: groupId },
      update: { x: parseInt(x, 10) || 0, y: parseInt(y, 10) || 0, width: parseInt(width, 10) || 200, height: parseInt(height, 10) || 200 },
      create: { id: groupId, x: parseInt(x, 10) || 0, y: parseInt(y, 10) || 0, width: parseInt(width, 10) || 200, height: parseInt(height, 10) || 200 },
    });
    res.json({ group });
  } catch (err) { next(err); }
}

async function adminDeleteHouseGroup(req, res, next) {
  try {
    const groupId = parseInt(req.params.id, 10);
    await prisma.houseGroup.delete({ where: { id: groupId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// --- Casa/mapa inicial (igual o bot Robbie tinha) — toda conta nova já
// ganha essa casa (e esse mapa, se a casa tiver grupo) de graça e ativa,
// sem precisar comprar nada. Ver services/starterHouse.js pra concessão. ---

async function adminSetStarterHouse(req, res, next) {
  try {
    const { id } = req.params;
    const house = await prisma.houseCatalog.findUnique({ where: { id } });
    if (!house) return res.status(404).json({ error: 'Casa não encontrada.' });
    if (house.groupId != null && !house.imageUrl) return res.status(400).json({ error: 'Essa casa ainda não tem imagem (sprite) cadastrada.' });
    if (house.groupId == null && !house.imageUrl) return res.status(400).json({ error: 'Essa casa ainda não tem fundo cadastrado.' });
    await prisma.platformSettings.upsert({
      where: { id: 'singleton' }, update: { starterHouseId: id }, create: { id: 'singleton', starterHouseId: id },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function adminClearStarterHouse(req, res, next) {
  try {
    await prisma.platformSettings.upsert({
      where: { id: 'singleton' }, update: { starterHouseId: null }, create: { id: 'singleton', starterHouseId: null },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function adminSetStarterMap(req, res, next) {
  try {
    const { id } = req.params;
    const map = await prisma.mapBackground.findUnique({ where: { id } });
    if (!map) return res.status(404).json({ error: 'Fundo não encontrado.' });
    await prisma.platformSettings.upsert({
      where: { id: 'singleton' }, update: { starterMapId: id }, create: { id: 'singleton', starterMapId: id },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function adminClearStarterMap(req, res, next) {
  try {
    await prisma.platformSettings.upsert({
      where: { id: 'singleton' }, update: { starterMapId: null }, create: { id: 'singleton', starterMapId: null },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function adminListFurnitureCategories(req, res, next) {
  try {
    const categories = await prisma.furnitureCategory.findMany();
    res.json({ categories });
  } catch (err) { next(err); }
}

async function adminCreateFurnitureCategory(req, res, next) {
  try {
    const { id, name } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'ID e nome são obrigatórios.' });
    const category = await prisma.furnitureCategory.create({ data: { id, name } });
    res.status(201).json({ category });
  } catch (err) { next(err); }
}

async function adminListFurnitureCatalog(req, res, next) {
  try {
    const items = await prisma.furniture.findMany({ include: { category: true }, orderBy: { name: 'asc' } });
    res.json({ items });
  } catch (err) { next(err); }
}

// Upload de imagem do móvel usa o mesmo middleware de upload de imagem já
// existente (uploadImage) — o arquivo cai em /uploads normalmente, igual a
// avatar/banner/emoji.
async function adminCreateFurniture(req, res, next) {
  try {
    const { id, categoryId, name, price, width, height } = req.body;
    if (!id || !categoryId || !name) return res.status(400).json({ error: 'ID, categoria e nome são obrigatórios.' });
    if (!req.file) return res.status(400).json({ error: 'Envie uma imagem pro móvel.' });

    const item = await prisma.furniture.create({
      data: {
        id, categoryId, name, price: parseInt(price, 10) || 0,
        width: parseInt(width, 10) || 200, height: parseInt(height, 10) || 200,
        imageUrl: req.file.url,
      },
    });
    res.status(201).json({ item });
  } catch (err) { next(err); }
}

async function adminUpdateFurniture(req, res, next) {
  try {
    const { id } = req.params;
    const allowed = ['categoryId', 'name', 'price', 'width', 'height'];
    const data = {};
    for (const key of allowed) if (req.body[key] !== undefined) data[key] = req.body[key];
    ['price', 'width', 'height'].forEach((k) => { if (data[k] !== undefined) data[k] = parseInt(data[k], 10); });
    if (req.file) data.imageUrl = req.file.url;
    const item = await prisma.furniture.update({ where: { id }, data });
    res.json({ item });
  } catch (err) { next(err); }
}

async function adminDeleteFurniture(req, res, next) {
  try {
    const { id } = req.params;
    await prisma.furniture.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// --- Moderação de recados (livro de visitas) ---

async function adminListHouseComments(req, res, next) {
  try {
    const comments = await prisma.houseComment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        author: { select: { id: true, displayName: true, avatarUrl: true, profileColor: true } },
        userHouse: { select: { user: { select: { id: true, displayName: true } } } },
      },
    });
    res.json({ comments });
  } catch (err) { next(err); }
}

async function adminDeleteHouseCommentMod(req, res, next) {
  try {
    const { commentId } = req.params;
    await prisma.houseComment.delete({ where: { id: commentId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  listHouseCatalog, buyHouse, listFurnitureCatalog, buyFurniture,
  listMyHouses, getHouseLayout, setActiveHouse, saveHouseLayout, getGallery,
  toggleLike, listComments, addComment, deleteComment, getAchievements,
  listMapBackgrounds, setHouseMapBackground, buyMapBackground,
  adminCreateMapBackground, adminUpdateMapBackground, adminDeleteMapBackground,
  adminListHouseCatalog, adminCreateHouse, adminUpdateHouse, adminDeleteHouse,
  adminListHouseGroups, adminSetHouseGroup, adminDeleteHouseGroup,
  adminSetStarterHouse, adminClearStarterHouse, adminSetStarterMap, adminClearStarterMap,
  adminListFurnitureCategories, adminCreateFurnitureCategory,
  adminListFurnitureCatalog, adminCreateFurniture, adminUpdateFurniture, adminDeleteFurniture,
  adminListHouseComments, adminDeleteHouseCommentMod,
};
