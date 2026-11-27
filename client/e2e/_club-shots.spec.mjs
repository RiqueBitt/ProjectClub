import { test } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Fotos das telas principais no visual novo (estilo fundido), em cada tema.
// Ferramenta de conferência — só roda com CLUB_SHOTS=<pasta>.
//   CLUB_SHOTS=shots-local CLUB_THEME=claro CLUB_ACCENT=roxo npx playwright test e2e/_club-shots.spec.mjs --project=pc
test.skip(!process.env.CLUB_SHOTS, 'só com CLUB_SHOTS');

const OUT = process.env.CLUB_SHOTS;
const THEME = process.env.CLUB_THEME || 'preto';
const ACCENT = process.env.CLUB_ACCENT || 'azul';
const VISUAL = process.env.CLUB_VISUAL || 'novo';
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

// Motor de voz falso (só nestas fotos): entra na call na hora e põe 4 pessoas
// na sala — Lia falando e, na foto "tela", mostrando a tela (um canvas).
const FAKE_ENGINE = `
const PEOPLE = ['5', '2', '3', '4'];
export const GATE_DEFAULTS = {}; export const RECONNECT_DELAYS_MS = [1000, 2000];
export function micErrorReason() { return ''; }
export function qualityFrom() { return 'good'; }
export function preloadMediasoup() { return Promise.resolve(); }
function screenStream() {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
  const g = c.getContext('2d');
  const draw = () => {
    const gr = g.createLinearGradient(0, 0, 1280, 720); gr.addColorStop(0, '#1d3b2a'); gr.addColorStop(1, '#0e1a2e');
    g.fillStyle = gr; g.fillRect(0, 0, 1280, 720);
    g.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 12; i++) g.fillRect(80 + i * 96, 520 - (i * 37 % 200), 60, 200 + (i * 37 % 200));
    g.fillStyle = '#fff'; g.font = 'bold 64px Arial'; g.fillText('Minecraft — servidor do clube', 80, 140);
    g.font = '28px Arial'; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText('construindo a vila nova', 80, 190);
  };
  draw(); setInterval(draw, 250);
  return c.captureStream(4);
}
export function createMediasoupEngine(cb) {
  const api = {
    capabilities: {},
    async join() {
      setTimeout(() => {
        PEOPLE.forEach((u) => cb.onMediaUser && cb.onMediaUser(u, true));
        ['5', '2'].forEach((u) => cb.onRemoteAudio && cb.onRemoteAudio(u, new MediaStream()));
        cb.onRemoteSpeaking && cb.onRemoteSpeaking('5', true);
        if (window.__fakeScreen) cb.onRemoteVideo && cb.onRemoteVideo('5', screenStream(), 'screen');
      }, 60);
      return true;
    },
    getNode() { return null; }, getLocalMicTrack() { return null; }, getInboundAudioBytes() { return 0; },
    dispose() {},
  };
  return new Proxy(api, { get(t, k) { if (k in t) return t[k]; if (k === 'then') return undefined; return () => Promise.resolve(true); } });
}
export function MediasoupEngine() {}
export default MediasoupEngine;
`;
// Socket falso (WebSocket do Socket.IO): só responde o "quem está em cada
// call" — pra a lista da barra lateral e o painel Agora terem gente.
const ROSTERS = {
  v1: { startedAt: now - 47 * 60000, participants: [
    { userId: '1', muted: false, deafened: false, video: false, screenSharing: false },
    { userId: '5', muted: false, deafened: false, video: false, screenSharing: true },
    { userId: '2', muted: false, deafened: false, video: false, screenSharing: false },
    { userId: '3', muted: true, deafened: false, video: false, screenSharing: false },
    { userId: '4', muted: true, deafened: true, video: false, screenSharing: false },
  ] },
};
const fakeSocket = ({ screen = false } = {}) => (ws) => {
  ws.send('0{"sid":"fake","upgrades":[],"pingInterval":25000,"pingTimeout":60000,"maxPayload":1000000}');
  ws.onMessage((m) => {
    const msg = String(m);
    if (msg.startsWith('40')) { ws.send('40{"sid":"fake-ns"}'); return; }
    if (msg === '2') { ws.send('3'); return; }
    if (msg.startsWith('42["voice:join"')) {
      const others = ROSTERS.v1.participants.filter((x) => x.userId !== '1').map((x) => ({ ...x, role: 'speaker', screenSharing: x.screenSharing && screen }));
      setTimeout(() => {
        ws.send(`42${JSON.stringify(['voice:joined', { channelId: 'v1', participants: others, myRole: 'speaker', sync: true }])}`);
        ws.send(`42${JSON.stringify(['voice:speaking', { channelId: 'v1', userId: '5', speaking: true }])}`);
      }, 120);
      return;
    }
    if (msg.startsWith('42["voice:rosters"')) {
      ws.send(`42${JSON.stringify(['voice:rosters', ROSTERS])}`);
      setTimeout(() => ws.send(`42${JSON.stringify(['voice:speaking', { channelId: 'v1', userId: '5', speaking: true }])}`), 200);
    }
  });
};

const joinCall = async (page) => {
  await page.getByRole('button', { name: /Entrar na chamada/ }).click();
  await page.waitForTimeout(1500);
};

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
  ['call', '/channels/v1', '.app-main', joinCall],
  ['tela', '/channels/v1', '.app-main', async (page) => { await page.evaluate(() => { window.__fakeScreen = true; }); await joinCall(page); }],
  ['clube', '/clans/mine', '.app-main'],
  ['perfil', '/channels/ch2', '.chat-header', async (page) => {
    await page.locator('.message .avatar.clickable').first().click();
  }],
  ...[['cfg-conta', /Informação de conta/], ['cfg-seguranca', /Senha e segurança/], ['cfg-privacidade', /^Dados e privacidade$/], ['cfg-notif', /^Notificações$/], ['cfg-voz', /Voz e vídeo/], ['cfg-acess', /Acessibilidade/], ['cfg-sistema', /^Sistema$/], ['cfg-idioma', /Idioma/], ['cfg-jogos', /^Jogos e apps$/]].map(([n, label]) => [n, '/channels/ch2', '.chat-header', async (page) => {
    await page.locator('.club-rail-btn[aria-label="Configurações"]').click();
    await page.locator('.settings-modal-sidebar-item', { hasText: label }).first().click();
  }]),
  ['cfg-perfil', '/channels/ch2', '.chat-header', async (page) => {
    await page.locator('.club-rail-btn[aria-label="Configurações"]').click();
    await page.locator('.settings-modal-sidebar-header').click();
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
    if (process.env.CLUB_SOCKET !== '0') await page.routeWebSocket(/socket\.io/, fakeSocket({ screen: name === 'tela' }));
    await page.route('**/mock-img/**', imageHandler);
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.route(/\/assets\/mediasoupEngine[^/]*\.js$/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_ENGINE }));
    await page.goto(path);
    await page.locator(ready).first().waitFor({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1800);
    if (act) { await act(page); await page.waitForTimeout(900); }
    await page.screenshot({ path: `${OUT}/${info.project.name}-${name}-${VISUAL}-${THEME}-${ACCENT}.png` });
  });
}
