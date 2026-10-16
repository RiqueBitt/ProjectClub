import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Painel da staff "Provedores de voz" (item pedido): com /api/voice/provider
// simulado (ativo = getstream, modo reserva), confere que o painel lista os
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

  // Os 3 provedores da cadeia aparecem (e nenhum dos removidos).
  for (const id of ['projectclub', 'agora', 'getstream']) {
    await expect(page.locator(`[data-testid="voice-provider-${id}"]`)).toBeVisible();
  }
  for (const id of ['livekit', 'daily', 'trtc', 'jitsi']) {
    await expect(page.locator(`[data-testid="voice-provider-${id}"]`)).toHaveCount(0);
  }
  await expect(page.locator('[data-testid="voice-provider-getstream"]')).toContainText('/ 5.000 min (24%)');
  await expect(page.locator('[data-testid="voice-provider-agora"]')).toContainText('(100%)');
  await expect(page.locator('[data-testid="voice-provider-projectclub"]')).toContainText('ilimitado');

  // Aviso de "modo reserva" no topo (ativo = Stream, não é o principal).
  await expect(panel).toContainText('modo reserva');
  await expect(panel).toContainText('Stream');

  expect(errors, 'erros de JavaScript na página').toEqual([]);
});
