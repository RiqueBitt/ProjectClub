import { Capacitor } from '@capacitor/core';
import { registerPushToken } from '../api/endpoints';

// Registro de push notification (item pedido: "push de verdade no
// Android, mesmo com o app fechado") — só roda no Android nativo (a web
// e o desktop já recebem aviso via socket.io + Notification API do
// navegador, ver SocketContext.jsx; não precisam de FCM). Chamado uma
// vez, depois do login, quando já dá pra saber de quem é a conta que vai
// receber os pushes.
export async function setupPushNotifications() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return; // pessoa negou — respeita, não insiste

    // 'registration' dispara quando o Firebase entrega o token deste
    // aparelho — é isso que o servidor usa pra saber "pra onde mandar" a
    // notificação (ver server/src/services/pushNotifications.js).
    PushNotifications.addListener('registration', (token) => {
      registerPushToken(token.value, 'android').catch(() => {});
    });
    PushNotifications.addListener('registrationError', (err) => {
      console.error('[push] Falha ao registrar pro Firebase:', err);
    });

    await PushNotifications.register();
  } catch (err) {
    console.error('[push] Não foi possível configurar notificações push:', err);
  }
}
