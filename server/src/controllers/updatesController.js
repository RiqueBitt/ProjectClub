const prisma = require('../config/prisma');

const AUTHOR_FIELDS = { id: true, displayName: true, avatarUrl: true, profileColor: true };
const isStaff = (user) => ['ADMIN', 'MODERATOR'].includes(user.platformRole);

async function listUpdates(req, res, next) {
  try {
    const updates = await prisma.updateLogEntry.findMany({
      include: { createdBy: { select: AUTHOR_FIELDS } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ updates });
  } catch (err) { next(err); }
}

async function createUpdate(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode publicar atualizações.' });
    const { title, description, version } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Escreva um título.' });
    if (!description?.trim()) return res.status(400).json({ error: 'Escreva uma descrição.' });

    const entry = await prisma.updateLogEntry.create({
      data: {
        title: title.trim().slice(0, 150), description: description.trim().slice(0, 5000),
        version: version?.trim().slice(0, 30) || null, createdById: req.user.id,
      },
      include: { createdBy: { select: AUTHOR_FIELDS } },
    });
    req.app.get('io')?.to('community').emit('update:new', entry);
    res.status(201).json({ update: entry });
  } catch (err) { next(err); }
}

// Item pedido: "fazer eu poder editar elas" — mesmo padrão de
// updateEvent (eventsController.js), único campo enviado é o único
// alterado.
async function updateUpdate(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode editar atualizações.' });
    const { id } = req.params;
    const { title, description, version } = req.body;

    const data = {};
    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ error: 'Escreva um título.' });
      data.title = title.trim().slice(0, 150);
    }
    if (description !== undefined) {
      if (!description.trim()) return res.status(400).json({ error: 'Escreva uma descrição.' });
      data.description = description.trim().slice(0, 5000);
    }
    if (version !== undefined) data.version = version?.trim().slice(0, 30) || null;

    const entry = await prisma.updateLogEntry.update({
      where: { id }, data, include: { createdBy: { select: AUTHOR_FIELDS } },
    });
    req.app.get('io')?.to('community').emit('update:edit', entry);
    res.json({ update: entry });
  } catch (err) { next(err); }
}

async function deleteUpdate(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode excluir atualizações.' });
    const { id } = req.params;
    await prisma.updateLogEntry.delete({ where: { id } });
    req.app.get('io')?.to('community').emit('update:delete', { id });
    res.json({ deleted: true });
  } catch (err) { next(err); }
}

module.exports = { listUpdates, createUpdate, updateUpdate, deleteUpdate };
