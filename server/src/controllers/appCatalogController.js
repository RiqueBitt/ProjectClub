const prisma = require('../config/prisma');

function logPlatformAction(req, { action, targetType, targetId, reason, metadata }) {
  return prisma.platformAuditLog.create({
    data: {
      actorId: req.user.id, action, targetType, targetId, reason,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });
}

// Item pedido: "melhore também essa aba de apps, adicione ícone,
// banner melhorando a interface tudo sendo configurado do painel da
// staff" — catálogo de apps/jogos (banner grande da tela de detalhe
// estilo Steam, ícone pequeno do card da lista, texto de "espaço
// necessário") gerenciado pela staff, sem precisar de deploy novo.
// Mesmo padrão de "criar, depois decorar com imagem" que announcements/
// badges já usam — não tem id pra fazer upload contra até a linha
// existir de verdade.

// GET /app-catalog — pública, só os itens habilitados, na ordem
// configurada pela staff. Usada pela aba Apps de todo mundo.
async function listPublicAppCatalog(req, res, next) {
  try {
    const items = await prisma.appCatalogItem.findMany({
      where: { enabled: true },
      orderBy: { order: 'asc' },
      select: {
        moduleId: true, name: true, description: true, bannerUrl: true, iconUrl: true, sizeLabel: true,
        version: true, sizeLabelWin: true, sizeLabelLinux: true, requirementsWin: true, requirementsLinux: true,
        featuresText: true,
        screenshots: { orderBy: { order: 'asc' }, select: { id: true, imageUrl: true } },
      },
    });
    res.json({ items });
  } catch (err) { next(err); }
}

// GET /admin/app-catalog — todos os itens, habilitados ou não, pro
// painel da staff conseguir editar/reativar qualquer um.
async function listAdminAppCatalog(req, res, next) {
  try {
    const items = await prisma.appCatalogItem.findMany({
      orderBy: { order: 'asc' },
      include: { screenshots: { orderBy: { order: 'asc' } } },
    });
    res.json({ items });
  } catch (err) { next(err); }
}

async function createAppCatalogItem(req, res, next) {
  try {
    const { moduleId, name, description, sizeLabel, order } = req.body;
    if (!moduleId?.trim() || !name?.trim()) return res.status(400).json({ error: 'moduleId e nome são obrigatórios.' });
    const normalizedModuleId = String(moduleId).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!normalizedModuleId) return res.status(400).json({ error: 'moduleId inválido.' });

    const existing = await prisma.appCatalogItem.findUnique({ where: { moduleId: normalizedModuleId } });
    if (existing) return res.status(409).json({ error: 'Já existe um item de catálogo com esse moduleId.' });

    const parsedOrder = order !== undefined && order !== null && order !== '' ? parseInt(order, 10) : 0;
    const item = await prisma.appCatalogItem.create({
      data: {
        moduleId: normalizedModuleId,
        name: name.trim().slice(0, 80),
        description: description?.trim().slice(0, 500) || null,
        sizeLabel: sizeLabel?.trim().slice(0, 40) || null,
        order: Number.isFinite(parsedOrder) ? parsedOrder : 0,
      },
    });
    await logPlatformAction(req, { action: 'APP_CATALOG_CREATE', targetType: 'APP_CATALOG', targetId: item.id, metadata: { moduleId: item.moduleId } });
    res.status(201).json({ item });
  } catch (err) { next(err); }
}

async function updateAppCatalogItem(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.appCatalogItem.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Item de catálogo não encontrado.' });

    const data = {};
    if (req.body.name !== undefined) data.name = String(req.body.name).trim().slice(0, 80);
    if (req.body.description !== undefined) data.description = req.body.description?.trim().slice(0, 500) || null;
    if (req.body.sizeLabel !== undefined) data.sizeLabel = req.body.sizeLabel?.trim().slice(0, 40) || null;
    // Item pedido: "adicione mais informações... versão, tamanho,
    // requisitos... separe claramente os downloads para Windows e
    // Linux" — mesmo padrão de validação dos campos já existentes.
    if (req.body.version !== undefined) data.version = req.body.version?.trim().slice(0, 40) || null;
    if (req.body.sizeLabelWin !== undefined) data.sizeLabelWin = req.body.sizeLabelWin?.trim().slice(0, 40) || null;
    if (req.body.sizeLabelLinux !== undefined) data.sizeLabelLinux = req.body.sizeLabelLinux?.trim().slice(0, 40) || null;
    if (req.body.requirementsWin !== undefined) data.requirementsWin = req.body.requirementsWin?.trim().slice(0, 1000) || null;
    if (req.body.requirementsLinux !== undefined) data.requirementsLinux = req.body.requirementsLinux?.trim().slice(0, 1000) || null;
    if (req.body.featuresText !== undefined) data.featuresText = req.body.featuresText?.trim().slice(0, 2000) || null;
    if (req.body.enabled !== undefined) data.enabled = !!req.body.enabled;
    if (req.body.order !== undefined) {
      const parsed = parseInt(req.body.order, 10);
      data.order = Number.isFinite(parsed) ? parsed : 0;
    }
    // Explicit null limpa uma imagem já enviada antes (ver
    // uploadAppCatalogBanner/Icon abaixo pra definir uma nova).
    if (req.body.bannerUrl === null) data.bannerUrl = null;
    if (req.body.iconUrl === null) data.iconUrl = null;

    const item = await prisma.appCatalogItem.update({ where: { id }, data });
    await logPlatformAction(req, { action: 'APP_CATALOG_UPDATE', targetType: 'APP_CATALOG', targetId: id, metadata: data });
    res.json({ item });
  } catch (err) {
    // Item pedido: "só a descrição do DaVinci Project dá erro ao
    // salvar" — causa real já corrigida (schema.prisma, campo
    // description sem @db.Text), mas isso fica como rede de segurança
    // geral: se algum campo de texto livre um dia passar do limite
    // real da coluna no banco, a pessoa vê uma mensagem clara em vez
    // de um erro 500 genérico e sem explicação nenhuma.
    if (err.code === 'P2000') return res.status(400).json({ error: 'Um dos campos está grande demais pro banco aceitar — encurte o texto e tente de novo.' });
    next(err);
  }
}

