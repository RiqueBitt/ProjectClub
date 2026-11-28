// Web Push (navegador/PWA) — complementa o FCM do Android (pushNotifications.js).
//
// Funciona em Chrome, Edge, Firefox, Samsung Internet e Safari 16+ (iOS só
// com o site instalado na tela inicial). Não precisa de Firebase nem de
// nenhuma conta externa: o padrão Web Push usa um par de chaves VAPID que
// a gente mesmo gera. As chaves ficam no banco (WebPushKeys) pra
// sobreviverem a reinícios/deploys — trocar a chave invalidaria todas as
// assinaturas. Se o ambiente definir VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY,
// elas têm prioridade.
//
// Igual ao FCM, tudo aqui é "extra": qualquer falha vira no-op e nunca
// derruba o envio da mensagem/aviso em si.
const prisma = require('../config/prisma');

let webpush = null;
try { webpush = require('web-push'); } catch { webpush = null; }

let keysPromise = null;
const SUBJECT = () => process.env.VAPID_SUBJECT || `mailto:${process.env.SUPPORT_EMAIL || 'contato@projectclub.app'}`;

async function loadKeys() {
  if (!webpush) return null;
  if (keysPromise) return keysPromise;
  keysPromise = (async () => {
    const envPub = process.env.VAPID_PUBLIC_KEY;
    const envPriv = process.env.VAPID_PRIVATE_KEY;
    if (envPub && envPriv) return { publicKey: envPub, privateKey: envPriv, source: 'env' };
    try {
      const row = await prisma.webPushKeys.findUnique({ where: { id: 'singleton' } });
      if (row) return { publicKey: row.publicKey, privateKey: row.privateKey, source: 'db' };
      const generated = webpush.generateVAPIDKeys();
      // Duas instâncias subindo juntas: a 2ª perde a corrida e lê a da 1ª.
      try {
        await prisma.webPushKeys.create({ data: { id: 'singleton', publicKey: generated.publicKey, privateKey: generated.privateKey } });
        console.log('[webpush] chaves VAPID geradas e guardadas no banco.');
        return { ...generated, source: 'generated' };
      } catch {
        const again = await prisma.webPushKeys.findUnique({ where: { id: 'singleton' } });
        return again ? { publicKey: again.publicKey, privateKey: again.privateKey, source: 'db' } : null;
      }
    } catch (err) {
      console.error('[webpush] não foi possível carregar/gerar as chaves VAPID:', err.message);
      keysPromise = null;
      return null;
    }
  })();
  return keysPromise;
}

async function getPublicKey() {
  const keys = await loadKeys();
  return keys ? keys.publicKey : null;
}

function isValidSubscription(sub) {
  return !!(sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length <= 500
    && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string'
    && sub.keys.p256dh.length <= 255 && sub.keys.auth.length <= 64);
}

async function saveSubscription(userId, sub, userAgent) {
  if (!isValidSubscription(sub)) { const e = new Error('Assinatura de push inválida.'); e.status = 400; throw e; }
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, 255) : null;
  const data = { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: ua, lastUsedAt: new Date() };
  // O mesmo aparelho vindo de OUTRA conta passa a ser desta (só recebe push
  // de quem está logado nele agora) — igual ao PushToken do Android.
  try {
    await prisma.webPushSubscription.upsert({ where: { endpoint: sub.endpoint }, update: data, create: { endpoint: sub.endpoint, ...data } });
  } catch {
    await prisma.webPushSubscription.updateMany({ where: { endpoint: sub.endpoint }, data });
  }
}

async function removeSubscription(userId, endpoint) {
  if (typeof endpoint !== 'string' || !endpoint) return;
  await prisma.webPushSubscription.deleteMany({ where: { endpoint, userId } });
}

// Manda pra TODOS os navegadores que essa pessoa assinou. O service worker
// (client/public/sw.js) decide se mostra: se o site estiver aberto e
// visível, não mostra (o app já avisa por dentro).
async function sendWebPushToUser(userId, { title, body, data } = {}) {
  if (!webpush) return;
  const keys = await loadKeys();
  if (!keys) return;
  const subs = await prisma.webPushSubscription.findMany({ where: { userId }, select: { id: true, endpoint: true, p256dh: true, auth: true } });
  if (!subs.length) return;
  const payload = JSON.stringify({
    title: String(title || 'Project Club').slice(0, 120),
    body: String(body || '').slice(0, 400),
    link: (data && data.link) || '/',
    tag: (data && data.tag) || undefined,
    sentAt: Date.now(),
  });
  const options = { vapidDetails: { subject: SUBJECT(), publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 60 * 60 * 24, urgency: 'high' };
  const dead = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options);
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410 || code === 403) dead.push(s.id);
      else console.error('[webpush] falha ao enviar:', code || err.message);
    }
  }));
  if (dead.length) await prisma.webPushSubscription.deleteMany({ where: { id: { in: dead } } }).catch(() => {});
}

module.exports = { getPublicKey, saveSubscription, removeSubscription, sendWebPushToUser, isValidSubscription, _loadKeys: loadKeys };
