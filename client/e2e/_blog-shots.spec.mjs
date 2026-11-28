import { test } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';
test.skip(!process.env.BLOG_SHOTS, 'só com BLOG_SHOTS');
for (const path of ['/blog', '/blog/efeitos-de-texto-na-loja', '/blog/politica-de-privacidade', '/termos#dados']) {
  test(`blog ${path}`, async ({ page }, info) => {
    await page.route('**/api/**', handler);
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/mock-img/**', imageHandler);
    await page.setViewportSize({ width: info.project.name === 'celular' ? 390 : 1440, height: 900 });
    await page.goto(path);
    await page.waitForTimeout(1800);
    const name = path.replace(/[^a-z]+/g, '-');
    const h = await page.evaluate(() => document.querySelector('.lp').scrollHeight);
    for (let y = 0, i = 0; y < h && i < 6; y += 900, i += 1) {
      await page.evaluate((yy) => document.querySelector('.lp').scrollTo({ top: yy, behavior: 'instant' }), y);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${process.env.BLOG_SHOTS}/${info.project.name}${name}${i}.png` });
    }
  });
}
