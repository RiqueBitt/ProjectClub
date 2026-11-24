import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Painel da Equipe: "Precisa de você" em ordem de urgência, grupos
// recolhíveis com contagem, Fixados (botão Fixar) e Recentes.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* */ } });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

test('visão geral em fila, grupos recolhíveis, fixar e recentes', async ({ page }, testInfo) => {
  await page.goto('/admin');
  const todo = page.locator('.staff-todo-list');
  await expect(todo).toBeVisible({ timeout: 20_000 });
  // Denúncia (mais urgente) vem antes das inscrições, mesmo com menos itens.
  await expect(todo.locator('.staff-todo-item').first()).toContainText('Denúncias');
  await expect(todo).toContainText('Inscrições');

  // Grupos começam recolhidos (na visão geral) e mostram as pendências.
  const pessoas = page.locator('.staff-nav-group', { hasText: 'Pessoas' });
  await expect(pessoas.locator('.staff-nav-item')).toHaveCount(0);
  await expect(pessoas.locator('.staff-count-group')).toHaveText('3');
  // No celular as ferramentas ficam numa gaveta (botão ☰ ao lado do título).
  if (testInfo.project.name === 'celular') await page.getByRole('button', { name: 'Abrir ferramentas' }).click();
  await pessoas.locator('.staff-nav-group-toggle').click();
  await expect(pessoas.locator('.staff-nav-item', { hasText: 'Inscrições' })).toBeVisible();

  // Abre uma ferramenta: entra nos Recentes e dá pra fixar.
  await pessoas.locator('.staff-nav-item', { hasText: 'Insígnias' }).click();
  const pin = page.locator('.staff-pin-btn');
  await expect(pin).toHaveText(/Fixar/);
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  const pinned = page.locator('.staff-nav-pins .staff-nav-item');
  await expect(pinned).toHaveCount(1);

  // Outra ferramenta vai pros Recentes; a fixada não se repete lá.
  await page.goto('/admin?tab=logs');
  await expect(page.locator('.staff-nav-recent .staff-nav-item').first()).toBeVisible();
  await expect(page.locator('.staff-nav-pins .staff-nav-item')).toHaveCount(1);
  // O grupo da ferramenta aberta fica aberto sozinho.
  await expect(page.locator('.staff-nav-group.is-open', { hasText: 'Moderação' })).toHaveCount(1);
});
