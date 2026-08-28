const prisma = require('../config/prisma');

// Envio de push notification (Firebase Cloud Messaging) — item pedido:
// "push notification de verdade no Android, mesmo com o app fechado".
// Só funciona de verdade depois que a conta Firebase estiver configurada
// (ver README_PUSH.md na raiz do projeto pro passo a passo) — até lá,
// toda chamada aqui vira um no-op silencioso, sem quebrar nada do resto
// do app. Isso é DE PROPÓSITO: notificação push é um "extra", nunca deve
// derrubar o envio de mensagem em si se o Firebase estiver mal
// configurado ou fora do ar.
let firebaseApp = null;
let firebaseInitTried = false;

function getFirebaseApp() {
  if (firebaseApp || firebaseInitTried) return firebaseApp;
  firebaseInitTried = true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    // eslint-disable-next-line global-require
    const admin = require('firebase-admin');
    const serviceAccount = JSON.parse(raw);
    firebaseApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log('[push] Firebase configurado — notificações push do Android ativas.');
  } catch (err) {
    console.error('[push] FIREBASE_SERVICE_ACCOUNT_JSON inválido — push notification do Android desativado:', err.message);
    firebaseApp = null;
  }
  return firebaseApp;
}

// Manda uma notificação push pra TODOS os dispositivos Android que essa
// pessoa já registrou (pode ter mais de um). Limpa sozinho qualquer
// token que o Google reportar como inválido/desinstalado — sem isso, a
// tabela PushToken só cresceria pra sempre com lixo de gente que já
// desinstalou o app.
async function sendPushToUser(userId, { title, body, data } = {}) {
  const app = getFirebaseApp();
  if (!app) return;

  const tokens = await prisma.pushToken.findMany({ where: { userId }, select: { id: true, token: true } });
  if (tokens.length === 0) return;

  // eslint-disable-next-line global-require
  const admin = require('firebase-admin');
  const message = {
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
    tokens: tokens.map((t) => t.token),
  };

  try {
    const result = await admin.messaging().sendEachForMulticast(message);
    const invalidIds = [];
    result.responses.forEach((r, i) => {
      if (!r.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(r.error?.code)) {
        invalidIds.push(tokens[i].id);
      }
    });
    if (invalidIds.length > 0) {
      await prisma.pushToken.deleteMany({ where: { id: { in: invalidIds } } });
    }
  } catch (err) {
    console.error('[push] Falha ao enviar notificação push:', err.message);
  }
}

module.exports = { sendPushToUser, getFirebaseApp };
