import { test } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';
test.skip(!process.env.AUTH_SHOTS, 'só com AUTH_SHOTS');
for (const path of ['/login', '/register', '/forgot-password', '/reset-password?token=x', '/verify-email', '/site']) {
  test(`tela ${path}`, async ({ page }, info) => {
    await page.route('**/api/**', handler);
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/mock-img/**', imageHandler);
    const w = info.project.name === 'celular' ? 390 : 1440;
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(path);
    await page.waitForTimeout(4500);
    const name = path.replace(/[/?=]/g, '_').replace(/^_/, '') || 'root';
    await page.screenshot({ path: `${process.env.AUTH_SHOTS}/${info.project.name}-${name}.png`, fullPage: path !== '/site' });
  });
}