async function uploadAppCatalogBanner(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const existing = await prisma.appCatalogItem.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Item de catálogo não encontrado.' });
    const bannerUrl = req.file.url;
    const item = await prisma.appCatalogItem.update({ where: { id }, data: { bannerUrl } });
    await logPlatformAction(req, { action: 'APP_CATALOG_UPDATE', targetType: 'APP_CATALOG', targetId: id, metadata: { bannerUrl } });
    res.json({ item });
  } catch (err) { next(err); }
}

async function uploadAppCatalogIcon(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const existing = await prisma.appCatalogItem.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Item de catálogo não encontrado.' });
    const iconUrl = req.file.url;
    const item = await prisma.appCatalogItem.update({ where: { id }, data: { iconUrl } });
    await logPlatformAction(req, { action: 'APP_CATALOG_UPDATE', targetType: 'APP_CATALOG', targetId: id, metadata: { iconUrl } });
    res.json({ item });
  } catch (err) { next(err); }
}

async function deleteAppCatalogItem(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.appCatalogItem.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Item de catálogo não encontrado.' });
    await prisma.appCatalogItem.delete({ where: { id } });
    await logPlatformAction(req, { action: 'APP_CATALOG_DELETE', targetType: 'APP_CATALOG', targetId: id, metadata: { moduleId: existing.moduleId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Item pedido: "as screenshots de todos os aplicativos devem poder
// ser adicionadas, removidas e editadas pelo painel da staff, sem
// precisar alterar o código" — mesmo padrão de upload de banner/ícone
// acima, só que N por item em vez de 1.
async function addAppScreenshot(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const existing = await prisma.appCatalogItem.findUnique({ where: { id }, include: { screenshots: true } });
    if (!existing) return res.status(404).json({ error: 'Item de catálogo não encontrado.' });
    const nextOrder = existing.screenshots.reduce((max, s) => Math.max(max, s.order), -1) + 1;
    const screenshot = await prisma.appScreenshot.create({
      data: { appCatalogItemId: id, imageUrl: req.file.url, order: nextOrder },
    });
    await logPlatformAction(req, { action: 'APP_CATALOG_UPDATE', targetType: 'APP_CATALOG', targetId: id, metadata: { addedScreenshot: screenshot.id } });
    res.status(201).json({ screenshot });
  } catch (err) { next(err); }
}

async function deleteAppScreenshot(req, res, next) {
  try {
    const { screenshotId } = req.params;
    const existing = await prisma.appScreenshot.findUnique({ where: { id: screenshotId } });
    if (!existing) return res.status(404).json({ error: 'Screenshot não encontrada.' });
    await prisma.appScreenshot.delete({ where: { id: screenshotId } });
    await logPlatformAction(req, { action: 'APP_CATALOG_UPDATE', targetType: 'APP_CATALOG', targetId: existing.appCatalogItemId, metadata: { removedScreenshot: screenshotId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Reordena arrastando — recebe a lista completa de ids na ordem nova
// (mais simples e confiável do que calcular deltas: a staff manda
// exatamente a ordem que já está vendo na tela).
async function reorderAppScreenshots(req, res, next) {
  try {
    const { id } = req.params;
    const { screenshotIds } = req.body;
    if (!Array.isArray(screenshotIds)) return res.status(400).json({ error: 'screenshotIds precisa ser uma lista.' });
    await prisma.$transaction(
      screenshotIds.map((screenshotId, index) =>
        prisma.appScreenshot.updateMany({ where: { id: screenshotId, appCatalogItemId: id }, data: { order: index } })),
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  listPublicAppCatalog, listAdminAppCatalog,
  createAppCatalogItem, updateAppCatalogItem, deleteAppCatalogItem,
  uploadAppCatalogBanner, uploadAppCatalogIcon,
  addAppScreenshot, deleteAppScreenshot, reorderAppScreenshots,
};
