import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Recursos trazidos do Discord: Mural/Lista de desejos/Atividade/Estatísticas
// no perfil; lista de desejos, presentes e códigos e comparar planos na Loja.
const SHOTS = process.env.FEAT_SHOTS;
const shot = async (page, name, info) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png`, fullPage: false }); };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('theme', 'dark'); localStorage.setItem('layoutStyle', 'normal2'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* sem storage */ }
  });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

test('perfil mostra Mural, Lista de desejos, Atividade e Estatísticas', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/u/1');
  await expect(page.locator('.pxw-mural')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Jogo desde a beta, nunca enjoa.')).toBeVisible();
  await page.locator('.pxw-mural').scrollIntoViewIfNeeded();
  await shot(page, 'perfil-mural', info);
  await expect(page.locator('.pxl-item').first()).toBeVisible();
  await page.locator('.pxl-grid').scrollIntoViewIfNeeded();
  await shot(page, 'perfil-wishlist', info);
  await expect(page.getByText('Retornando após 2 meses')).toBeVisible();
  await expect(page.locator('.pxs-badge')).toHaveCount(4);
  await page.locator('.pxs-grid').scrollIntoViewIfNeeded();
  await shot(page, 'perfil-stats', info);
  await page.locator('.pxa-list').scrollIntoViewIfNeeded();
  await shot(page, 'perfil-atividade', info);
  // Editor do mural
  await page.getByRole('button', { name: 'Editar mural' }).click();
  await expect(page.getByRole('tab', { name: /Jogos em rotação/ })).toBeVisible();
  await shot(page, 'mural-editor', info);
  await page.getByRole('tab', { name: /Jogos que eu gosto/ }).click();
  await page.getByLabel('Buscar jogo').fill('terr');
  await expect(page.getByRole('button', { name: /Terraria/ })).toBeVisible();
  await shot(page, 'mural-editor-busca', info);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('loja: coração da lista de desejos, presentes e códigos, comparar planos', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/loja');
  await expect(page.locator('.shop-room .room-card').first()).toBeVisible();
  await page.getByRole('button', { name: /Molduras de avatar/ }).first().click();
  await expect(page.locator('.room-wish').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Embaralhar/ })).toBeVisible();
  await shot(page, 'loja-catalogo', info);
  await page.getByRole('button', { name: /Presentes e códigos/ }).click();
  await expect(page.getByRole('heading', { name: 'Resgatar código' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Insígnia de Presentes' })).toBeVisible();
  await shot(page, 'loja-presentes', info);
  await page.getByRole('button', { name: /Comparar planos/ }).click();
  await expect(page.locator('.room-plans')).toBeVisible();
  await shot(page, 'loja-planos', info);
  expect(errors).toEqual([]);
});

test('configurações: tema colorido, ícone, modo streamer, sons, privacidade', async ({ page }, info) => {
  test.skip(info.project.name !== 'pc', 'telas de configurações conferidas no PC');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const patches = [];
  page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/users/me/settings')) patches.push(r.postDataJSON()); });
  await page.goto('/inicio');
  await page.locator('.top-search-bar-icon-btn[title="Configurações"]').click();
  await page.getByText(/^Aparência$/).first().click();
  await expect(page.getByRole('heading', { name: 'Temas coloridos' })).toBeVisible();
  await page.getByRole('radio', { name: /Aurora/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-pc-ctheme'))).toBe('aurora');
  await page.getByRole('heading', { name: 'Temas coloridos' }).scrollIntoViewIfNeeded();
  await shot(page, 'cfg-temas', info);
  await page.getByRole('radio', { name: /Personalizado/ }).first().click();
  await expect(page.getByLabel('Cor de destaque')).toBeVisible();
  await page.getByRole('heading', { name: 'Ícone do app' }).scrollIntoViewIfNeeded();
  await page.getByRole('radio', { name: /Neon/ }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]')?.href.startsWith('data:image/png'))).toBe(true);
  await shot(page, 'cfg-icone', info);
  await page.getByRole('switch', { name: 'Ativar modo streamer' }).click();
  await expect(page.locator('.pc-streamer-badge')).toBeVisible();
  await page.waitForTimeout(800);
  expect(patches.some((p) => p.extraPrefs?.streamerMode === true && p.extraPrefs?.appIcon === 'neon')).toBe(true);
  await page.locator('.settings-modal-sidebar').getByText('Notificações', { exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Notifique-me quando…' })).toBeVisible();
  await page.getByRole('heading', { name: 'Sons', exact: true }).scrollIntoViewIfNeeded();
  await shot(page, 'cfg-notificacoes', info);
  await page.getByText(/^Voz e vídeo$/).first().click();
  await expect(page.getByRole('heading', { name: 'Perfil de entrada' })).toBeVisible();
  await page.getByRole('switch', { name: 'Determinar automaticamente' }).click();
  await expect(page.getByLabel('Limite em dB')).toBeVisible();
  await page.getByRole('heading', { name: 'Sensibilidade de entrada' }).scrollIntoViewIfNeeded();
  await shot(page, 'cfg-voz', info);
  await page.locator('.settings-modal-sidebar').getByText('Dados e privacidade', { exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Filtros de spam' })).toBeVisible();
  await page.getByRole('heading', { name: 'Filtros de spam' }).scrollIntoViewIfNeeded();
  await shot(page, 'cfg-privacidade', info);
  expect(errors).toEqual([]);
});
