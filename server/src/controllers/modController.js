const prisma = require('../config/prisma');
const modio = require('../services/modioService');

// Item pedido: "Project Club → Apps → Mods → detectar Steam → detectar
// jogos instalados → mostrar os jogos do usuário" — o CLIENTE detecta os
// AppIDs da Steam localmente (ver desktop/steamDetector.js — item pedido
// 30: "a detecção da Steam deve acontecer localmente sempre que
// possível... o servidor deve receber somente os dados necessários"), e
// manda só a LISTA DE APPIDS pra cá. Este endpoint faz o cruzamento com
// ModGameMapping (staff-editável) e devolve só os que têm suporte a mods
// configurado — nunca inventa suporte pra um jogo que não foi mapeado
// (item pedido 5).
async function matchSteamGames(req, res, next) {
  try {
    const { steamAppIds } = req.body;
    if (!Array.isArray(steamAppIds) || steamAppIds.length === 0) return res.json({ games: [] });
    const appIds = steamAppIds.map(Number).filter((n) => Number.isInteger(n));
    const mappings = await prisma.modGameMapping.findMany({
      where: { steamAppId: { in: appIds }, enabled: true },
    });
    res.json({ games: mappings });
  } catch (err) { next(err); }
}

// GET /mods/games/:modioGameId — confirma que o jogo existe/está ativo no
// mod.io antes de mostrar a tela dele.
async function getGame(req, res, next) {
  try {
    const game = await modio.getGame(Number(req.params.modioGameId));
    res.json({ game });
  } catch (err) {
    if (err instanceof modio.ModioNotConfiguredError) return res.status(503).json({ error: err.message });
    next(err);
  }
}

// GET /mods/games/:modioGameId/mods — busca/lista mods de um jogo. Item
// pedido: pesquisa por nome/autor/categoria/tags + filtros (populares,
// mais baixados, melhor avaliados, novos, atualizados).
async function listMods(req, res, next) {
  try {
    const modioGameId = Number(req.params.modioGameId);
    const { q, sort, category, tags, offset, limit } = req.query;
    const data = await modio.listMods(modioGameId, {
      query: q, sort, category, tags,
      offset: offset ? Number(offset) : 0,
      limit: limit ? Math.min(Number(limit), 50) : 20,
    });

    // Enriquece com favoritos/ups do usuário logado — pra UI já mostrar
    // o coração/up preenchido sem precisar de uma segunda chamada.
    const modioModIds = data.data.map((m) => m.id);
    const [favorites, ups] = await Promise.all([
      prisma.modFavorite.findMany({ where: { userId: req.user.id, modioModId: { in: modioModIds } }, select: { modioModId: true } }),
      prisma.modUp.findMany({ where: { userId: req.user.id, modioModId: { in: modioModIds } }, select: { modioModId: true } }),
    ]);
    const favoriteSet = new Set(favorites.map((f) => f.modioModId));
    const upSet = new Set(ups.map((u) => u.modioModId));
    const mods = data.data.map((m) => ({ ...m, isFavorited: favoriteSet.has(m.id), isUpped: upSet.has(m.id) }));

    res.json({ mods, resultTotal: data.result_total, resultCount: data.result_count, resultOffset: data.result_offset });
  } catch (err) {
    if (err instanceof modio.ModioNotConfiguredError) return res.status(503).json({ error: err.message });
    next(err);
  }
}

// GET /mods/games/:modioGameId/tags — categorias disponíveis pra esse jogo.
async function getGameTags(req, res, next) {
  try {
    const tags = await modio.getGameTags(Number(req.params.modioGameId));
    res.json({ tags });
  } catch (err) {
    if (err instanceof modio.ModioNotConfiguredError) return res.status(503).json({ error: err.message });
    next(err);
  }
}

