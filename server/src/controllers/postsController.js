const prisma = require('../config/prisma');
const achievements = require('../services/achievements');

const AUTHOR_FIELDS = { id: true, displayName: true, avatarUrl: true, profileColor: true, platformRole: true };
const COMMUNITY_FIELDS = { id: true, slug: true, name: true, iconUrl: true };
const POST_INCLUDE = { author: { select: AUTHOR_FIELDS }, community: { select: COMMUNITY_FIELDS }, category: true };

// Mesma ideia do "hot" do Reddit — pontuação por idade, não só score puro,
// pra post novo com bom engajamento conseguir competir com um post velho
// que só acumulou voto por estar há mais tempo no ar. Calculado aqui (não
// guardado no banco) porque muda a cada minuto que passa, não faz sentido
// denormalizar.
function hotScore(score, createdAt) {
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
  return score / Math.pow(ageHours + 2, 1.5);
}

async function listPosts(req, res, next) {
  try {
    const { communitySlug, categoryId, authorId, sort = 'hot' } = req.query;
    const where = {};
    if (communitySlug) where.community = { slug: communitySlug };
    if (categoryId) where.categoryId = categoryId;
    if (authorId) where.authorId = authorId;
    const posts = await prisma.post.findMany({
      where,
      include: POST_INCLUDE,
      orderBy: sort === 'new' ? { createdAt: 'desc' } : sort === 'top' ? { score: 'desc' } : { createdAt: 'desc' },
      take: 100,
    });
    const myVotes = await prisma.postVote.findMany({
      where: { userId: req.user.id, postId: { in: posts.map((p) => p.id) } },
    });
    const voteMap = Object.fromEntries(myVotes.map((v) => [v.postId, v.value]));
    let result = posts.map((p) => ({ ...p, myVote: voteMap[p.id] || 0 }));
    if (sort === 'hot') {
      result = result.sort((a, b) => hotScore(b.score, b.createdAt) - hotScore(a.score, a.createdAt));
    }
    res.json({ posts: result });
  } catch (err) { next(err); }
}

async function createPost(req, res, next) {
  try {
    const { communitySlug, categoryId, title, type = 'TEXT', content, imageUrl, linkUrl } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Escreva um título.' });
    if (!categoryId) return res.status(400).json({ error: 'Escolha uma categoria dentro do Clube.' });
    if (!['TEXT', 'IMAGE', 'LINK'].includes(type)) return res.status(400).json({ error: 'Tipo de post inválido.' });
    if (type === 'LINK' && !linkUrl?.trim()) return res.status(400).json({ error: 'Informe o link.' });
    if (type === 'IMAGE' && !imageUrl?.trim()) return res.status(400).json({ error: 'Envie uma imagem.' });

    const community = await prisma.community.findUnique({ where: { slug: communitySlug } });
    if (!community) return res.status(404).json({ error: 'Clube não encontrado.' });

    // A categoria precisa mesmo pertencer ao Clube escolhido — evita
    // publicar num Clube usando o id de categoria de outro (nunca
    // confiar só no que o formulário mandou).
    const category = await prisma.postCategory.findUnique({ where: { id: categoryId } });
    if (!category || category.communityId !== community.id) {
      return res.status(400).json({ error: 'Essa categoria não pertence a esse Clube.' });
    }

    const post = await prisma.post.create({
      data: {
        communityId: community.id, categoryId: category.id, authorId: req.user.id, title: title.trim().slice(0, 300),
        type, content: content?.trim().slice(0, 10000) || null,
        imageUrl: type === 'IMAGE' ? imageUrl.trim() : null,
        linkUrl: type === 'LINK' ? linkUrl.trim() : null,
      },
      include: POST_INCLUDE,
    });
    // Postar já conta como voto positivo automático do próprio autor,
    // igual ao Reddit — sem isso o post nasceria com score 0 mesmo tendo
    // um voto "implícito" do autor.
    await prisma.postVote.create({ data: { postId: post.id, userId: req.user.id, value: 1 } });
    await prisma.post.update({ where: { id: post.id }, data: { score: 1 } });

    req.app.get('io')?.emit('post:new', { post: { ...post, score: 1, myVote: 1 } });
    achievements.checkAndUnlock(req.user.id, req.app.get('io')); // primeiro_post / redator
    res.status(201).json({ post: { ...post, score: 1, myVote: 1 } });
  } catch (err) { next(err); }
}

