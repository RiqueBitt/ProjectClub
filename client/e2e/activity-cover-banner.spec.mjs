import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { handler, imageHandler, ME } from './mock-api.mjs';

// 1) "Jogando <jogo>" de jogo da Steam mostra a CAPA do jogo (igual a capa
//    do álbum na música): capa vertical direto do CDN da Steam e, se ela
//    falhar, cai pro proxy/header sozinha (onError).
// 2) Banner do perfil completo usa a imagem em tamanho cheio (a mesma URL
//    salva, sem miniatura/variante menor).

const STEAM_APP = 1086940;
const COVER = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${STEAM_APP}/library_600x900.jpg`;
const HEADER = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${STEAM_APP}/header.jpg`;
const BANNER_URL = 'http://localhost:4173/mock-img/banner-full.png';
const activity = { type: 'game', name: "Baldur's Gate 3", steamAppId: STEAM_APP, imageUrl: COVER, startedAt: Date.now() - 5 * 60000 };
const meWith = { ...ME, bannerUrl: BANNER_URL, bannerFraming: null, accountLevel: 7 };

let coverPng; let headerPng; let bannerPng;
test.beforeAll(async () => {
  coverPng = await sharp({ create: { width: 600, height: 900, channels: 3, background: { r: 120, g: 40, b: 160 } } }).png().toBuffer();
  headerPng = await sharp({ create: { width: 460, height: 215, channels: 3, background: { r: 30, g: 120, b: 60 } } }).png().toBuffer();
  bannerPng = await sharp({ create: { width: 2400, height: 800, channels: 3, background: { r: 20, g: 60, b: 160 } } }).png().toBuffer();
});

async function setup(page, { coverFails = false } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('layoutStyle', 'normal2');
      sessionStorage.setItem('inicio-redirect-done', '1');
    } catch { /* sem storage */ }
  });
  const steamHits = [];
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/users/1') return json({ user: meWith, levelProgress: 64, badges: [], mutualFriends: [], activity });
    if (p === '/api/users/1/summary') return json({ profile: { user: meWith, levelProgress: 64, badges: [], mutualFriends: [], activity }, fan: null, traits: null, polls: null });
    if (p.startsWith('/api/proxy/steam/')) {
      steamHits.push(p);
      if (p.endsWith('/header')) return route.fulfill({ status: 200, contentType: 'image/png', body: headerPng });
      return route.fulfill({ status: 404, body: 'Sem arte' });
    }
    return handler(route);
  });
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/banner-full.png')) return route.fulfill({ status: 200, contentType: 'image/png', body: bannerPng });
    return imageHandler(route);
  });
  await page.route(/steamstatic\.com/, (route) => {
    const u = route.request().url();
    steamHits.push(u);
    if (u === COVER && !coverFails) return route.fulfill({ status: 200, contentType: 'image/png', body: coverPng });
    if (u === HEADER && !coverFails) return route.fulfill({ status: 200, contentType: 'image/png', body: headerPng });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  return steamHits;
}

async function openMyMiniProfile(page) {
  await page.goto('/channels/ch2');
  // Mensagem do próprio usuário (RiqueBitt, id 1).
  const avatar = page.locator('.message .avatar.clickable').first();
  await expect(avatar).toBeVisible({ timeout: 20_000 });
  await avatar.click();
  const card = page.locator('.mini-profile-card');
  await expect(card).toBeVisible();
  return card;
}

test.describe('capa do jogo da Steam na atividade', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('miniperfil e perfil completo mostram a capa vertical do CDN da Steam', async ({ page }) => {
    await setup(page);
    const card = await openMyMiniProfile(page);
    const badge = card.locator('.activity-badge-game');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("Baldur's Gate 3");
    const img = badge.locator('.activity-badge-icon img.activity-badge-cover');
    await expect(img).toHaveAttribute('src', COVER);
    await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBe(600);
    // Caixa no formato de capa (2:3), como a capa do álbum da música.
    await expect(badge.locator('.activity-badge-icon')).toHaveClass(/is-cover/);
    const box = await badge.locator('.activity-badge-icon').boundingBox();
    // (o miniperfil pode estar com zoom de interface — confere a proporção)
    expect(box.height).toBeGreaterThanOrEqual(72);
    expect(Math.abs(box.width / box.height - 2 / 3)).toBeLessThan(0.03);

    // Perfil completo.
    await card.getByText('Ver perfil completo').click();
    const full = page.locator('.profile-modal-fullscreen .activity-badge-game');
    await expect(full).toBeVisible({ timeout: 20_000 });
    await expect(full.locator('img.activity-badge-cover')).toHaveAttribute('src', COVER);
  });

  test('capa vertical indisponível: cai pro header sozinha (onError), sem imagem quebrada', async ({ page }) => {
    const hits = await setup(page, { coverFails: true });
    const card = await openMyMiniProfile(page);
    const img = card.locator('.activity-badge-game img.activity-badge-cover');
    // CDN (capa) 404 → proxy capa 404 → CDN header 404 → proxy header OK.
    await expect(img).toHaveAttribute('src', `/api/proxy/steam/${STEAM_APP}/header`);
    await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBe(460);
    await expect(card.locator('.activity-badge-game .activity-badge-icon')).toHaveClass(/is-capsule/);
    expect(hits).toContain(COVER);
    expect(hits).toContain(`/api/proxy/steam/${STEAM_APP}/cover`);
  });
});

test.describe('banner do perfil completo', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('usa a imagem em tamanho cheio (mesma URL salva, sem variante menor)', async ({ page }) => {
    await setup(page);
    const card = await openMyMiniProfile(page);
    await card.getByText('Ver perfil completo').click();
    const img = page.locator('.profile-modal-fullscreen .profile-banner img.pb-banner-img');
    await expect(img).toBeVisible({ timeout: 20_000 });
    await expect(img).toHaveAttribute('src', BANNER_URL);
    expect(await img.getAttribute('srcset')).toBeNull();
    await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBe(2400);
    // A imagem tem pixels de sobra pra faixa (inclusive em tela 2x).
    const shown = await img.boundingBox();
    expect(2400 / shown.width).toBeGreaterThanOrEqual(2);
  });
});
