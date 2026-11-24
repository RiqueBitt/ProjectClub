import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Atividades da call no app Android: página transparente com os componentes
// do PC (pages/embed/CallActivitiesEmbed.jsx), comandada pela ponte window.PcCall.
test.use({ viewport: { width: 412, height: 780 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__layouts = [];
    window.PcCall = { layout: (j) => window.__layouts.push(JSON.parse(j)) };
  });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

test('menu Atividades (com Soundboard), dados e avisos de espaço pro app', async ({ page }) => {
  await page.goto('/embed/atividades-call/vc1');
  await page.waitForFunction(() => !!window.__pcActivities, null, { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => window.__layouts.at(-1)?.mode)).toBe('hidden');
  // Fundo transparente (a tela nativa da chamada aparece por baixo).
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

  await page.evaluate(() => window.__pcActivities.open('menu'));
  const menu = page.getByRole('menu', { name: 'Atividades' });
  await expect(menu).toBeVisible();
  for (const n of ['YouTube - Assistir juntos', 'Música - Ouvir juntos', 'Rolar dados', 'Soundboard']) {
    await expect(menu.getByRole('menuitem', { name: new RegExp(n) })).toBeVisible();
  }
  await expect.poll(() => page.evaluate(() => window.__layouts.at(-1)?.mode)).toBe('full');

  await menu.getByRole('menuitem', { name: /Soundboard/ }).click();
  await expect(page.getByRole('dialog', { name: 'Soundboard' })).toBeVisible();
  await page.evaluate(() => window.__pcActivities.close());
  await expect.poll(() => page.evaluate(() => window.__layouts.at(-1)?.mode)).toBe('hidden');

  await page.evaluate(() => window.__pcActivities.open('dice'));
  await expect(page.locator('.dice-picker, [class*="dice-pick"]').first()).toBeVisible();
});
