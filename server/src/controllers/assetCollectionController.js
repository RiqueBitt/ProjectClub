const prisma = require('../config/prisma');
const { requireCommunityPermission } = require('../services/authz');

// Item pedido: "sistema de coleções de emoji personalizado e
// figurinha... nome e ícone pro catálogo, botão de criar categoria em
// cada aba, podendo editar nome/ícone depois" — CRUD compartilhado
// entre os dois tipos (ver AssetCollection no schema.prisma), cada
// operação exige a permissão do tipo correspondente (MANAGE_EMOJIS ou
// MANAGE_STICKERS), nunca a do outro.
const VALID_KINDS = ['EMOJI', 'STICKER'];
const permissionFor = (kind) => (kind === 'STICKER' ? 'MANAGE_STICKERS' : 'MANAGE_EMOJIS');

async function listCollections(req, res, next) {
  try {
    const { kind } = req.params;
    if (!VALID_KINDS.includes(kind)) return res.status(400).json({ error: 'Tipo inválido.' });
    const collections = await prisma.assetCollection.findMany({ where: { kind }, orderBy: { order: 'asc' } });
    res.json({ collections });
  } catch (err) { next(err); }
}

async function createCollection(req, res, next) {
  try {
    const { kind } = req.params;
    if (!VALID_KINDS.includes(kind)) return res.status(400).json({ error: 'Tipo inválido.' });
    await requireCommunityPermission(req.user.id, permissionFor(kind));

    const { name } = req.body;
    if (!name?.trim() || name.trim().length > 32) return res.status(400).json({ error: 'Nome inválido (até 32 caracteres).' });
    if (!req.file) return res.status(400).json({ error: 'Escolha uma imagem pra ser o ícone da coleção.' });

    const count = await prisma.assetCollection.count({ where: { kind } });
    const collection = await prisma.assetCollection.create({
      data: { kind, name: name.trim(), iconUrl: req.file.url, order: count },
    });
    req.app.get('io')?.to('community').emit('assetCollection:new', collection);
    res.status(201).json({ collection });
  } catch (err) { next(err); }
}

async function updateCollection(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.assetCollection.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Coleção não encontrada.' });
    await requireCommunityPermission(req.user.id, permissionFor(existing.kind));

    const { name } = req.body;
    const data = {};
    if (name !== undefined) {
      if (!name.trim() || name.trim().length > 32) return res.status(400).json({ error: 'Nome inválido (até 32 caracteres).' });
      data.name = name.trim();
    }
    // Trocar o ícone é opcional na edição — só manda um arquivo novo
    // quem realmente quer trocá-lo, mudar só o nome não deveria exigir
    // escolher a imagem de novo.
    if (req.file) data.iconUrl = req.file.url;

    const collection = await prisma.assetCollection.update({ where: { id }, data });
    req.app.get('io')?.to('community').emit('assetCollection:update', collection);
    res.json({ collection });
  } catch (err) { next(err); }
}

async function deleteCollection(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.assetCollection.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Coleção não encontrada.' });
    await requireCommunityPermission(req.user.id, permissionFor(existing.kind));

    // Não apaga os emojis/figurinhas dentro dela — só desvincula (ver
    // onDelete: SetNull no schema), eles voltam a aparecer soltos,
    // sem coleção, em vez de sumir junto.
    await prisma.assetCollection.delete({ where: { id } });
    req.app.get('io')?.to('community').emit('assetCollection:delete', { id, kind: existing.kind });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { listCollections, createCollection, updateCollection, deleteCollection };
