import { test } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';
test.skip(!process.env.STYLE_SHOTS || !process.env.MOCK_PSTYLE, 'só com STYLE_SHOTS e MOCK_PSTYLE');
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* */ } });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
});
test('miniperfil e perfil', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/channels/ch2');
  await page.locator('.member-row').first().click();
  const card = page.locator('.mini-profile-card');
  await card.waitFor();
  await page.waitForTimeout(1500);
  await card.screenshot({ path: `${process.env.STYLE_SHOTS}/real-${process.env.MOCK_PSTYLE}-mini.png` });
  await card.getByRole('button', { name: /Ver perfil completo/ }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${process.env.STYLE_SHOTS}/real-${process.env.MOCK_PSTYLE}-full.png` });
});
