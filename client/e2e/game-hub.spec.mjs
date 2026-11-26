import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Game Hub (/jogos): abas, promoções, partidas (abrir e convidar), clipes e
// builds. API simulada em mock-api.mjs (gameHubMock).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* */ } });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route(/steamstatic|steampowered|akamai/, (r) => r.abort());
});

test('Início: hotlist do mês, grátis e partidas abertas; abas levam a cada seção', async ({ page }) => {
  await page.goto('/jogos');
  await expect(page.locator('.jh-hot-item')).toHaveCount(5, { timeout: 20_000 });
  await expect(page.locator('.jh-hot-item').first()).toContainText('VALORANT');
  await expect(page.locator('.jh-hot-item').first()).toContainText('412 h');
  await expect(page.locator('.gh-free').first()).toContainText('Grátis');
  await expect(page.locator('.gh-party')).toHaveCount(3);
  for (const [tab, url, sel] of [['Promoções', /\/jogos\/promocoes$/, '.gh-deal'], ['Partidas', /\/jogos\/partidas$/, '.gh-party'], ['Clipes', /\/jogos\/clipes$/, '.gh-clip'], ['Builds', /\/jogos\/builds$/, '.gh-bcard'], ['Mods', /\/jogos\/mods$/, '.gh-tab.on']]) {
    await page.locator('.gh-tab', { hasText: tab }).click();
    await expect(page).toHaveURL(url);
    await expect(page.locator(sel).first()).toBeVisible();
  }
});

test('Promoções: filtra por loja e mostra Epic em dólar', async ({ page }) => {
  await page.goto('/jogos/promocoes');
  await expect(page.locator('.gh-deal')).toHaveCount(8, { timeout: 20_000 });
  await page.getByRole('tab', { name: 'GOG' }).click();
  await expect(page.locator('.gh-deal')).toHaveCount(2);
  await page.getByRole('tab', { name: 'Epic' }).click();
  await expect(page.locator('.gh-deal').first()).toContainText('US$');
});

test('Partidas: abrir uma partida com convite', async ({ page }) => {
  let posted = null;
  await page.route('**/api/game-hub/parties', async (route) => {
    if (route.request().method() === 'POST') posted = JSON.parse(route.request().postData());
    return handler(route);
  });
  await page.goto('/jogos/partidas');
  await expect(page.locator('.gh-party')).toHaveCount(3, { timeout: 20_000 });
  await page.getByRole('button', { name: 'Abrir partida' }).first().click();
  await page.locator('#gh-game-q').fill('Terraria');
  await page.getByRole('option', { name: 'Terraria' }).click();
  await page.getByRole('button', { name: 'Lia' }).click();
  await page.locator('.gh-form').getByRole('button', { name: 'Abrir partida' }).click();
  await expect.poll(() => posted?.gameName).toBe('Terraria');
  expect(posted.steamAppId).toBe(105600);
  expect(posted.invite).toEqual(['5']);
  await expect(page.locator('.gh-party').first()).toContainText('Terraria');
});

test('Clipes: “Neste PC” explica que precisa do app; publicar pede o link', async ({ page }) => {
  await page.goto('/jogos/clipes');
  await expect(page.locator('.gh-clip')).toHaveCount(4, { timeout: 20_000 });
  await page.getByRole('tab', { name: 'Neste PC' }).click();
  await expect(page.locator('.gh-empty')).toContainText('app do PC');
  await page.getByRole('button', { name: 'Publicar clipe' }).first().click();
  await expect(page.getByLabel('LINK DO CLIPE')).toBeVisible();
});

test('Builds: abre a build de LoL com runas, itens e ordem de habilidades', async ({ page }) => {
  await page.goto('/jogos/builds');
  await expect(page.locator('.gh-bcard')).toHaveCount(4, { timeout: 20_000 });
  await page.locator('.gh-bcard', { hasText: 'Ahri meio' }).locator('.gh-bcard-main').click();
  await expect(page).toHaveURL(/\/jogos\/builds\/b1$/);
  await expect(page.locator('.gh-bv-pills')).toContainText('Eletrocutar');
  await expect(page.locator('.gh-bv-itemlist').nth(1)).toContainText('Tormento de Luden');
  await expect(page.locator('.gh-skills-cell.on')).toHaveCount(18);
});
