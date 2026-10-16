// Service worker de push (public/sw.js) rodando num "self" falso:
// - push com aba visível → NÃO mostra (o app já avisa por dentro)
// - push sem aba visível → mostra com título/corpo/link
// - clique → foca a aba aberta e manda navegar; sem aba → abre janela
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function boot({ clients = [] } = {}) {
  const handlers = {};
  const shown = []; const opened = []; const focused = []; const posted = [];
  const self = {
    addEventListener: (n, fn) => { handlers[n] = fn; },
    skipWaiting: () => {},
    location: { origin: 'https://club.example' },
    clients: {
      claim: async () => {},
      matchAll: async () => clients.map((c) => ({ ...c, focus: async () => focused.push(c.url), postMessage: (m) => posted.push(m) })),
      openWindow: async (u) => opened.push(u),
    },
    registration: { showNotification: async (title, opts) => shown.push({ title, opts }) },
  };
  const ctx = { self, URL, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'), ctx);
  return { handlers, shown, opened, focused, posted };
}
const pushEvent = (payload) => { let p; const ev = { data: { json: () => payload, text: () => JSON.stringify(payload) }, waitUntil: (x) => { p = x; } }; return { ev, done: () => p }; };

test('não mostra push quando uma aba do app está visível', async () => {
  const sw = boot({ clients: [{ url: 'https://club.example/', visibilityState: 'visible', focused: true }] });
  const { ev, done } = pushEvent({ title: 'Ana', body: 'oi' });
  sw.handlers.push(ev); await done();
  assert.equal(sw.shown.length, 0);
});

test('mostra push (título, corpo, link) quando o app está fechado/escondido', async () => {
  const sw = boot({ clients: [{ url: 'https://club.example/', visibilityState: 'hidden' }] });
  const { ev, done } = pushEvent({ title: 'Ana', body: 'oi', link: '/conversations/1', tag: 'dm:1' });
  sw.handlers.push(ev); await done();
  assert.equal(sw.shown.length, 1);
  assert.equal(sw.shown[0].title, 'Ana');
  assert.equal(sw.shown[0].opts.body, 'oi');
  assert.equal(sw.shown[0].opts.data.link, '/conversations/1');
  assert.equal(sw.shown[0].opts.tag, 'dm:1');
  assert.equal(sw.shown[0].opts.icon, '/icon-192.png');
});

test('link externo/inválido vira "/"', async () => {
  const sw = boot();
  const { ev, done } = pushEvent({ title: 'x', link: 'https://evil.example/phish' });
  sw.handlers.push(ev); await done();
  assert.equal(sw.shown[0].opts.data.link, '/');
});

test('clique: foca a aba aberta e pede pra navegar; sem aba, abre janela', async () => {
  const sw = boot({ clients: [{ url: 'https://club.example/dms', visibilityState: 'hidden' }] });
  let p; const ev = { notification: { close: () => {}, data: { link: '/conversations/9' } }, waitUntil: (x) => { p = x; } };
  sw.handlers.notificationclick(ev); await p;
  assert.deepEqual(sw.focused, ['https://club.example/dms']);
  assert.equal(JSON.stringify(sw.posted), JSON.stringify([{ type: 'pc:navigate', link: '/conversations/9' }]));
  assert.equal(sw.opened.length, 0);

  const sw2 = boot();
  let p2; const ev2 = { notification: { close: () => {}, data: { link: '/notifications' } }, waitUntil: (x) => { p2 = x; } };
  sw2.handlers.notificationclick(ev2); await p2;
  assert.deepEqual(sw2.opened, ['https://club.example/notifications']);
});
