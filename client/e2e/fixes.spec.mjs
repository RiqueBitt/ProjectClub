import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import sharp from 'sharp';
import { handler, imageHandler, ME } from './mock-api.mjs';

// Testes das correções: Guerra das Cartas desligada, baú da Economia sem
// espaço vazio, avatar com moldura do mesmo tamanho e foto de perfil em GIF
// (enquadramento enviado ao servidor sem achatar a animação). Também salva
// capturas (1440 e 430 de largura) em /tmp/claude-0/fix-shots/.
const SHOTS = process.env.FIX_SHOTS_DIR || '/tmp/claude-0/fix-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const VIEWPORTS = [{ name: '1440', width: 1440, height: 900 }, { name: '430', width: 430, height: 900 }];

// Moldura (anel) e baú com MUITA borda transparente em volta.
const DECO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="54" fill="none" stroke="#ffb020" stroke-width="10"/><circle cx="60" cy="8" r="8" fill="#ff4fa3"/></svg>';
let chestPng;
let gifBuf;
test.beforeAll(async () => {
  const body = await sharp({ create: { width: 180, height: 130, channels: 4, background: { r: 150, g: 90, b: 30, alpha: 1 } } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="130"><rect x="0" y="0" width="180" height="40" fill="#e0b040"/><rect x="80" y="40" width="20" height="30" fill="#333"/></svg>') }])
    .png().toBuffer();
  chestPng = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: body, left: 166, top: 250 }]).png().toBuffer();
  const frames = await Promise.all([[255, 0, 0], [0, 0, 255], [0, 200, 0]].map(([r, g, b]) => sharp({ create: { width: 120, height: 80, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer()));
  gifBuf = await sharp(frames, { join: { animated: true } }).gif({ delay: [150, 150, 150], loop: 0 }).toBuffer();
});

const DECO = JSON.stringify({ id: 'd1', url: 'http://localhost:4173/mock-img/deco.svg', s: 1.2 });
const decoMe = { ...ME, avatarDecoration: DECO };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('layoutStyle', 'normal2');
      sessionStorage.setItem('inicio-redirect-done', '1');
    } catch { /* sem storage */ }
  });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/deco.svg')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: DECO_SVG });
    if (p.endsWith('/chest-open.png') || p.endsWith('/chest-closed.png')) return route.fulfill({ status: 200, contentType: 'image/png', body: chestPng });
    return imageHandler(route);
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

