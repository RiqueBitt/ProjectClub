import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Links bonitos: /canal/chat-geral em vez de /channels/<id>. O endereço
// antigo (com id) continua abrindo e troca sozinho pelo bonito.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('layoutStyle', 'normal2');
      sessionStorage.setItem('inicio-redirect-done', '1');
    } catch { /* sem storage */ }
  });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

test('endereço antigo /channels/<id> vira /canal/<nome> e abre o chat', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/channels/ch2?m=nada');
  await expect(page).toHaveURL(/\/canal\/chat-geral\?m=nada$/, { timeout: 20_000 });
  await expect(page.locator('.chat-header').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Algo deu errado')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('/canal/<nome> abre direto, sem trocar o endereço', async ({ page }) => {
  await page.goto('/canal/comandos');
  await expect(page.locator('.chat-header').first()).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/canal\/comandos$/);
});

test('/canal/<id> (link novo com id) troca pelo nome', async ({ page }) => {
  await page.goto('/canal/ch4');
  await expect(page).toHaveURL(/\/canal\/midias$/, { timeout: 20_000 });
  await expect(page.locator('.chat-header').first()).toBeVisible();
});

test('nome que não existe mostra "Link indisponível" (sem tela quebrada)', async ({ page }) => {
  await page.goto('/canal/nao-existe-esse-canal');
  await expect(page.getByText('Link indisponível')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Algo deu errado')).toHaveCount(0);
});