// GET /mods/games/:modioGameId/mods/:modioModId — página individual do
// mod. Item pedido: nome, ícone, autor, versão, downloads, avaliação,
// descrição, screenshots, vídeos, categorias, tags, dependências,
// changelog + nossos próprios dados sociais (favorito/up/comentários).
async function getMod(req, res, next) {
  try {
    const modioGameId = Number(req.params.modioGameId);
    const modioModId = Number(req.params.modioModId);
    const [mod, dependencies, favorite, up, commentCount] = await Promise.all([
      modio.getMod(modioGameId, modioModId),
      modio.getModDependencies(modioGameId, modioModId).catch(() => ({ data: [] })), // dependências são opcionais; nunca quebra a página do mod se a chamada falhar
      prisma.modFavorite.findUnique({ where: { userId_modioModId: { userId: req.user.id, modioModId } } }),
      prisma.modUp.findUnique({ where: { userId_modioModId: { userId: req.user.id, modioModId } } }),
      prisma.modComment.count({ where: { modioModId } }),
    ]);
    res.json({
      mod, dependencies: dependencies.data || [],
      isFavorited: !!favorite, isUpped: !!up, commentCount,
    });
  } catch (err) {
    if (err instanceof modio.ModioNotConfiguredError) return res.status(503).json({ error: err.message });
    if (err.status === 404) return res.status(404).json({ error: 'Mod não encontrado.' });
    next(err);
  }
}

// POST /mods/games/:modioGameId/mods/:modioModId/download — devolve a URL
// de download ASSINADA do modfile atual, pro app desktop baixar DIRETO do
// mod.io. Item pedido (regra obrigatória): "os arquivos dos mods não
// devem ser armazenados no banco de dados do Project Club" — esta rota
// nunca lê nem grava o arquivo, só repassa a URL que o próprio mod.io
// gerou (ela já expira sozinha, ver Download Object na doc oficial).
async function getModDownload(req, res, next) {
  try {
    const modioGameId = Number(req.params.modioGameId);
    const modioModId = Number(req.params.modioModId);
    const mod = await modio.getMod(modioGameId, modioModId);
    if (!mod.modfile?.id) return res.status(404).json({ error: 'Este mod não tem nenhum arquivo publicado ainda.' });
    const download = await modio.getModfileDownload(modioGameId, modioModId, mod.modfile.id);
    res.json({
      downloadUrl: download.binary_url,
      dateExpires: download.date_expires,
      filename: mod.modfile.filename,
      version: mod.modfile.version,
      filesize: mod.modfile.filesize,
      filehashMd5: mod.modfile.filehash?.md5,
    });
  } catch (err) {
    if (err instanceof modio.ModioNotConfiguredError) return res.status(503).json({ error: err.message });
    next(err);
  }
}

// ---------- Favoritos / Up / Comentários / Denúncias ----------
// Item pedido: "integrar com os sistemas sociais já existentes... não
// criar outro sistema de contas, utilizar as contas atuais do Project
// Club" — por isso tudo abaixo usa req.user.id (a mesma autenticação já
// usada no resto da API), nunca um login separado do mod.io.

async function toggleFavorite(req, res, next) {
  try {
    const modioModId = Number(req.params.modioModId);
    const modioGameId = Number(req.params.modioGameId);
    const existing = await prisma.modFavorite.findUnique({ where: { userId_modioModId: { userId: req.user.id, modioModId } } });
    if (existing) {
      await prisma.modFavorite.delete({ where: { id: existing.id } });
      return res.json({ favorited: false });
    }
    await prisma.modFavorite.create({ data: { userId: req.user.id, modioModId, modioGameId } });
    res.json({ favorited: true });
  } catch (err) { next(err); }
}

async function toggleUp(req, res, next) {
  try {
    const modioModId = Number(req.params.modioModId);
    const modioGameId = Number(req.params.modioGameId);
    const existing = await prisma.modUp.findUnique({ where: { userId_modioModId: { userId: req.user.id, modioModId } } });
    if (existing) {
      await prisma.modUp.delete({ where: { id: existing.id } });
      return res.json({ upped: false });
    }
    await prisma.modUp.create({ data: { userId: req.user.id, modioModId, modioGameId } });
    res.json({ upped: true });
  } catch (err) { next(err); }
}

async function listComments(req, res, next) {
  try {
    const modioModId = Number(req.params.modioModId);
    const comments = await prisma.modComment.findMany({
      where: { modioModId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { id: true, displayName: true, username: true, avatarUrl: true } } },
    });
    res.json({ comments });
  } catch (err) { next(err); }
}

