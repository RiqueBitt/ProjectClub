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
      select: { moduleId: true, name: true, description: true, bannerUrl: true, iconUrl: true, sizeLabel: true },
    });
    res.json({ items });
  } catch (err) { next(err); }
}

// GET /admin/app-catalog — todos os itens, habilitados ou não, pro
// painel da staff conseguir editar/reativar qualquer um.
async function listAdminAppCatalog(req, res, next) {
  try {
    const items = await prisma.appCatalogItem.findMany({ orderBy: { order: 'asc' } });
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
  } catch (err) { next(err); }
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

module.exports = {
  listPublicAppCatalog, listAdminAppCatalog,
  createAppCatalogItem, updateAppCatalogItem, deleteAppCatalogItem,
  uploadAppCatalogBanner, uploadAppCatalogIcon,
};
