import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { handler, imageHandler } from './mock-api.mjs';

// Conforto: tour de boas-vindas (acessível, pula com Esc), checklist
// "Primeiros passos" (resgate com comemoração), tela de atalhos (Ctrl+/)
// e Painel de saúde da staff. Capturas em $CONFORTO_SHOTS_DIR.
const SHOTS = process.env.CONFORTO_SHOTS_DIR || '/tmp/claude-0/conforto-shots';
fs.mkdirSync(SHOTS, { recursive: true });

const STEPS = [
  { key: 'PROFILE', title: 'Coloque uma foto de perfil', description: 'Escolha uma foto.', action: 'profile', coins: 50, done: true, claimed: true },
  { key: 'FIRST_MESSAGE', title: 'Mande sua primeira mensagem', description: 'Diga um oi.', action: 'chat', coins: 30, done: true, claimed: false },
  { key: 'JOIN_VOICE', title: 'Entre em um canal de voz', description: 'Entre na call.', action: 'voice', coins: 40, done: false, claimed: false },
  { key: 'REACT', title: 'Reaja a uma mensagem', description: 'Escolha um emoji.', action: 'chat', coins: 20, done: false, claimed: false },
  { key: 'PROFILE_THEME', title: 'Personalize seu perfil', description: 'Troque a cor.', action: 'profileTheme', coins: 30, done: false, claimed: false },
  { key: 'NOTIFICATIONS', title: 'Ative as notificações', description: 'Receba avisos.', action: 'notifications', coins: 30, done: false, claimed: false },
];
const onboarding = (extra = {}) => ({ eligible: true, tourSeenAt: null, dismissedAt: null, steps: STEPS, totalCoins: 200, earnedCoins: 50, allClaimed: false, ...extra });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const HEALTH = {
  at: new Date().toISOString(),
  db: { ok: true, ms: 12 }, redis: { ok: true, ms: 3, status: 'ready' },
  process: { uptimeSec: 93784, pid: 1, node: 'v22.11.0', rssMb: 312.4, heapUsedMb: 140, heapTotalMb: 220, externalMb: 20, loadAvg: [0.4, 0.3, 0.2], cpus: 2, sockets: 57 },
  version: { web: { web: '2026.10.17-abc1234' }, builtAt: new Date().toISOString(), server: '1.0.0', node: 'v22.11.0', commit: null },
  errors: {
    last24h: 3, total: 2,
    groups: [
      { id: 'e1', source: 'server', message: "TypeError: Cannot read properties of undefined (reading 'id')", stack: 'TypeError: ...\n    at getThing (src/controllers/x.js:10:5)', url: '/api/x', count: 14, firstSeen: new Date(Date.now() - 86400000).toISOString(), lastSeen: new Date(Date.now() - 120000).toISOString() },
      { id: 'e2', source: 'client', message: 'ChunkLoadError: Loading chunk 12 failed', stack: null, url: '/inicio', count: 2, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() },
    ],
  },
  voice: { totalParticipants: 3, rooms: [{ id: 'v1', kind: 'channel', name: '☕ | Call ¹', startedAt: new Date(Date.now() - 1800000).toISOString(), participants: [
    { userId: '1', displayName: 'RiqueBitt', muted: false, deafened: false, screenSharing: true, provider: 'own' },
    { userId: '5', displayName: 'Lia', muted: true, deafened: false, provider: 'own' },
    { userId: '2', displayName: 'Loritta', muted: true, deafened: true, serverMuted: true, provider: 'own' },
  ] }] },
  media: { configured: true, ok: true, ms: 48, summary: { workers: 2, rooms: 1, peers: 3 }, rooms: [{ room: 'pc_abc123', peers: [
    { id: 'p1', name: 'RiqueBitt', producers: 2, consumers: 2, transports: [{ dir: 'send', ice: 'completed', dtls: 'connected' }], stalled: 0 },
    { id: 'p2', name: 'Lia', producers: 0, consumers: 3, transports: [{ dir: 'recv', ice: 'connected', dtls: 'connected' }], stalled: 1 },
  ] }] },
  backup: {
    config: { enabled: true, hour: 4, keep: 7, destination: 's3', target: 'pc-backups/db-backups/', s3Misconfigured: false, mysqldump: false },
    running: false,
    lastOk: { id: 'b1', status: 'OK', trigger: 'SCHEDULE', method: 'node', sizeBytes: 48234567, startedAt: new Date(Date.now() - 8 * 3600000).toISOString(), finishedAt: new Date().toISOString(), durationMs: 92000 },
    recent: [
      { id: 'b2', status: 'FAILED', trigger: 'MANUAL', method: null, sizeBytes: null, error: 'Access Denied (S3)', startedAt: new Date(Date.now() - 3600000).toISOString(), durationMs: 2000 },
      { id: 'b1', status: 'OK', trigger: 'SCHEDULE', method: 'node', sizeBytes: 48234567, startedAt: new Date(Date.now() - 8 * 3600000).toISOString(), durationMs: 92000 },
    ],
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('layoutStyle', 'normal2');
      localStorage.setItem('pc-firststeps-collapsed', '0');
      sessionStorage.setItem('inicio-redirect-done', '1');
    } catch { /* ok */ }
  });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

