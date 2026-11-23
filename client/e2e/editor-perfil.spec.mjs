import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Editor de perfil (estilo Discord): saiu das Configurações; abre pela sua
// foto (canto inferior esquerdo) ou pelo seu perfil, com prévia ao vivo.
test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('layoutStyle', 'normal2'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* */ } });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

test('abre pela foto lá embaixo, mostra a prévia ao vivo e fecha com Esc', async ({ page }) => {
  await page.goto('/inicio');
  await expect(page.locator('.home-hero')).toBeVisible({ timeout: 20_000 });

  // Configurações não têm mais as abas de perfil.
  await page.locator('.top-more-btn').click();
  await page.locator('.top-more-menu').getByRole('menuitem', { name: 'Configurações' }).click();
  await expect(page.locator('.settings-modal-layout')).toBeVisible();
  await expect(page.locator('.settings-modal-sidebar-item', { hasText: 'Perfil Geral' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.settings-modal-layout')).toHaveCount(0);

  await page.locator('.usb-identity').click();
  await page.getByRole('menuitem', { name: 'Editar perfil' }).click();
  const box = page.locator('.pe-box');
  await expect(box).toBeVisible();
  await expect(page.locator('.pe-full .pf-embedded .profile-modal-box')).toBeVisible({ timeout: 15_000 });

  // Digitou o nome: a prévia muda na hora (antes de salvar).
  const name = page.locator('.pe-side input[name="displayName"]');
  await name.fill('Nome Novo Prévia');
  await expect(page.locator('.pe-full')).toContainText('Nome Novo Prévia');

  await page.getByRole('tab', { name: 'Miniperfil' }).click();
  await expect(page.locator('.pe-mini .mini-profile-preview')).toContainText('Nome Novo Prévia');

  // Outras partes do perfil pelo seletor do topo.
  await page.locator('.pe-section-btn').click();
  await page.getByRole('option', { name: /Ordem das seções/ }).click();
  await expect(page.locator('.pe-section-btn')).toContainText('Ordem das seções');

  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);
});
