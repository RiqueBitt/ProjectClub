import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Otimização: perfil já visto abre NA HORA (cache no cliente) e passar o
// mouse num avatar já busca o perfil antes do clique. Aqui o servidor de
// mentira demora 1,5 s pra responder /api/users/:id — se o card mostrasse
// "Carregando..." até a resposta, o teste pegaria.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('theme', 'dark'); localStorage.setItem('layoutStyle', 'normal2'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* */ }
  });
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.profileHits = 0;
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (/^\/api\/users\/[^/]+$/.test(p) && !p.endsWith('/me')) {
      page.profileHits += 1;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return handler(route);
  });
});

test('miniperfil: passar o mouse já busca, e reabrir é instantâneo', async ({ page }, info) => {
  test.skip(info.project.name !== 'pc', 'hover só no PC');
  await page.goto('/channels/ch2');
  const avatar = page.locator('.message .avatar.clickable').first();
  await expect(avatar).toBeVisible({ timeout: 20_000 });
  // Passar o mouse dispara a busca antes do clique.
  await avatar.hover();
  await expect.poll(() => page.profileHits, { timeout: 3000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1700); // a resposta lenta chega
  await avatar.click();
  const card = page.locator('.mini-profile-card');
  await expect(card).toBeVisible();
  // Já tem o perfil: nada de "Carregando..." mesmo com o servidor lento.
  await expect(card.getByText('Carregando...')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  // Reabrir: instantâneo (o pedido de atualização vai por trás).
  await avatar.click();
  await expect(card).toBeVisible();
  await expect(card.getByText('Carregando...')).toHaveCount(0);
});
