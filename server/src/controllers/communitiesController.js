const prisma = require('../config/prisma');

const AUTHOR_FIELDS = { id: true, displayName: true, avatarUrl: true, profileColor: true, platformRole: true };
const SLUG_RE = /^[a-z0-9_]{3,24}$/;
const isStaff = (user) => ['ADMIN', 'MODERATOR'].includes(user.platformRole);

// Categorias padrão de todo Clube novo — a staff pode editar/remover/
// adicionar depois pela tela de gerenciar o Clube (ver a seção de
// categorias mais abaixo).
const DEFAULT_CATEGORIES = ['Discussão', 'Meme', 'Preciso de ajuda', 'Dúvida', 'Notícia', 'Outros'];

const communityInclude = {
  createdBy: { select: AUTHOR_FIELDS },
  categories: { orderBy: { position: 'asc' } },
  _count: { select: { posts: true } },
};

function shapeCommunity(c) {
  return { ...c, postCount: c._count.posts, _count: undefined };
}

async function listCommunities(req, res, next) {
  try {
    const communities = await prisma.community.findMany({
      include: communityInclude,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ communities: communities.map(shapeCommunity) });
  } catch (err) { next(err); }
}

// SEGURANÇA: só a staff (ADMIN/MODERATOR) pode criar Clube — Clubes agora
// são categorias oficiais de organização do Feed, não comunidades que
// qualquer usuário cria livremente (mudança de design pedida pelo dono).
async function createCommunity(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode criar Clubes.' });

    const { slug, name, description } = req.body;
    const cleanSlug = (slug || '').trim().toLowerCase();
    if (!SLUG_RE.test(cleanSlug)) {
      return res.status(400).json({ error: 'O identificador deve ter 3-24 letras minúsculas, números ou "_".' });
    }
    if (!name?.trim()) return res.status(400).json({ error: 'Escreva um nome para o Clube.' });

    const existing = await prisma.community.findUnique({ where: { slug: cleanSlug } });
    if (existing) return res.status(409).json({ error: 'Já existe um Clube com esse identificador.' });

    const community = await prisma.community.create({
      data: {
        slug: cleanSlug, name: name.trim().slice(0, 80), description: description?.trim().slice(0, 500) || null,
        createdById: req.user.id,
        categories: { create: DEFAULT_CATEGORIES.map((catName, position) => ({ name: catName, position })) },
      },
      include: communityInclude,
    });

    const shaped = shapeCommunity(community);
    // TEMPO REAL (item 5 corrigido): antes, criar/editar/excluir Clube
    // não emitia NENHUM evento de socket — quem já estava com o site
    // aberto só via a mudança se recarregasse a página na mão. Sala
    // "community" é a mesma já usada pelos outros eventos globais da
    // plataforma (ver adminController.js).
    req.app.get('io')?.to('community').emit('club:new', shaped);
    res.status(201).json({ community: shaped });
  } catch (err) { next(err); }
}

// Editar nome/descrição/logo — só staff (Clubes são estrutura oficial
// agora, não algo que o criador administra sozinho como antes).
async function updateCommunity(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode editar Clubes.' });
    const { slug } = req.params;
    const { name, description } = req.body;
    const community = await prisma.community.findUnique({ where: { slug } });
    if (!community) return res.status(404).json({ error: 'Clube não encontrado.' });

    const data = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'Escreva um nome para o Clube.' });
      data.name = name.trim().slice(0, 80);
    }
    if (description !== undefined) data.description = description?.trim().slice(0, 500) || null;

    const updated = await prisma.community.update({ where: { slug }, data, include: communityInclude });
    const shaped = shapeCommunity(updated);
    req.app.get('io')?.to('community').emit('club:update', shaped);
    res.json({ community: shaped });
  } catch (err) { next(err); }
}

async function uploadCommunityIcon(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode editar Clubes.' });
    const { slug } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Envie uma imagem.' });
    const community = await prisma.community.findUnique({ where: { slug } });
    if (!community) return res.status(404).json({ error: 'Clube não encontrado.' });

    const updated = await prisma.community.update({
      where: { slug }, data: { iconUrl: req.file.url }, include: communityInclude,
    });
    const shaped = shapeCommunity(updated);
    req.app.get('io')?.to('community').emit('club:update', shaped);
    res.json({ community: shaped });
  } catch (err) { next(err); }
}

