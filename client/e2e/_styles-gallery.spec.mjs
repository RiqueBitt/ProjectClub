import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';
// Galeria dos estilos (só roda com STYLE_SHOTS): tira foto de cada um.
test.skip(!process.env.STYLE_SHOTS, 'só com STYLE_SHOTS');
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* */ } });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
});
test('galeria', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/loja');
  await page.getByRole('button', { name: /Estilos de perfil/ }).first().click();
  await page.waitForTimeout(2500);
  const cards = page.locator('.room-card');
  const n = await cards.count();
  for (let i = 0; i < n; i += 1) {
    await cards.nth(i).locator('.room-card-art').click();
    await page.waitForTimeout(900);
    await page.locator('.room-detail-stage').screenshot({ path: `${process.env.STYLE_SHOTS}/${String(i).padStart(2, '0')}.png` });
    await page.keyboard.press('Escape');
  }
  expect(n).toBeGreaterThan(30);
});
