import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Painel da staff "Provedores de voz" (item pedido): com /api/voice/provider
// simulado (ativo = livekit, modo reserva), confere que o painel lista os
// provedores da cadeia com barras de uso e mostra o aviso de "modo reserva"
// quando o ativo não é o principal (agora).
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

test('painel lista os provedores de voz com barras de uso e aviso de modo reserva', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/admin?tab=provedoresVoz');

  const panel = page.locator('[data-testid="voice-providers-admin"]');
  await expect(panel).toBeVisible({ timeout: 20_000 });

  // Todos os 6 provedores da cadeia aparecem.
  for (const id of ['agora', 'livekit', 'getstream', 'daily', 'trtc', 'jitsi']) {
    await expect(page.locator(`[data-testid="voice-provider-${id}"]`)).toBeVisible();
  }

  // Barra de uso com "X / Y min (Z%)" (ex.: o LiveKit ativo em 24%).
  await expect(page.locator('[data-testid="voice-provider-livekit"]')).toContainText('/ 5.000 min (24%)');
  await expect(page.locator('[data-testid="voice-provider-agora"]')).toContainText('(100%)');
  // Jitsi é ilimitado.
  await expect(page.locator('[data-testid="voice-provider-jitsi"]')).toContainText('ilimitado');
  // Daily configurado mas sem a chave.
  await expect(page.locator('[data-testid="voice-provider-daily"]')).toContainText('DAILY_API_KEY');

  // Aviso de "modo reserva" no topo (ativo = livekit, não é o principal).
  await expect(panel).toContainText('modo reserva');
  await expect(panel).toContainText('LiveKit');

  expect(errors, 'erros de JavaScript na página').toEqual([]);
});
