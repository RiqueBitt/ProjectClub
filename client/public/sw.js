/* Service worker do Project Club — SÓ notificações push.
 *
 * De propósito NÃO faz cache de nada: uma versão antiga deste app já
 * guardou arquivos num service worker e serviu layout velho pra sempre
 * (ver client/src/main.jsx). Aqui o único trabalho é receber push do
 * servidor (Web Push/VAPID) e mostrar/abrir a notificação. Rede e
 * arquivos continuam 100% com o navegador. */
const VERSION = 'pc-sw-2';

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

// Alguma aba/janela do app está aberta E visível? Aí o app já avisa por
// dentro (toast/som) — mostrar push em cima seria duplicado.
async function hasVisibleClient() {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return list.some((c) => c.visibilityState === 'visible' && c.focused !== false);
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Project Club', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Project Club';
  const link = typeof data.link === 'string' && data.link.startsWith('/') ? data.link : '/';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || link,
    renotify: !!data.tag,
    timestamp: data.sentAt || Date.now(),
    data: { link },
  };
  event.waitUntil((async () => {
    if (await hasVisibleClient()) return;
    await self.registration.showNotification(title, options);
  })());
});

// Clique: foca uma janela do app já aberta (e navega nela) ou abre uma nova.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  const url = new URL(link, self.location.origin).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = list.find((c) => c.url && new URL(c.url).origin === self.location.origin);
    if (same) {
      try { await same.focus(); } catch { /* ok */ }
      try { same.postMessage({ type: 'pc:navigate', link }); } catch { /* ok */ }
      return;
    }
    await self.clients.openWindow(url);
  })());
});

// Assinatura renovada pelo navegador: a página reassina na próxima abertura
// (utils/webPush.js roda a cada login); aqui só avisamos as abas abertas.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) { try { c.postMessage({ type: 'pc:push-resubscribe' }); } catch { /* ok */ } }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'pc:version') event.source?.postMessage?.({ type: 'pc:version', version: VERSION });
});