async function getCommunity(req, res, next) {
  try {
    const { slug } = req.params;
    const community = await prisma.community.findUnique({ where: { slug }, include: communityInclude });
    if (!community) return res.status(404).json({ error: 'Clube não encontrado.' });
    res.json({ community: shapeCommunity(community) });
  } catch (err) { next(err); }
}

// Excluir Clube inteiro (com todos os posts/comentários/votos/categorias
// dele, via onDelete: Cascade no schema) — só staff.
async function deleteCommunity(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode excluir Clubes.' });
    const { slug } = req.params;
    const community = await prisma.community.findUnique({ where: { slug } });
    if (!community) return res.status(404).json({ error: 'Clube não encontrado.' });
    await prisma.community.delete({ where: { slug } });
    req.app.get('io')?.to('community').emit('club:delete', { id: community.id, slug });
    res.json({ deleted: true });
  } catch (err) { next(err); }
}

// --- Categorias de post dentro de um Clube — staff-only. ---

async function createCategory(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode gerenciar categorias.' });
    const { slug } = req.params;
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Escreva um nome para a categoria.' });
    const community = await prisma.community.findUnique({ where: { slug } });
    if (!community) return res.status(404).json({ error: 'Clube não encontrado.' });

    const count = await prisma.postCategory.count({ where: { communityId: community.id } });
    const category = await prisma.postCategory.create({
      data: {
        communityId: community.id, name: name.trim().slice(0, 40),
        description: description?.trim().slice(0, 1000) || null, position: count,
      },
    });
    req.app.get('io')?.to('community').emit('club:category:new', { communityId: community.id, category });
    res.status(201).json({ category });
  } catch (err) { next(err); }
}

async function updateCategory(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode gerenciar categorias.' });
    const { id } = req.params;
    const { name, description } = req.body;
    const data = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'Escreva um nome para a categoria.' });
      data.name = name.trim().slice(0, 40);
    }
    if (description !== undefined) data.description = description?.trim().slice(0, 1000) || null;
    const category = await prisma.postCategory.update({ where: { id }, data });
    req.app.get('io')?.to('community').emit('club:category:update', { communityId: category.communityId, category });
    res.json({ category });
  } catch (err) { next(err); }
}

// Upload de ícone (pequeno, mostrado no chip da categoria) ou banner
// (grande, mostrado no topo da lista de posts filtrada por categoria) —
// mesmo middleware validado por magic bytes reais de sempre. Duas rotas
// explícitas (/icon e /banner) em vez de um parâmetro de rota com regex
// — mais simples e portátil entre versões do Express/path-to-regexp do
// que `:kind(icon|banner)`.
async function uploadCategoryIcon(req, res, next) {
  return uploadCategoryImageField(req, res, next, 'iconUrl');
}
async function uploadCategoryBanner(req, res, next) {
  return uploadCategoryImageField(req, res, next, 'bannerUrl');
}
async function uploadCategoryImageField(req, res, next, field) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode gerenciar categorias.' });
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Envie uma imagem.' });
    const category = await prisma.postCategory.update({ where: { id }, data: { [field]: req.file.url } });
    req.app.get('io')?.to('community').emit('club:category:update', { communityId: category.communityId, category });
    res.json({ category });
  } catch (err) { next(err); }
}

async function deleteCategory(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode gerenciar categorias.' });
    const { id } = req.params;
    const category = await prisma.postCategory.findUnique({ where: { id } });
    if (!category) return res.status(404).json({ error: 'Categoria não encontrada.' });

    const remaining = await prisma.postCategory.count({ where: { communityId: category.communityId } });
    if (remaining <= 1) return res.status(400).json({ error: 'O Clube precisa ter pelo menos uma categoria.' });
    const inUse = await prisma.post.count({ where: { categoryId: id } });
    if (inUse > 0) return res.status(400).json({ error: 'Essa categoria já tem posts — mova ou apague os posts antes de excluí-la.' });

    await prisma.postCategory.delete({ where: { id } });
    req.app.get('io')?.to('community').emit('club:category:delete', { communityId: category.communityId, id });
    res.json({ deleted: true });
  } catch (err) { next(err); }
}

module.exports = {
  listCommunities, createCommunity, updateCommunity, uploadCommunityIcon, getCommunity, deleteCommunity,
  createCategory, updateCategory, uploadCategoryIcon, uploadCategoryBanner, deleteCategory,
};
