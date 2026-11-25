import { test } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';
test.skip(!process.env.LP_SHOTS, 'só com LP_SHOTS');
test('landing', async ({ page }, info) => {
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  const w = info.project.name === 'celular' ? 390 : 1440;
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto('/site');
  await page.waitForTimeout(2500);
  const h = await page.evaluate(() => document.querySelector('.lp').scrollHeight);
  for (let y = 0, i = 0; y < h && i < 14; y += 900, i += 1) {
    await page.evaluate((yy) => { document.querySelector('.lp').scrollTo({ top: yy, behavior: 'instant' }); }, y);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${process.env.LP_SHOTS}/${info.project.name}-${String(i).padStart(2, '0')}.png` });
  }
});
