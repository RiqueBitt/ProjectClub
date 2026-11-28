/* Service worker do Project Club — notificações push.
 *
 * De propósito NÃO faz cache do app: uma versão antiga deste app já
 * guardou arquivos num service worker e serviu layout velho pra sempre
 * (ver client/src/main.jsx). Rede e arquivos do site continuam 100% com o
 * navegador.
 *
 * O Club Penguin (Praça) foi removido em nov/2026: o jogo ficava "instalado"
 * no Cache Storage (pc-praca, centenas de MB por aparelho). Ao ativar, esta
 * versão apaga esse cache pra liberar o espaço. */
const VERSION = 'pc-sw-11';
const OLD_GAME_CACHES = ['pc-praca'];

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Libera o espaço do jogo removido (pc-praca e qualquer outro da Praça).
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => OLD_GAME_CACHES.includes(k) || k.startsWith('pc-praca')).map((k) => caches.delete(k)));
    } catch { /* sem Cache Storage */ }
    await self.clients.claim();
  })());
});

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
