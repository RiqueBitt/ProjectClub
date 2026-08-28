const prisma = require('../config/prisma');
const { CAPSULE_PRICES } = require('../data/stickersCatalog');

function weightedDraw(rarities) {
  const total = rarities.reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total;
  for (const r of rarities) {
    roll -= r.weight;
    if (roll <= 0) return r;
  }
  return rarities[rarities.length - 1];
}

async function getAlbumSettings() {
  const settings = await prisma.albumSettings.upsert({
    where: { id: 'singleton' }, update: {}, create: { id: 'singleton' },
  });
  const slots = await prisma.albumSlot.findMany({ where: { enabled: true }, orderBy: { slotKey: 'asc' } });
  return { settings, slots };
}

async function getCollection(req, res, next) {
  try {
    const { page } = req.query;
    const currentPage = Math.max(1, parseInt(page, 10) || 1);

    const [rarities, stickers, owned, albumRows, pendingCapsules, { settings, slots }] = await Promise.all([
      prisma.stickerRarity.findMany(),
      prisma.collectibleSticker.findMany({ where: { enabled: true } }),
      prisma.userSticker.findMany({ where: { userId: req.user.id } }),
      prisma.userStickerAlbum.findMany({ where: { userId: req.user.id } }),
      prisma.stickerCapsule.count({ where: { userId: req.user.id, opened: false } }),
      getAlbumSettings(),
    ]);

    const ownedQty = Object.fromEntries(owned.map((o) => [o.stickerId, o.quantity]));
    const pastedByStickerId = Object.fromEntries(albumRows.map((a) => [a.stickerId, a]));

    const groups = rarities.map((r) => ({
      rarity: r,
      stickers: stickers
        .filter((s) => s.rarityId === r.id)
        .map((s) => ({ ...s, quantity: ownedQty[s.id] || 0, pasted: !!pastedByStickerId[s.id] })),
    })).filter((g) => g.stickers.length > 0);

    const pastedIds = new Set(albumRows.map((a) => a.stickerId));
    const stickersOnPage = stickers.filter((s) => s.assignedPage === currentPage && s.assignedSlotKey);
    const albumPageSlots = slots.map((slot) => {
      const assigned = stickersOnPage.find((s) => s.assignedSlotKey === slot.slotKey);
      const isPasted = assigned && pastedIds.has(assigned.id);
      return { ...slot, stickerId: assigned?.id || null, sticker: isPasted ? assigned : null };
    });

    const looseStickers = stickers
      .filter((s) => (ownedQty[s.id] || 0) > 0)
      .map((s) => ({ ...s, quantity: ownedQty[s.id] }));

    res.json({
      groups, looseStickers,
      album: { settings, page: currentPage, totalPages: settings.totalPages, slots: albumPageSlots },
      capsuleCount: pendingCapsules,
      totalOwned: owned.reduce((s, o) => s + o.quantity, 0) + albumRows.length,
      distinctOwned: new Set([...owned.map((o) => o.stickerId), ...albumRows.map((a) => a.stickerId)]).size,
      totalCatalog: stickers.length,
      capsulePrices: CAPSULE_PRICES,
    });
  } catch (err) { next(err); }
}

async function buyCapsules(req, res, next) {
  try {
    const quantity = Number(req.body.quantity);
    const price = CAPSULE_PRICES[quantity];
    if (!price) return res.status(400).json({ error: 'Quantidade inválida.' });

    const rarities = await prisma.stickerRarity.findMany();
    const allStickers = await prisma.collectibleSticker.findMany({ where: { enabled: true } });
    if (!allStickers.length) return res.status(400).json({ error: 'Nenhuma figurinha disponível no catálogo.' });

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: req.user.id }, select: { coins: true } });
      if (user.coins < price) { const e = new Error('Moedas insuficientes.'); e.status = 400; throw e; }
      await tx.user.update({ where: { id: req.user.id }, data: { coins: { decrement: price } } });

      const capsules = [];
      for (let i = 0; i < quantity; i++) {
        const rarity = weightedDraw(rarities);
        const candidates = allStickers.filter((s) => s.rarityId === rarity.id);
        const pool = candidates.length ? candidates : allStickers;
        const sticker = pool[Math.floor(Math.random() * pool.length)];
        capsules.push(await tx.stickerCapsule.create({ data: { userId: req.user.id, stickerId: sticker.id } }));
      }
      return capsules;
    });

    res.status(201).json({ ok: true, capsulesBought: result.length });
  } catch (err) { next(err); }
}

async function openAllCapsules(req, res, next) {
  try {
    const pending = await prisma.stickerCapsule.findMany({
      where: { userId: req.user.id, opened: false }, include: { sticker: true },
    });
    if (!pending.length) return res.status(400).json({ error: 'Você não tem cápsulas fechadas.' });

    const results = await prisma.$transaction(async (tx) => {
      const out = [];
      for (const cap of pending) {
        await tx.stickerCapsule.update({ where: { id: cap.id }, data: { opened: true, openedAt: new Date() } });
        await tx.userSticker.upsert({
          where: { userId_stickerId: { userId: req.user.id, stickerId: cap.stickerId } },
          update: { quantity: { increment: 1 } },
          create: { userId: req.user.id, stickerId: cap.stickerId, quantity: 1 },
        });
        out.push({ stickerId: cap.stickerId, name: cap.sticker.name, imageUrl: cap.sticker.imageUrl, rarityId: cap.sticker.rarityId });
      }
      return out;
    });

    res.json({ ok: true, results });
  } catch (err) { next(err); }
}