for (const vp of VIEWPORTS) {
  test.describe(`correções (${vp.name}px)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('Guerra das Cartas: /cartas mostra "Em breve" e some do menu', async ({ page }) => {
      const cardsCalls = [];
      page.on('request', (r) => { if (/\/api\/cards\//.test(r.url())) cardsCalls.push(r.url()); });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      // Link de convite antigo (deep link invite/<código> → /cartas?sala=).
      await page.goto('/cartas?sala=ABCD12');
      await expect(page.getByText('Em breve')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Guerra das Cartas está temporariamente desativado/)).toBeVisible();
      await expect(page.getByText('Algo deu errado')).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/cartas-desativado-${vp.name}.png` });
      await page.goto('/inicio');
      await expect(page.locator('.home-hero')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('a[href="/cartas"]')).toHaveCount(0);
      await expect(page.locator('.tcg-promo, .arena-promo')).toHaveCount(0);
      expect(cardsCalls, 'nenhuma chamada à API do jogo').toEqual([]);
      expect(errors).toEqual([]);
    });

    test('Baú: imagem sem borda transparente e card sem espaço vazio', async ({ page }) => {
      await page.route('**/api/economy', (r) => json(r, { coins: 1200, gems: 3, dailyStreak: 2, streakRequired: 5, lastDailyAt: null, nextDailyAt: null }));
      await page.route('**/api/economy/chests', (r) => json(r, { chests: [
        { id: 'c1', name: 'Comum', imageClosed: 'http://localhost:4173/mock-img/chest-closed.png', imageOpened: 'http://localhost:4173/mock-img/chest-open.png' },
        { id: 'c2', name: 'Épico', imageClosed: 'http://localhost:4173/mock-img/chest-closed.png', imageOpened: 'http://localhost:4173/mock-img/chest-open.png' },
      ] }));
      await page.route('**/api/economy/daily', (r) => json(r, { chestName: 'Épico', chestImageOpened: 'http://localhost:4173/mock-img/chest-open.png', coins: 38, tickets: 5, megaAwarded: false }));
      await page.route('**/api/missions', (r) => json(r, { missions: [], resets: {} }));
      await page.goto('/economia');
      const claim = page.getByRole('button', { name: /Resgatar baú diário/ });
      await expect(claim).toBeVisible({ timeout: 20_000 });
      await claim.click();
      const card = page.locator('.chest-reveal-card');
      await expect(card).toBeVisible();
      const img = card.locator('.chest-reveal-img');
      // Espera a versão recortada (data:) substituir a original.
      await expect.poll(() => img.evaluate((el) => el.currentSrc.startsWith('data:image/png')), { timeout: 5000 }).toBe(true);
      await page.waitForTimeout(500); // animação de entrada
      const natural = await img.evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight }));
      // Original 512x512 com o baú de 180x130 no meio: recortado ~ 182x132.
      expect(natural.w).toBeLessThan(200);
      expect(natural.h).toBeLessThan(150);
      const cardBox = await card.boundingBox();
      const imgBox = await img.boundingBox();
      // Espaço vazio acima do baú: só o padding do card (antes: ~330px).
      expect(imgBox.y - cardBox.y).toBeLessThan(60);
      // O baú é o destaque: ocupa boa parte da largura do card, sem deformar.
      expect(imgBox.width / cardBox.width).toBeGreaterThan(0.5);
      const rendered = await img.evaluate((el) => getComputedStyle(el).objectFit);
      expect(rendered).toBe('contain');
      await page.screenshot({ path: `${SHOTS}/bau-modal-${vp.name}.png` });
    });

    test('Avatar com moldura: foto do mesmo tamanho que sem moldura', async ({ page }) => {
      // Mensagens: uma do usuário COM moldura e uma de outro SEM.
      const now = Date.now();
      const other = { ...ME, id: '5', displayName: 'Lia', username: 'lia', avatarDecoration: null };
      await page.route(/\/api\/messages(\?|$)/, (r) => json(r, { messages: [
        { id: 'x1', authorId: '1', author: decoMe, content: 'com moldura', createdAt: new Date(now - 120000).toISOString(), channelId: 'ch2', reactions: [], attachments: [] },
        { id: 'x2', authorId: '5', author: other, content: 'sem moldura', createdAt: new Date(now - 60000).toISOString(), channelId: 'ch2', reactions: [], attachments: [] },
      ] }));
      await page.route('**/api/users/1', (r) => json(r, { user: { ...decoMe, accountLevel: 7 }, levelProgress: 64, badges: [], mutualFriends: [] }));
      await page.goto('/channels/ch2');
      const avatars = page.locator('.message .avatar.clickable');
      await expect(avatars.nth(1)).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.message .avatar-decoration').first()).toBeVisible();
      const withDeco = await avatars.nth(0).locator('img:not(.avatar-decoration)').boundingBox();
      const without = await avatars.nth(1).locator('img').first().boundingBox();
      expect(Math.round(withDeco.width)).toBe(Math.round(without.width));
      expect(Math.round(withDeco.height)).toBe(Math.round(without.height));
      // A moldura fica maior que a foto, centralizada, sem mudar o layout.
      const deco = await page.locator('.message .avatar-decoration').first().boundingBox();
      expect(deco.width).toBeGreaterThan(withDeco.width);
      expect(Math.abs((deco.x + deco.width / 2) - (withDeco.x + withDeco.width / 2))).toBeLessThan(1.5);
      expect(Math.abs((deco.y + deco.height / 2) - (withDeco.y + withDeco.height / 2))).toBeLessThan(1.5);
      const wrap = await avatars.nth(0).boundingBox();
      const wrap2 = await avatars.nth(1).boundingBox();
      expect(Math.round(wrap.width)).toBe(Math.round(wrap2.width));
      await page.locator('.messages, .message-list, .chat-messages').first().screenshot({ path: `${SHOTS}/avatar-moldura-chat-${vp.name}.png` }).catch(() => page.screenshot({ path: `${SHOTS}/avatar-moldura-chat-${vp.name}.png` }));
      await page.screenshot({ path: `${SHOTS}/avatar-moldura-tela-${vp.name}.png` });

      // Miniperfil (avatar 84px) com moldura: foto continua com 84px (x zoom da interface).
      await avatars.nth(0).click();
      const mini = page.locator('.mini-profile-card');
      await expect(mini).toBeVisible();
      await page.waitForTimeout(500);
      const miniImg = await mini.locator('.mini-profile-avatar img:not(.avatar-decoration)').first().evaluate((el) => ({ w: el.offsetWidth, h: el.offsetHeight }));
      expect(miniImg).toEqual({ w: 84, h: 84 });
      await page.screenshot({ path: `${SHOTS}/miniperfil-moldura-${vp.name}.png` });
    });
  });
}