test('tour de boas-vindas: aparece pra conta nova, navega no teclado e fecha com Esc', async ({ page }) => {
  const metas = [];
  await page.route('**/api/onboarding', (r) => json(r, onboarding()));
  await page.route('**/api/onboarding/meta/*', (r) => { metas.push(r.request().url()); return json(r, { ok: true }); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/channels/ch2');
  const dialog = page.getByRole('dialog', { name: /Boas-vindas ao Project Club/ });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-tour-primary]')).toBeFocused();
  await page.screenshot({ path: `${SHOTS}/tour-1-${test.info().project.name}.png` });
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: /Menu principal/ })).toBeVisible();
  await page.getByRole('button', { name: 'Próximo' }).click();
  await expect(page.getByRole('dialog', { name: /Canais da comunidade/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/tour-3-${test.info().project.name}.png` });
  // Tab não sai do balão (foco preso).
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.pc-tour-pop'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pc-tour')).toHaveCount(0);
  await expect.poll(() => metas.length).toBeGreaterThan(0);
  expect(metas[0]).toContain('/onboarding/meta/tour');
  // Não reaparece depois de recarregar (cache local).
  await page.reload();
  await page.waitForTimeout(4000);
  await expect(page.locator('.pc-tour')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('primeiros passos: resgata a recompensa com comemoração', async ({ page }) => {
  let claims = 0;
  await page.route('**/api/onboarding', (r) => json(r, onboarding({ tourSeenAt: new Date().toISOString() })));
  await page.route('**/api/onboarding/claim/*', (r) => { claims += 1; return json(r, { ok: true, step: 'FIRST_MESSAGE', coins: 30, balance: { coins: 80 } }); });
  await page.goto('/channels/ch2');
  const widget = page.getByRole('complementary', { name: 'Primeiros passos' });
  await expect(widget).toBeVisible({ timeout: 30_000 });
  await expect(widget.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  await page.screenshot({ path: `${SHOTS}/primeiros-passos-${test.info().project.name}.png` });
  await widget.getByRole('button', { name: /Resgatar 30 moedas/ }).click();
  await expect(widget.locator('.pc-fs-burst-coins')).toHaveText('+30');
  await expect(widget.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
  expect(claims).toBe(1);
  await page.screenshot({ path: `${SHOTS}/primeiros-passos-resgate-${test.info().project.name}.png` });
  // Recolher e expandir pelo teclado.
  const toggle = widget.locator('.pc-fs-toggle');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('atalhos: Ctrl+/ abre a lista, Esc fecha; Alt+↓ vai pro próximo canal', async ({ page, isMobile }) => {
  test.skip(isMobile, 'atalhos de teclado são do computador');
  await page.route('**/api/onboarding', (r) => json(r, onboarding({ tourSeenAt: new Date().toISOString(), eligible: false })));
  await page.goto('/channels/ch2');
  await expect(page.locator('.channel-item[data-channel-id="ch2"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('body').click({ position: { x: 700, y: 300 } }).catch(() => {});
  await page.keyboard.press('Control+/');
  const dialog = page.getByRole('dialog', { name: 'Atalhos de teclado' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Buscar e pular para canais, conversas e páginas')).toBeVisible();
  await expect(dialog.getByText('Ligar/desligar o microfone')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/atalhos.png` });
  await page.getByRole('searchbox', { name: 'Filtrar atalhos' }).fill('canal');
  await expect(dialog.getByText('Ligar/desligar o microfone')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page).toHaveURL(/\/canal\/comandos$/); // link bonito (era /channels/ch3)
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page).toHaveURL(/\/canal\/chat-geral$/);
});

test('acessibilidade: botões de ícone com nome e foco visível no teclado', async ({ page, isMobile }) => {
  test.skip(isMobile, 'barra superior do computador');
  await page.route('**/api/onboarding', (r) => json(r, onboarding({ tourSeenAt: new Date().toISOString(), eligible: false })));
  await page.goto('/channels/ch2');
  await expect(page.locator('.channel-item[data-channel-id="ch2"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Configurações' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Notificações/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Canais' })).toBeVisible();
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('.top-search-bar button, .user-status-bar button, .sidebar-list button')]
    .filter((b) => b.getClientRects().length && !(b.getAttribute('aria-label') || b.textContent.trim()))
    .map((b) => b.outerHTML.slice(0, 120)));
  expect(unnamed).toEqual([]);
  await page.locator('.channel-item[data-channel-id="ch2"]').focus();
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(outline).not.toBe('none');
});

test('painel de saúde da staff: erros, calls, mídia e backup', async ({ page }) => {
  await page.route('**/api/onboarding', (r) => json(r, onboarding({ tourSeenAt: new Date().toISOString(), eligible: false })));
  await page.route('**/api/staff-ops/health', (r) => json(r, HEALTH));
  let ran = 0;
  await page.route('**/api/staff-ops/backups/run', (r) => { ran += 1; return json(r, { ok: true, started: true, backup: null }, 202); });
  await page.goto('/admin?tab=painelSaude');
  await expect(page.getByRole('heading', { name: /Backup do banco/ })).toBeVisible({ timeout: 30_000 });
  const panel = page.locator('.sop');
  await expect(panel.getByText('☕ | Call ¹')).toBeVisible();
  await expect(panel.getByText(/14×/)).toBeVisible();
  await expect(panel.getByText('pc_abc123')).toBeVisible();
  await expect(panel.getByText('Access Denied (S3)')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/painel-saude-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Fazer backup agora' }).click();
  await expect(page.getByRole('status')).toContainText('Backup iniciado');
  expect(ran).toBe(1);
});