async function getPost(req, res, next) {
  try {
    const { id } = req.params;
    const post = await prisma.post.findUnique({
      where: { id },
      include: POST_INCLUDE,
    });
    if (!post) return res.status(404).json({ error: 'Post não encontrado.' });
    const myVote = await prisma.postVote.findUnique({ where: { postId_userId: { postId: id, userId: req.user.id } } });
    res.json({ post: { ...post, myVote: myVote?.value || 0 } });
  } catch (err) { next(err); }
}

async function deletePost(req, res, next) {
  try {
    const { id } = req.params;
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) return res.status(404).json({ error: 'Post não encontrado.' });
    const isStaff = ['ADMIN', 'MODERATOR'].includes(req.user.platformRole);
    if (post.authorId !== req.user.id && !isStaff) return res.status(403).json({ error: 'Sem permissão.' });
    await prisma.post.delete({ where: { id } });
    req.app.get('io')?.emit('post:delete', { postId: id });
    res.json({ deleted: true });
  } catch (err) { next(err); }
}

// Reaproveitado por votePost e voteComment abaixo — mesmo padrão do
// Reddit: votar de novo com o mesmo valor RETIRA o voto (toggle); votar
// com o valor oposto troca direto. `delta` é o quanto precisa mudar no
// contador denormalizado (score) do post/comentário.
function resolveVoteDelta(existingValue, newValue) {
  if (existingValue === newValue) return { finalValue: 0, delta: -existingValue }; // desfaz
  return { finalValue: newValue, delta: newValue - (existingValue || 0) };
}

async function votePost(req, res, next) {
  try {
    const { id } = req.params;
    const { value } = req.body;
    if (![1, -1].includes(value)) return res.status(400).json({ error: 'Voto inválido.' });

    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) return res.status(404).json({ error: 'Post não encontrado.' });

    const existing = await prisma.postVote.findUnique({ where: { postId_userId: { postId: id, userId: req.user.id } } });
    const { finalValue, delta } = resolveVoteDelta(existing?.value || 0, value);

    if (finalValue === 0) {
      await prisma.postVote.delete({ where: { postId_userId: { postId: id, userId: req.user.id } } });
    } else {
      await prisma.postVote.upsert({
        where: { postId_userId: { postId: id, userId: req.user.id } },
        update: { value: finalValue }, create: { postId: id, userId: req.user.id, value: finalValue },
      });
    }
    const updated = await prisma.post.update({ where: { id }, data: { score: { increment: delta } } });
    req.app.get('io')?.emit('post:vote', { postId: id, score: updated.score });
    require('../services/ups').emitUpsUpdate(req.app.get('io'), post.authorId);
    achievements.checkAndUnlock(post.authorId, req.app.get('io')); // influenciador
    res.json({ score: updated.score, myVote: finalValue });
  } catch (err) { next(err); }
}

// Monta a árvore de comentários (parentId -> filhos) a partir da lista
// achatada que o banco devolve — mais simples de fazer aqui em memória do
// que tentando montar isso via query recursiva no Prisma.
function buildCommentTree(flat) {
  const byId = new Map(flat.map((c) => [c.id, { ...c, replies: [] }]));
  const roots = [];
  for (const c of byId.values()) {
    if (c.parentId && byId.has(c.parentId)) byId.get(c.parentId).replies.push(c);
    else roots.push(c);
  }
  return roots;
}

async function listComments(req, res, next) {
  try {
    const { id } = req.params; // postId
    const flat = await prisma.postComment.findMany({
      where: { postId: id },
      include: { author: { select: AUTHOR_FIELDS } },
      orderBy: { createdAt: 'asc' },
    });
    const myVotes = await prisma.postCommentVote.findMany({
      where: { userId: req.user.id, commentId: { in: flat.map((c) => c.id) } },
    });
    const voteMap = Object.fromEntries(myVotes.map((v) => [v.commentId, v.value]));
    const withVotes = flat.map((c) => ({ ...c, myVote: voteMap[c.id] || 0 }));
    res.json({ comments: buildCommentTree(withVotes) });
  } catch (err) { next(err); }
}

