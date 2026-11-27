import { test } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Fotos das telas principais no visual novo (estilo fundido), em cada tema.
// Ferramenta de conferência — só roda com CLUB_SHOTS=<pasta>.
//   CLUB_SHOTS=shots-local CLUB_THEME=claro CLUB_ACCENT=roxo npx playwright test e2e/_club-shots.spec.mjs --project=pc
test.skip(!process.env.CLUB_SHOTS, 'só com CLUB_SHOTS');

const OUT = process.env.CLUB_SHOTS;
const THEME = process.env.CLUB_THEME || 'preto';
const ACCENT = process.env.CLUB_ACCENT || 'azul';
const VISUAL = process.env.CLUB_VISUAL || 'club';
const ONLY = (process.env.CLUB_ONLY || '').split(',').filter(Boolean);

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
  m('s2', rique, 'bora! abro a call às 23h, já deixei a partida no Game Hub', 50),
  m('s3', kaio, 'baixei o modpack pelo Mod Manager, já tá rodando aqui', 41, { reactions: [rx('🔥', rique), rx('🔥', lia)], reactionCounts: { '🔥': 3 } }),
  m('s4', nina, 'quem vai de mestre na mesa de RPG sexta?', 33),
  m('s6', lia, 'eu! e separa a sacerdotisa pra mim 🙏', 28, { reactions: [rx('😂', kaio)], reactionCounts: { '😂': 2 } }),
  m('s7', lori, 'Lembrete: o evento de figurinhas começa amanhã 🎉', 6, { reactions: [rx('🎉', rique), rx('🎉', nina)], reactionCounts: { '🎉': 14 } }),
];

const PAGES = [
  ['chat', '/channels/ch2', '.chat-header'],
  ['central', '/inicio', '.home-hero'],
  ['amigos', '/dms', '.social-hero'],
  ['economia', '/economia', 'main, .app-main'],
  ['loja', '/loja', 'main, .app-main'],
  ['progresso', '/progresso', '.pg-hero'],
  ['gamehub', '/jogos', '.app-card, .gh-shell, main'],
  ['promocoes', '/jogos/promocoes', 'main, .app-main'],
  ['mods', '/jogos/mods', 'main, .app-main'],
  ['assinatura', '/assinatura', 'main, .app-main'],
  ['suporte', '/tickets', '.sp-item'],
  ['notificacoes', '/notifications', 'main, .app-main'],
  ['voz', '/channels/v1', '.app-main'],
  ['clube', '/clans/mine', '.app-main'],
  ['perfil', '/channels/ch2', '.chat-header', async (page) => {
    await page.locator('.message .avatar.clickable').first().click();
  }],
  ['config', '/channels/ch2', '.chat-header', async (page) => {
    await page.locator('.club-rail-btn[aria-label="Configurações"]').click();
    await page.getByRole('button', { name: /Aparência/ }).first().click().catch(() => {});
  }],
];

for (const [name, path, ready, act] of PAGES) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  test(`foto ${name}`, async ({ page }, info) => {
    await page.addInitScript(([visual, theme, accent]) => {
      try {
        localStorage.setItem('theme', 'dark');
        localStorage.setItem('layoutStyle', 'normal2');
        sessionStorage.setItem('inicio-redirect-done', '1');
        const prev = JSON.parse(localStorage.getItem('pc-layout-prefs') || '{}');
        localStorage.setItem('pc-layout-prefs', JSON.stringify({ ...prev, visual, theme, accent }));
      } catch { /* sem storage */ }
    }, [VISUAL, THEME, ACCENT]);
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const p = url.pathname.replace(/^\/api/, '');
      if (p === '/messages' && url.searchParams.get('channelId') === 'ch2') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: MESSAGES }) });
      }
      return handler(route);
    });
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/mock-img/**', imageHandler);
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto(path);
    await page.locator(ready).first().waitFor({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1800);
    if (act) { await act(page); await page.waitForTimeout(900); }
    await page.screenshot({ path: `${OUT}/${info.project.name}-${name}-${VISUAL}-${THEME}-${ACCENT}.png` });
  });
}
