import { test } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Foto do app de verdade pra vitrine do site (public/apps/projectclub/shots).
// Usa o app real com uma conversa de exemplo (sem imagem nem banner de teste).
test.skip(!process.env.APP_SHOT, 'só com APP_SHOT');

const now = Date.now();
const av = (a, b) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/></svg>`)}`;
const P = (id, name, a, b, extra = {}) => ({ id, username: name.toLowerCase(), displayName: name, avatarUrl: av(a, b), status: 'ONLINE', ...extra });
const rique = P('1', 'RiqueBitt', '#c0392b', '#2c0a0a', { role: 'ADMIN' });
const lia = P('5', 'Lia', '#4c9fff', '#7b5cff');
const kaio = P('6', 'Kaio', '#23a55a', '#0f5c32');
const nina = P('7', 'Nina', '#f39c12', '#8e44ad');
const lori = P('2', 'Loritta', '#f6a6c1', '#7d3c98', { isBot: true });
const m = (id, a, content, mins, extra = {}) => ({ id, authorId: a.id, author: a, content, createdAt: new Date(now - mins * 60000).toISOString(), channelId: 'ch2', reactions: [], attachments: [], ...extra });
const rx = (emoji, u) => ({ id: `rx-${emoji}-${u.id}`, emoji, userId: u.id, createdAt: new Date(now).toISOString(), user: u });
const MESSAGES = [
  m('s1', lia, 'alguém pra call hoje à noite?', 52),
  m('s2', rique, 'bora! abro a sala de voz às 21h', 50),
  m('s3', kaio, 'baixei o modpack pelo Mod Manager, já tá rodando aqui', 41, { reactions: [rx('🔥', rique), rx('🔥', lia)], reactionCounts: { '🔥': 3 } }),
  m('s4', nina, 'quem vai de mestre na mesa de RPG sexta?', 33),
  m('s5', rique, 'eu levo a campanha do Blackout, já deixei as fichas prontas', 30),
  m('s6', lia, 'separa a sacerdotisa pra mim 🙏', 28, { reactions: [rx('😂', kaio)], reactionCounts: { '😂': 2 } }),
  m('s7', lori, 'Lembrete: o evento de figurinhas começa amanhã 🎉', 6, { reactions: [rx('🎉', rique), rx('🎉', nina)], reactionCounts: { '🎉': 14 } }),
];

test('app', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* */ } });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api/, '');
    if (p === '/messages' && url.searchParams.get('channelId') === 'ch2') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: MESSAGES }) });
    }
    // Tira o banner de teste ("PROJECT CLUB" desenhado) de qualquer resposta.
    const clean = (v) => {
      if (typeof v === 'string') return v.includes('PROJECT%20CLUB') || v.includes('PROJECT CLUB</text>') ? null : v;
      if (Array.isArray(v)) return v.map(clean);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]));
      return v;
    };
    return handler({
      request: () => route.request(),
      fulfill: (o) => { try { return route.fulfill({ ...o, body: JSON.stringify(clean(JSON.parse(o.body))) }); } catch { return route.fulfill(o); } },
      continue: (...a) => route.continue(...a), abort: (...a) => route.abort(...a), fetch: (...a) => route.fetch(...a),
    });
  });
  await page.route('**/socket.io/**', (r) => r.abort());
  // Banner da comunidade: no lugar do de teste, um fundo escuro simples.
  const plain = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="260"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1c1f2b"/><stop offset="1" stop-color="#0b0b0c"/></linearGradient></defs><rect width="600" height="260" fill="url(#g)"/></svg>';
  await page.route('**/mock-img/**', (route) => imageHandler({
    request: () => route.request(),
    fulfill: (o) => route.fulfill(String(o.body).includes('PROJECT CLUB') ? { ...o, body: plain } : o),
  }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(process.env.APP_PATH || '/channels/ch2');
  await page.locator('.chat-header').waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: process.env.APP_SHOT });
});