async function addComment(req, res, next) {
  try {
    const { id } = req.params; // postId
    const { content, parentId } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Escreva um comentário.' });

    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) return res.status(404).json({ error: 'Post não encontrado.' });
    if (parentId) {
      const parent = await prisma.postComment.findUnique({ where: { id: parentId } });
      if (!parent || parent.postId !== id) return res.status(400).json({ error: 'Comentário pai inválido.' });
    }

    const comment = await prisma.postComment.create({
      data: { postId: id, authorId: req.user.id, parentId: parentId || null, content: content.trim().slice(0, 5000) },
      include: { author: { select: AUTHOR_FIELDS } },
    });
    await prisma.post.update({ where: { id }, data: { commentCount: { increment: 1 } } });

    const io = req.app.get('io');
    io?.emit('post:comment', { postId: id, comment: { ...comment, replies: [], myVote: 0 } });
    achievements.checkAndUnlock(req.user.id, io); // comentarista
    res.status(201).json({ comment: { ...comment, replies: [], myVote: 0 } });
  } catch (err) { next(err); }
}

async function voteComment(req, res, next) {
  try {
    const { id } = req.params; // commentId
    const { value } = req.body;
    if (![1, -1].includes(value)) return res.status(400).json({ error: 'Voto inválido.' });

    const comment = await prisma.postComment.findUnique({ where: { id } });
    if (!comment) return res.status(404).json({ error: 'Comentário não encontrado.' });

    const existing = await prisma.postCommentVote.findUnique({ where: { commentId_userId: { commentId: id, userId: req.user.id } } });
    const { finalValue, delta } = resolveVoteDelta(existing?.value || 0, value);

    if (finalValue === 0) {
      await prisma.postCommentVote.delete({ where: { commentId_userId: { commentId: id, userId: req.user.id } } });
    } else {
      await prisma.postCommentVote.upsert({
        where: { commentId_userId: { commentId: id, userId: req.user.id } },
        update: { value: finalValue }, create: { commentId: id, userId: req.user.id, value: finalValue },
      });
    }
    const updated = await prisma.postComment.update({ where: { id }, data: { score: { increment: delta } } });
    req.app.get('io')?.emit('post:comment-vote', { commentId: id, postId: comment.postId, score: updated.score });
    require('../services/ups').emitUpsUpdate(req.app.get('io'), comment.authorId);
    achievements.checkAndUnlock(comment.authorId, req.app.get('io')); // voz_da_comunidade
    res.json({ score: updated.score, myVote: finalValue });
  } catch (err) { next(err); }
}

async function deleteComment(req, res, next) {
  try {
    const { id } = req.params;
    const comment = await prisma.postComment.findUnique({ where: { id } });
    if (!comment) return res.status(404).json({ error: 'Comentário não encontrado.' });
    const isStaff = ['ADMIN', 'MODERATOR'].includes(req.user.platformRole);
    if (comment.authorId !== req.user.id && !isStaff) return res.status(403).json({ error: 'Sem permissão.' });

    // Igual ao Reddit: se tiver respostas, não apaga de verdade (quebraria
    // a árvore) — só marca como removido e esvazia o texto, mantendo a
    // estrutura pros filhos continuarem visíveis/navegáveis.
    const hasReplies = await prisma.postComment.count({ where: { parentId: id } });
    if (hasReplies > 0) {
      await prisma.postComment.update({ where: { id }, data: { deleted: true, content: '[removido]' } });
    } else {
      await prisma.postComment.delete({ where: { id } });
      await prisma.post.update({ where: { id: comment.postId }, data: { commentCount: { decrement: 1 } } });
    }
    req.app.get('io')?.emit('post:comment-delete', { commentId: id, postId: comment.postId });
    res.json({ deleted: true });
  } catch (err) { next(err); }
}

// Upload de imagem pra post (item 6) — reaproveita o mesmo middleware
// uploadImage (multer -> Backblaze B2, validado por magic bytes reais,
// não só pelo Content-Type que o navegador declarou — ver auditoria de
// segurança em middleware/upload.js) já usado em avatar/banner/emoji.
// Devolve só a URL; o front usa ela como preview e manda junto no
// POST /api/posts na hora de publicar de verdade.
async function uploadPostImage(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie uma imagem.' });
    res.json({ url: req.file.url });
  } catch (err) { next(err); }
}

module.exports = {
  listPosts, createPost, uploadPostImage, getPost, deletePost, votePost,
  listComments, addComment, voteComment, deleteComment,
};