async function addComment(req, res, next) {
  try {
    const modioModId = Number(req.params.modioModId);
    const modioGameId = Number(req.params.modioGameId);
    const content = (req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Escreva algo antes de comentar.' });
    if (content.length > 2000) return res.status(400).json({ error: 'Comentário muito longo (máximo 2000 caracteres).' });
    const comment = await prisma.modComment.create({
      data: { userId: req.user.id, modioModId, modioGameId, content },
      include: { user: { select: { id: true, displayName: true, username: true, avatarUrl: true } } },
    });
    res.status(201).json({ comment });
  } catch (err) { next(err); }
}

async function deleteComment(req, res, next) {
  try {
    const comment = await prisma.modComment.findUnique({ where: { id: req.params.commentId } });
    if (!comment) return res.status(404).json({ error: 'Comentário não encontrado.' });
    if (comment.userId !== req.user.id && req.user.platformRole !== 'ADMIN') return res.status(403).json({ error: 'Sem permissão.' });
    await prisma.modComment.delete({ where: { id: comment.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// Item pedido: "criar sistema de denúncia para mods". Usa Submit Report da
// própria API do mod.io? Não — mantido 100% dentro do Project Club (mesmo
// padrão de Report/AutomodFlag já usado no resto da plataforma), pra cair
// na mesma fila que a staff já usa pra moderar todo o resto.
async function reportMod(req, res, next) {
  try {
    const modioModId = Number(req.params.modioModId);
    const reason = (req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Descreva o motivo da denúncia.' });
    const report = await prisma.modReport.create({ data: { reporterId: req.user.id, modioModId, reason } });
    res.status(201).json({ report });
  } catch (err) { next(err); }
}

// ---------- Painel da staff: mapeamento de jogos + moderação ----------
// Item pedido 5/6: staff cadastra qual AppID da Steam corresponde a qual
// jogo no mod.io — sem isso, um jogo detectado localmente nunca mostra
// suporte a mods (regra "não mostrar qualquer jogo como compatível
// automaticamente").
async function adminListGameMappings(req, res, next) {
  try {
    const mappings = await prisma.modGameMapping.findMany({ orderBy: { displayName: 'asc' } });
    res.json({ mappings });
  } catch (err) { next(err); }
}

async function adminCreateGameMapping(req, res, next) {
  try {
    const { steamAppId, modioGameId, modioNameId, displayName, iconUrl } = req.body;
    if (!steamAppId || !modioGameId || !modioNameId?.trim() || !displayName?.trim()) {
      return res.status(400).json({ error: 'steamAppId, modioGameId, modioNameId e displayName são obrigatórios.' });
    }
    const mapping = await prisma.modGameMapping.create({
      data: { steamAppId: Number(steamAppId), modioGameId: Number(modioGameId), modioNameId: modioNameId.trim(), displayName: displayName.trim(), iconUrl: iconUrl || null },
    });
    res.status(201).json({ mapping });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Já existe um mapeamento pra esse Steam AppID ou jogo do mod.io.' });
    next(err);
  }
}

async function adminUpdateGameMapping(req, res, next) {
  try {
    const { displayName, iconUrl, enabled } = req.body;
    const mapping = await prisma.modGameMapping.update({
      where: { id: req.params.id },
      data: {
        ...(displayName !== undefined ? { displayName: displayName.trim() } : {}),
        ...(iconUrl !== undefined ? { iconUrl } : {}),
        ...(enabled !== undefined ? { enabled: !!enabled } : {}),
      },
    });
    res.json({ mapping });
  } catch (err) { next(err); }
}

async function adminDeleteGameMapping(req, res, next) {
  try {
    await prisma.modGameMapping.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// Item pedido 24: "criar ferramentas para a staff moderar mods quando
// necessário" — fila de denúncias, mesmo padrão de status usado em
// Report/AutomodFlag no resto do painel admin.
async function adminListReports(req, res, next) {
  try {
    const status = req.query.status && req.query.status !== 'ALL' ? req.query.status : undefined;
    const reports = await prisma.modReport.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { reporter: { select: { id: true, displayName: true, username: true } } },
      take: 100,
    });
    res.json({ reports });
  } catch (err) { next(err); }
}

async function adminResolveReport(req, res, next) {
  try {
    const { status } = req.body; // 'ACTIONED' | 'DISMISSED'
    if (!['ACTIONED', 'DISMISSED'].includes(status)) return res.status(400).json({ error: 'status inválido.' });
    const report = await prisma.modReport.update({ where: { id: req.params.id }, data: { status } });
    res.json({ report });
  } catch (err) { next(err); }
}

// ---------- Perfis (item pedido 15) ----------
// "Perfis de mods" — um perfil é um conjunto nomeado de mods (com
// estado ativo/inativo) pra um jogo. A ativação DE VERDADE (mover
// pastas no disco) acontece no app desktop (ver desktop/modsManager.js,
// applyProfileMods) — aqui só fica o registro de QUAIS mods pertencem a
// cada perfil, pra sincronizar entre computadores da mesma conta.
async function listProfiles(req, res, next) {
  try {
    const modioGameId = Number(req.params.modioGameId);
    const profiles = await prisma.modProfile.findMany({
      where: { userId: req.user.id, modioGameId },
      include: { items: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ profiles });
  } catch (err) { next(err); }
}

async function createProfile(req, res, next) {
  try {
    const modioGameId = Number(req.params.modioGameId);
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Dê um nome pro perfil.' });
    const profile = await prisma.modProfile.create({ data: { userId: req.user.id, modioGameId, name }, include: { items: true } });
    res.status(201).json({ profile });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Você já tem um perfil com esse nome pra este jogo.' });
    next(err);
  }
}

async function deleteProfile(req, res, next) {
  try {
    const profile = await prisma.modProfile.findUnique({ where: { id: req.params.profileId } });
    if (!profile || profile.userId !== req.user.id) return res.status(404).json({ error: 'Perfil não encontrado.' });
    await prisma.modProfile.delete({ where: { id: profile.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// Adiciona/atualiza um mod dentro do perfil (upsert pela combinação
// perfil+mod) — chamado tanto ao instalar um mod direto num perfil
// quanto ao ativar/desativar um item já existente nele.
async function upsertProfileItem(req, res, next) {
  try {
    const profile = await prisma.modProfile.findUnique({ where: { id: req.params.profileId } });
    if (!profile || profile.userId !== req.user.id) return res.status(404).json({ error: 'Perfil não encontrado.' });
    const { modioModId, modioModfileId, modName, version, enabled } = req.body;
    const item = await prisma.modProfileItem.upsert({
      where: { profileId_modioModId: { profileId: profile.id, modioModId: Number(modioModId) } },
      update: {
        ...(modioModfileId !== undefined ? { modioModfileId: Number(modioModfileId) } : {}),
        ...(modName !== undefined ? { modName } : {}),
        ...(version !== undefined ? { version } : {}),
        ...(enabled !== undefined ? { enabled: !!enabled } : {}),
      },
      create: { profileId: profile.id, modioModId: Number(modioModId), modioModfileId: modioModfileId ? Number(modioModfileId) : null, modName: modName || null, version: version || null, enabled: enabled !== false },
    });
    res.json({ item });
  } catch (err) { next(err); }
}

async function removeProfileItem(req, res, next) {
  try {
    const profile = await prisma.modProfile.findUnique({ where: { id: req.params.profileId } });
    if (!profile || profile.userId !== req.user.id) return res.status(404).json({ error: 'Perfil não encontrado.' });
    await prisma.modProfileItem.deleteMany({ where: { profileId: profile.id, modioModId: Number(req.params.modioModId) } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = {
  matchSteamGames, getGame, listMods, getGameTags, getMod, getModDownload,
  toggleFavorite, toggleUp, listComments, addComment, deleteComment, reportMod,
  listProfiles, createProfile, deleteProfile, upsertProfileItem, removeProfileItem,
  adminListGameMappings, adminCreateGameMapping, adminUpdateGameMapping, adminDeleteGameMapping,
  adminListReports, adminResolveReport,
};
