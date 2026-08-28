const prisma = require('../config/prisma');
const env = require('../config/env');

// Chamado pelo GitHub Actions (não por login de usuário nenhum) toda vez
// que uma nova versão do app (Windows/Linux/Android) termina de ser
// publicada — cria automaticamente uma "Atualização" (mesmo sistema que
// a staff já usa pra postar novidades manualmente) contando o que mudou,
// e emite em tempo real pra quem estiver com o site aberto. Autenticado
// por um segredo compartilhado (CI_UPDATE_SECRET) guardado como Secret
// do GitHub — nunca por token de usuário, já que a CI não "é" ninguém.
async function publishRelease(req, res, next) {
  try {
    if (!env.CI_UPDATE_SECRET || req.headers['x-ci-secret'] !== env.CI_UPDATE_SECRET) {
      return res.status(403).json({ error: 'Segredo inválido.' });
    }
    const { version, notes } = req.body;
    if (!version?.trim()) return res.status(400).json({ error: 'Versão obrigatória.' });

    // A "Atualização" precisa de um autor (User) — não existe usuário
    // "sistema" separado, então usa o primeiro ADMIN da plataforma como
    // autor visível (mesma pessoa que apareceria se um admin tivesse
    // postado manualmente). Se não existir nenhum admin ainda (site
    // recém-instalado), pula a criação da Atualização sem quebrar o
    // resto da publicação — o version.json já é suficiente pro app
    // detectar a versão nova sozinho.
    const admin = await prisma.user.findFirst({ where: { platformRole: 'ADMIN' } });
    let entry = null;
    if (admin) {
      entry = await prisma.updateLogEntry.create({
        data: {
          title: `Nova versão disponível — ${version}`,
          description: notes?.trim().slice(0, 5000) || 'Correções e melhorias no aplicativo (Windows, Linux e Android).',
          createdById: admin.id,
        },
        include: { createdBy: { select: { id: true, displayName: true, avatarUrl: true, profileColor: true } } },
      });
      req.app.get('io')?.to('community').emit('update:new', entry);
    }

    res.status(201).json({ ok: true, update: entry });
  } catch (err) { next(err); }
}

module.exports = { publishRelease };