test.describe('foto de perfil em GIF', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('GIF sem tipo/extensão abre o editor de enquadramento e envia crop + GIF original', async ({ page }) => {
    let posted = null;
    await page.route('**/api/users/me/avatar', async (route) => {
      posted = route.request().postDataBuffer();
      return json(route, { user: { ...ME, avatarUrl: 'http://localhost:4173/mock-img/new.gif' } });
    });
    await page.goto('/inicio');
    await expect(page.locator('.home-hero')).toBeVisible({ timeout: 20_000 });
    await page.locator('.top-search-bar-icon-btn[title="Configurações"]').click();
    await expect(page.locator('.settings-modal-layout')).toBeVisible();
    const change = page.getByRole('button', { name: 'Alterar avatar' });
    if (!(await change.isVisible().catch(() => false))) {
      await page.getByText(/^Perfil$/).first().click();
    }
    await expect(change).toBeVisible();
    // Com a máquina do CI carregada, o primeiro clique às vezes cai antes
    // do modal terminar de abrir e o menu não aparece: tenta de novo.
    const pick = page.getByRole('menuitem', { name: /Escolher nova foto/ });
    await expect(async () => {
      if (!(await pick.isVisible().catch(() => false))) await change.click();
      await expect(pick).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    const chooser = page.waitForEvent('filechooser', { timeout: 30_000 });
    await pick.click();
    // Como vem da galeria do Android: sem tipo e sem extensão.
    await (await chooser).setFiles({ name: 'image-1234', mimeType: 'application/octet-stream', buffer: gifBuf });
    await expect(page.getByText(/GIF animado: a animação continua/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/gif-avatar-editor-1440.png` });
    await page.getByRole('button', { name: 'Aplicar' }).click();
    await expect.poll(() => posted !== null, { timeout: 5000 }).toBe(true);
    const text = posted.toString('latin1');
    const cropAt = text.indexOf('name="crop"');
    const fileAt = text.indexOf('name="avatar"');
    expect(cropAt).toBeGreaterThan(-1);
    expect(fileAt).toBeGreaterThan(cropAt); // crop vem antes do arquivo (multer)
    expect(text).toMatch(/name="crop"\r\n\r\n50,50,1\r\n/);
    // O arquivo enviado é o GIF original (todos os quadros), não um PNG/WebP do canvas.
    expect(text.slice(fileAt)).toContain('GIF89a');
    expect(posted.includes(gifBuf)).toBe(true);
  });
});
