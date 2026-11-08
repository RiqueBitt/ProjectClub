const prisma = require('../config/prisma');
const { safeUpsert } = require('../utils/prismaSafe');

// Registra/atualiza o token de push (FCM) do dispositivo atual pra essa
// conta — chamado pelo app Android assim que ele consegue um token do
// Firebase (ver client/src/utils/pushNotifications.js). Uma pessoa pode
// ter vários tokens (vários aparelhos) ao mesmo tempo, todos recebem.
async function registerToken(req, res, next) {
  try {
    const { platform } = req.body;
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    if (!token) return res.status(400).json({ error: 'Token obrigatório.' });
    if (token.length > 191) return res.status(400).json({ error: 'Token inválido.' });

    // BUG CORRIGIDO (500 "Unique constraint failed on PushToken_token_key"):
    // o app manda o registro mais de uma vez quase ao mesmo tempo (abrir +
    // renovar token do Firebase), e no MySQL o upsert do Prisma não é
    // atômico — a 2ª requisição perdia a corrida. safeUpsert cai pro
    // update quando isso acontece. O mesmo token vindo de OUTRA conta
    // (trocou de conta no aparelho) passa a ser desta conta: o aparelho
    // só deve receber push de quem está logado nele agora.
    const plat = typeof platform === 'string' && platform.trim() ? platform.trim().slice(0, 32) : 'android';
    await safeUpsert(prisma.pushToken, {
      where: { token },
      update: { userId: req.user.id, platform: plat, lastUsedAt: new Date() },
      create: { userId: req.user.id, token, platform: plat },
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

// ---- Web Push (navegador/PWA) ----
const webPush = require('../services/webPush');

// Chave pública VAPID: o navegador precisa dela pra criar a assinatura.
// Pública mesmo — não é segredo.
async function webPublicKey(req, res, next) {
  try {
    const key = await webPush.getPublicKey();
    if (!key) return res.json({ enabled: false, publicKey: null });
    res.json({ enabled: true, publicKey: key });
  } catch (err) { next(err); }
}

async function webSubscribe(req, res, next) {
  try {
    const sub = req.body && req.body.subscription;
    await webPush.saveSubscription(req.user.id, sub, req.headers['user-agent']);
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function webUnsubscribe(req, res, next) {
  try {
    await webPush.removeSubscription(req.user.id, req.body && req.body.endpoint);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { registerToken, unregisterToken, webPublicKey, webSubscribe, webUnsubscribe };
