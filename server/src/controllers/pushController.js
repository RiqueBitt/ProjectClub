const prisma = require('../config/prisma');

// Registra/atualiza o token de push (FCM) do dispositivo atual pra essa
// conta — chamado pelo app Android assim que ele consegue um token do
// Firebase (ver client/src/utils/pushNotifications.js). Uma pessoa pode
// ter vários tokens (vários aparelhos) ao mesmo tempo, todos recebem.
async function registerToken(req, res, next) {
  try {
    const { token, platform } = req.body;
    if (!token?.trim()) return res.status(400).json({ error: 'Token obrigatório.' });

    await prisma.pushToken.upsert({
      where: { token },
      update: { userId: req.user.id, lastUsedAt: new Date() },
      create: { userId: req.user.id, token, platform: platform || 'android' },
    });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
}

// Chamado no logout — não faz sentido continuar mandando push pra um
// aparelho onde a pessoa saiu da conta.
async function unregisterToken(req, res, next) {
  try {
    const { token } = req.body;
    if (!token?.trim()) return res.status(400).json({ error: 'Token obrigatório.' });
    await prisma.pushToken.deleteMany({ where: { token, userId: req.user.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { registerToken, unregisterToken };
