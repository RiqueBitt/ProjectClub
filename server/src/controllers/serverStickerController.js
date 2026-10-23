const prisma = require('../config/prisma');
const { requireCommunityPermission } = require('../services/authz');

// Item pedido: "sistema de figurinhas... podendo criar no painel da
// staff... quando abrir emoji vai aparecer as opções: Emoji, Emoji
// personalizado, Figurinhas" — o modelo Sticker já existia no schema
// (id/name/url/createdBy), mas nunca tinha sido conectado a nenhum
// controller ou rota — toda a "tubulação" de envio/exibição de
// figurinha em mensagens (Message.stickerUrl, ChatWindow.sendSticker,
// EmojiPicker's serverStickers prop) já existia pronta e testada,
// só faltando de onde os dados realmente vêm. Mesmo padrão de
// emojiController.js — limite mais baixo que emoji (60 vs 250) porque
// figurinha costuma ser uma imagem bem maior visualmente.
const STICKER_SLOT_LIMIT = 60;
const NAME_RE = /^[a-zA-Z0-9_ ]{2,32}$/;

async function listStickers(req, res, next) {
  try {
    const stickers = await prisma.sticker.findMany({ orderBy: { createdAt: 'asc' } });
    res.json({ stickers });
  } catch (err) { next(err); }
}

async function createSticker(req, res, next) {
  try {
    await requireCommunityPermission(req.user.id, 'MANAGE_STICKERS');

    const { name, collectionId } = req.body;
    if (!name || !NAME_RE.test(name)) {
      return res.status(400).json({ error: 'Nome inválido. Use 2-32 letras, números, espaços ou "_".' });
    }
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    // Item pedido: "sistema de coleções" — confere que a coleção
    // escolhida existe e é mesmo do tipo STICKER.
    if (collectionId) {
      const collection = await prisma.assetCollection.findUnique({ where: { id: collectionId } });
      if (!collection || collection.kind !== 'STICKER') return res.status(400).json({ error: 'Coleção inválida.' });
    }

    const existing = await prisma.sticker.findUnique({ where: { name } });
    if (existing) return res.status(409).json({ error: 'Já existe uma figurinha com esse nome.' });

    const count = await prisma.sticker.count();
    if (count >= STICKER_SLOT_LIMIT) {
      return res.status(400).json({ error: `Limite de ${STICKER_SLOT_LIMIT} figurinhas atingido.` });
    }

    const sticker = await prisma.sticker.create({
      data: { name, url: req.file.url, collectionId: collectionId || null, createdById: req.user.id },
    });
    req.app.get('io')?.to('community').emit('sticker:new', sticker);
    res.status(201).json({ sticker });
  } catch (err) { next(err); }
}

// Item pedido: "podendo clicar [na coleção] e colocar o emoji/
// figurinha que você deseja" — mover uma figurinha já existente pra
// dentro (ou pra fora) de uma coleção.
async function updateSticker(req, res, next) {
  try {
    const { id } = req.params;
    await requireCommunityPermission(req.user.id, 'MANAGE_STICKERS');

    const existing = await prisma.sticker.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Figurinha não encontrada.' });

    const data = {};
    if (req.body.collectionId !== undefined) {
      if (req.body.collectionId) {
        const collection = await prisma.assetCollection.findUnique({ where: { id: req.body.collectionId } });
        if (!collection || collection.kind !== 'STICKER') return res.status(400).json({ error: 'Coleção inválida.' });
      }
      data.collectionId = req.body.collectionId || null;
    }

    const sticker = await prisma.sticker.update({ where: { id }, data });
    req.app.get('io')?.to('community').emit('sticker:update', sticker);
    res.json({ sticker });
  } catch (err) { next(err); }
}

async function deleteSticker(req, res, next) {
  try {
    const { id } = req.params;
    await requireCommunityPermission(req.user.id, 'MANAGE_STICKERS');

    const existing = await prisma.sticker.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Figurinha não encontrada.' });

    await prisma.sticker.delete({ where: { id } });
    req.app.get('io')?.to('community').emit('sticker:delete', { id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { listStickers, createSticker, updateSticker, deleteSticker };
