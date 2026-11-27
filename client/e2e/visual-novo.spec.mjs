import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Visual novo (nov/2026, styles/club.css): barra de ícones, painel "Agora",
// tema e cor de destaque em Configurações → Aparência, e o visual clássico.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('layoutStyle', 'normal2');
      sessionStorage.setItem('inicio-redirect-done', '1');
    } catch { /* sem storage */ }
  });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
});

test('chat: visual novo ligado, canal aberto em pílula e painel Agora com o evento ao vivo', async ({ page }, info) => {
  test.skip(info.project.name !== 'pc', 'colunas laterais só no PC');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/channels/ch2');
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('data-visual', 'club');
  await expect(page.locator('.club-rail-btn[aria-label^="Comunidade"]')).toHaveClass(/is-active/);
  // Canal aberto: fundo branco (pílula de papel) no tema preto.
  const bg = await page.locator('.n2-sidebar .channel-item.active').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(255, 255, 255)');
  const agora = page.locator('.members-list .agora');
  await expect(agora).toBeVisible();
  await expect(agora.locator('.agora-title')).toHaveText('Agora');
  await expect(agora.locator('.agora-event').first()).toContainText('Evento de figurinhas');
  await expect(page.locator('.members-list-head')).toBeVisible();
  expect(errors).toEqual([]);
});

test('aparência: trocar tema e cor de destaque aplica na hora e salva na conta', async ({ page }, info) => {
  test.skip(info.project.name !== 'pc', 'configurações conferidas no PC');
  const patches = [];
  page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/users/me/settings')) patches.push(r.postDataJSON()); });
  await page.goto('/inicio');
  await page.locator('.club-rail-btn[aria-label="Configurações"]').click();
  await page.getByText(/^Aparência$/).first().click();
  await expect(page.getByRole('heading', { name: 'Visual', exact: true })).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Tema' }).getByRole('radio', { name: 'Claro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-club-theme', 'claro');
  await page.getByRole('radio', { name: 'Roxo' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'roxo');
  const brand = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim());
  expect(brand.toLowerCase()).toBe('#a970ff');
  await expect.poll(() => patches.some((p) => p.layoutPrefs?.theme === 'claro' && p.layoutPrefs?.accent === 'roxo'), { timeout: 5000 }).toBe(true);
  // Visual clássico: tira o atributo e a barra de ícones.
  await page.getByRole('radiogroup', { name: 'Estilo' }).getByRole('radio', { name: 'Clássico' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-visual', 'club');
  await expect(page.locator('.club-rail')).toHaveCount(0);
});

test('celular: sem barra de ícones, destaques continuam na gaveta e sem rolagem lateral', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'só no celular');
  await page.goto('/inicio');
  await expect(page.locator('.home-hero')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.club-rail')).toBeHidden();
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
