import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Painel → Loja: editar preço dos estilos e escrever o @ da pessoa no
// "Dar item" e na troca nova.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* */ } });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

test('estilos: muda preço e estoque direto no cartão e salva', async ({ page }) => {
  await page.goto('/admin?tab=decoracoes');
  await page.getByRole('tab', { name: /Estilos de perfil/ }).click();
  const card = page.locator('.shop-card', { hasText: 'Terror' });
  const price = card.getByLabel(/Moedas/);
  await price.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('3200');
  await expect(price).toHaveValue('3200');
  const stock = card.getByLabel(/Estoque/);
  await stock.click();
  await page.keyboard.type('40');
  await expect(stock).toHaveValue('40');
  const req = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/decorations/admin/items/st1'));
  await card.getByRole('button', { name: 'Salvar' }).click();
  const body = (await req).postData() || '';
  expect(body).toContain('3200');
  expect(body).toContain('40');
  await expect(page.locator('.shop-notice')).toContainText('salvo');
});

test('dar item: escreve o @ e escolhe a pessoa (inclusive você)', async ({ page }) => {
  await page.goto('/admin?tab=decoracoes');
  await page.getByRole('tab', { name: /Dar item/ }).click();
  const who = page.getByPlaceholder('Nome ou @ da pessoa');
  await who.click();
  await page.keyboard.type('@lia');
  await expect(who).toHaveValue('@lia');
  await page.locator('.user-picker-list button', { hasText: 'Lia' }).click();
  await expect(page.locator('.user-picker-chosen')).toContainText('Lia');
  await page.locator('.user-picker-chosen button').click();
  await who.fill('@riquebitt');
  await expect(page.locator('.user-picker-list button', { hasText: 'RiqueBitt' })).toBeVisible();
});

test('troca nova: escreve o @ da pessoa', async ({ page }) => {
  await page.goto('/loja?tab=trocas');
  await page.getByRole('tab', { name: /Nova troca/ }).click();
  const who = page.getByPlaceholder(/Com quem você quer trocar/);
  await who.click();
  await page.keyboard.type('@lia');
  await expect(who).toHaveValue('@lia');
  await page.locator('.user-picker-list button', { hasText: 'Lia' }).click();
  await expect(page.locator('.trade-side').nth(1)).toContainText('Lia');
});
