/* Service worker do Project Club — notificações push + arquivos do Club Penguin.
 *
 * De propósito NÃO faz cache do app: uma versão antiga deste app já
 * guardou arquivos num service worker e serviu layout velho pra sempre
 * (ver client/src/main.jsx). Rede e arquivos do site continuam 100% com o
 * navegador. A única exceção são os arquivos do JOGO da Praça (/play/…,
 * /playstart/…): a página "instala" o jogo completo no Cache Storage
 * (pc-praca) e aqui eles são servidos de lá — o jogo roda inteiro do
 * navegador, sem baixar nada de novo. Esses arquivos têm versão na URL, e o
 * que não estiver no cache vai pra rede e entra no cache ao passar. */
const VERSION = 'pc-sw-7';
const GAME_CACHE = 'pc-praca';
// Consertados/traduzidos no servidor: a interface (server/waddle/.../swf-patches.ts)
// e o jornal (server/src/services/waddle/news — traduzido aos poucos pela IA)
const FRESH = [
  /\/play\/v2\/content\/global\/content\/interface\.swf$/,
  /\/play\/v2\/client\/(shell|catalog_viewer|igloo)\.swf$/,
  /\/play\/v2\/content\/local\/[a-z]{2}\/news\//,
];
const isGameUrl = (url) => url.origin === self.location.origin && (url.pathname.startsWith('/play/') || url.pathname.startsWith('/playstart/'));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (!isGameUrl(url)) return; // todo o resto: navegador normal
  event.respondWith((async () => {
    const cache = await caches.open(GAME_CACHE);
    // Arquivos que o servidor CONSERTA (mesma URL, conteúdo novo): sempre da
    // rede (o guardado pode ser o antigo); sem internet, usa o guardado.
    if (FRESH.some((re) => re.test(url.pathname))) {
      try {
        // a CDN guardou cópias antigas destas URLs: pede sempre com ?pcf=
        // (a página já manda o da versão do servidor; senão, o do worker)
        const fresh = new URL(req.url);
        if (!fresh.searchParams.has('pcf')) fresh.searchParams.set('pcf', VERSION);
        const res = await fetch(fresh.href, { cache: 'no-cache', credentials: 'same-origin' });
        if (res.ok) { cache.put(req.url, res.clone()).catch(() => {}); return res; }
      } catch { /* sem rede */ }
      const old = await cache.match(req.url);
      if (old) return old;
      return fetch(req);
    }
    const hit = await cache.match(req.url);
    if (hit) return hit;
    const res = await fetch(req);
    // só mídia versionada entra no cache (os gerados vêm como no-cache)
    try {
      const cc = res.headers.get('Cache-Control') || '';
      if (res.ok && /immutable/.test(cc)) cache.put(req.url, res.clone()).catch(() => {});
    } catch { /* ok */ }
    return res;
  })());
});

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
