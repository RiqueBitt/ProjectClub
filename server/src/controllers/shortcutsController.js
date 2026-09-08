const prisma = require('../config/prisma');

// Item pedido: "Atalhos personalizados... UserShortcut... action,
// keyCombination... Antes de salvar: verificar se já existe outro
// comando usando a combinação. Se houver conflito: 'Este atalho já
// está sendo utilizado.'" — a checagem em si já é garantida pelo
// próprio banco (@@unique([userId, keyCombination]) no schema), mas
// aqui a violação dessa constraint é traduzida pra essa mensagem
// amigável em vez de vazar um erro cru do Prisma pro frontend.
async function listMyShortcuts(req, res, next) {
  try {
    const shortcuts = await prisma.userShortcut.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ shortcuts });
  } catch (err) { next(err); }
}

async function setShortcut(req, res, next) {
  try {
    const { action, keyCombination } = req.body || {};
    if (!action || typeof action !== 'string' || !action.trim()) {
      return res.status(400).json({ error: 'action é obrigatório.' });
    }
    if (!keyCombination || typeof keyCombination !== 'string' || !keyCombination.trim()) {
      return res.status(400).json({ error: 'keyCombination é obrigatório.' });
    }
    const cleanAction = action.trim().slice(0, 64);
    const cleanCombo = keyCombination.trim().slice(0, 32);

    // Item pedido: "verificar se já existe outro comando usando a
    // combinação" — checado explicitamente ANTES do upsert (em vez de
    // só confiar no erro da constraint) porque o upsert abaixo é por
    // [userId, action] (permite REATRIBUIR a combinação de uma ação já
    // configurada), e essa checagem por combinação precisa ignorar a
    // própria linha da ação que está sendo editada.
    const conflict = await prisma.userShortcut.findFirst({
      where: { userId: req.user.id, keyCombination: cleanCombo, action: { not: cleanAction } },
    });
    if (conflict) {
      return res.status(400).json({ error: 'Este atalho já está sendo utilizado.' });
    }

    const shortcut = await prisma.userShortcut.upsert({
      where: { userId_action: { userId: req.user.id, action: cleanAction } },
      update: { keyCombination: cleanCombo },
      create: { userId: req.user.id, action: cleanAction, keyCombination: cleanCombo },
    });
    res.json({ shortcut });
  } catch (err) { next(err); }
}

async function deleteShortcut(req, res, next) {
  try {
    const { id } = req.params;
    const result = await prisma.userShortcut.deleteMany({ where: { id, userId: req.user.id } });
    if (result.count === 0) {
      return res.status(404).json({ error: 'Atalho não encontrado.' });
    }
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = { listMyShortcuts, setShortcut, deleteShortcut };