async function pasteSticker(req, res, next) {
  try {
    const { id } = req.params;
    const owned = await prisma.userSticker.findUnique({ where: { userId_stickerId: { userId: req.user.id, stickerId: id } } });
    if (!owned || owned.quantity < 1) return res.status(400).json({ error: 'Você não tem essa figurinha.' });

    const already = await prisma.userStickerAlbum.findUnique({ where: { userId_stickerId: { userId: req.user.id, stickerId: id } } });
    if (already) return res.status(400).json({ error: 'Essa figurinha já está colada no álbum.' });

    const sticker = await prisma.collectibleSticker.findUnique({ where: { id } });
    if (!sticker.assignedSlotKey) {
      return res.status(400).json({ error: 'A staff ainda não definiu uma posição pra essa figurinha no álbum.' });
    }

    await prisma.$transaction(async (tx) => {
      const occupant = await tx.userStickerAlbum.findFirst({
        where: { userId: req.user.id, sticker: { assignedPage: sticker.assignedPage, assignedSlotKey: sticker.assignedSlotKey } },
      });
      if (occupant) {
        await tx.userStickerAlbum.delete({ where: { id: occupant.id } });
        await tx.userSticker.upsert({
          where: { userId_stickerId: { userId: req.user.id, stickerId: occupant.stickerId } },
          update: { quantity: { increment: 1 } },
          create: { userId: req.user.id, stickerId: occupant.stickerId, quantity: 1 },
        });
      }
      await tx.userSticker.update({ where: { id: owned.id }, data: { quantity: { decrement: 1 } } });
      await tx.userStickerAlbum.create({ data: { userId: req.user.id, stickerId: id } });
    });

    res.json({ ok: true, page: sticker.assignedPage });
  } catch (err) { next(err); }
}

// --- Administração do layout do álbum (staff) ---

async function adminGetAlbumLayout(req, res, next) {
  try {
    const { settings } = await getAlbumSettings();
    const allSlots = await prisma.albumSlot.findMany({ orderBy: { slotKey: 'asc' } });
    const stickers = await prisma.collectibleSticker.findMany({ orderBy: { name: 'asc' } });
    res.json({ settings, slots: allSlots, stickers });
  } catch (err) { next(err); }
}

async function adminUpdateAlbumSettings(req, res, next) {
  try {
    const allowed = ['backgroundColor', 'backgroundImageUrl', 'totalPages', 'showBorder', 'showNames'];
    const data = {};
    for (const key of allowed) if (req.body[key] !== undefined) data[key] = req.body[key];
    const settings = await prisma.albumSettings.upsert({
      where: { id: 'singleton' }, update: data, create: { id: 'singleton', ...data },
    });
    res.json({ settings });
  } catch (err) { next(err); }
}

const SLOT_DEFAULTS = Array.from({ length: 12 }, (_, i) => ({
  slotKey: `slot${i}`, x: 50 + (i % 4) * 426, y: 150 + Math.floor(i / 4) * 346, width: 396, height: 316, enabled: i < 6,
}));

async function adminUpsertAlbumSlot(req, res, next) {
  try {
    const { slotKey } = req.params;
    const fallback = SLOT_DEFAULTS.find((s) => s.slotKey === slotKey);
    if (!fallback) return res.status(400).json({ error: 'Espaço inválido (use slot0..slot11).' });

    const { x, y, width, height, enabled } = req.body;
    const patch = {
      ...(x !== undefined ? { x: Math.round(x) } : {}),
      ...(y !== undefined ? { y: Math.round(y) } : {}),
      ...(width !== undefined ? { width: Math.round(width) } : {}),
      ...(height !== undefined ? { height: Math.round(height) } : {}),
      ...(enabled !== undefined ? { enabled: !!enabled } : {}),
    };
    const slot = await prisma.albumSlot.upsert({
      where: { slotKey }, update: patch, create: { ...fallback, ...patch },
    });
    res.json({ slot });
  } catch (err) { next(err); }
}

async function adminAssignStickerPosition(req, res, next) {
  try {
    const { id } = req.params;
    const { page, slotKey } = req.body;
    const sticker = await prisma.collectibleSticker.findUnique({ where: { id } });
    if (!sticker) return res.status(404).json({ error: 'Figurinha não encontrada.' });

    if (slotKey === null || slotKey === undefined) {
      const updated = await prisma.collectibleSticker.update({ where: { id }, data: { assignedSlotKey: null } });
      return res.json({ sticker: updated });
    }

    const targetPage = Math.max(1, parseInt(page, 10) || 1);
    const conflict = await prisma.collectibleSticker.findFirst({
      where: { assignedPage: targetPage, assignedSlotKey: slotKey, id: { not: id } },
    });
    if (conflict) {
      return res.status(400).json({ error: `O espaço "${slotKey}" na página ${targetPage} já está ocupado por "${conflict.name}".` });
    }

    const updated = await prisma.collectibleSticker.update({
      where: { id }, data: { assignedPage: targetPage, assignedSlotKey: slotKey },
    });
    res.json({ sticker: updated });
  } catch (err) { next(err); }
}

module.exports = {
  getCollection, buyCapsules, openAllCapsules, pasteSticker,
  adminGetAlbumLayout, adminUpdateAlbumSettings, adminUpsertAlbumSlot, adminAssignStickerPosition,
};
