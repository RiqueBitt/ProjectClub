import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Loja — sala branca: abre clara mesmo com o app no tema escuro, mostra
// destaques/novidades/exclusivos, filtra, abre o detalhe com prévia e
// pede confirmação com o preço final antes de comprar. Sem vazar na
// horizontal no PC nem no celular.
const SHOTS = process.env.SHOP_SHOTS; // pasta pra salvar prints (opcional)

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

const shot = async (page, name, info) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png` }); };

test('loja segue o tema, com vitrine, filtros, detalhe e confirmação', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/loja');
  await expect(page.locator('.shop-room .room-card').first()).toBeVisible();

  // A Loja segue o tema escolhido: no tema escuro o fundo é escuro.
  const bg = await page.locator('.shop-room').evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g).map(Number);
  expect((r + g + b) / 3).toBeLessThan(80);
  expect(await page.evaluate(() => document.documentElement.dataset.theme || document.body.dataset.theme || '')).not.toBe('light');

  await expect(page.getByRole('heading', { name: 'Novidades' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Exclusivos de apoio' })).toBeVisible();
  await shot(page, 'inicio', info);

  // Categoria + filtro de disponibilidade.
  await page.locator('.room-nav-item', { hasText: 'Molduras de avatar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Molduras de avatar' })).toBeVisible();
  await page.locator('.room-chip', { hasText: 'Adquiridos' }).click();
  await expect(page.locator('.room-card')).toHaveCount(1);
  await page.locator('.room-chip', { hasText: 'Tudo' }).click();
  await shot(page, 'molduras', info);

  // Detalhe com prévia + modos de visualização.
  await page.locator('.room-card', { hasText: 'Brasa' }).locator('.room-card-art').click();
  const dialog = page.getByRole('dialog', { name: 'Brasa' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Mini perfil' }).click();
  await expect(dialog.getByRole('tab', { name: 'Mini perfil' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.locator('.shop-mock-mini')).toBeVisible();
  await expect(dialog.locator('.shop-mock-mini img').first()).toBeVisible();
  await shot(page, 'detalhe', info);

  // Confirmação mostra preço e saldo antes de cobrar.
  await dialog.locator('.room-detail-price.coins').getByRole('button', { name: 'Comprar' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Confirmar compra' });
  await expect(confirm).toBeVisible();
  await expect(confirm.locator('.room-receipt .total')).toContainText('450');
  await shot(page, 'confirmar', info);
  await confirm.getByRole('button', { name: 'Cancelar' }).click();
  await expect(confirm).toBeHidden();

  // Sem rolagem lateral.
  const overflow = await page.locator('.room-main').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('busca encontra itens por nome e descrição', async ({ page }) => {
  await page.goto('/loja');
  await page.getByRole('textbox', { name: 'Buscar na loja' }).fill('neon');
  await expect(page.getByRole('heading', { name: /Resultados para/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Buscar na loja' }).fill('fogo');
  await expect(page.locator('.room-card', { hasText: 'Brasa' })).toBeVisible();
});

test('painel: gerenciamento de apoio pede motivo e confirma antes de remover', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/admin?tab=apoio');
  await expect(page.locator('.sup-list button').first()).toBeVisible();
  await page.locator('.sup-list button', { hasText: 'Lia' }).click();
  await page.getByRole('radio', { name: 'Membro' }).click();
  const btn = page.locator('.sup-editor .shop-btn.danger');
  await btn.click();
  await expect(page.locator('.sup-editor .shop-notice.bad')).toContainText('motivo');
  await page.getByPlaceholder(/assinatura encerrada/).fill('Assinatura encerrada');
  await btn.click();
  await expect(page.getByRole('alert')).toContainText('Remover todo o apoio');
  await shot(page, 'painel-apoio', info);
  await page.getByRole('button', { name: 'Confirmar remoção' }).click();
  await expect(page.getByRole('status')).toContainText('agora é Membro');
  expect(errors).toEqual([]);
});
