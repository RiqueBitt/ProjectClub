import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Stunts da turma do login (aura, dab, floss…) e truques dos ícones dos apps.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

test('bonequinhos fazem truques aleatórios no descanso (data-stunt) com aura visível', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('.pcc-char').first()).toBeVisible();
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && seen.size < 3) {
    const names = await page.locator('.pcc-char[data-stunt]').evaluateAll((els) => els.map((e) => e.dataset.stunt));
    names.forEach((n) => seen.add(n));
    await page.waitForTimeout(250);
  }
  expect(seen.size).toBeGreaterThanOrEqual(2);
  // Cada stunt tem pose de mão/rosto própria: a aura acende quando é 'aura'.
  const aura = page.locator('.pcc-char[data-stunt="aura"] .pcc-aura').first();
  if (await aura.count()) {
    const op = await aura.evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(op)).toBeGreaterThan(0);
  }
});

test('ícones dos apps balançam/pulam sozinhos e ao passar o mouse', async ({ page }) => {
  await page.goto('/login');
  const icons = page.locator('.pc-showcase-apps img');
  await expect(icons.first()).toBeVisible();
  // Mouse: dispara na hora.
  await icons.nth(1).evaluate((el) => el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false })));
  await expect.poll(() => icons.nth(1).evaluate((el) => el.getAnimations().length), { timeout: 2000 }).toBeGreaterThan(0);
  // Sozinhos: em até 12s algum ícone (ou a logo) está animando.
  await expect.poll(async () => page.evaluate(() => [...document.querySelectorAll('.pc-showcase-apps img, .pc-auth-showcase .pc-brand-mark')].some((el) => el.dataset.stunt)), { timeout: 12000 }).toBe(true);
});

test('modo calmo: sem stunts nem truques nos ícones', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await expect(page.locator('.pcc-char').first()).toBeVisible();
  await page.waitForTimeout(9000);
  expect(await page.locator('.pcc-char[data-stunt]').count()).toBe(0);
  expect(await page.locator('.pc-showcase-apps img[data-stunt]').count()).toBe(0);
});
