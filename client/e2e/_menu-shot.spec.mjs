import { test } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';
test.skip(!process.env.MENU_SHOT, 'só com MENU_SHOT');
test('menu', async ({ page }) => {
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/site', '/blog']) {
    await page.goto(path);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${process.env.MENU_SHOT}${path.replace('/', '-')}-fechado.png` });
    await page.locator('.lp-burger').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${process.env.MENU_SHOT}${path.replace('/', '-')}-aberto.png` });
  }
});
