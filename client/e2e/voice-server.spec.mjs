import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Voz só com o servidor de mídia próprio: o painel da staff tem "Servidor de
// voz" (não existe mais "Provedores de voz"), e uma resposta antiga de
// /api/voice/join apontando pra um provedor removido (Jitsi) NÃO carrega SDK
// nenhum de fora — só mostra o aviso de que não deu pra conectar.
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

test('painel da staff mostra o "Servidor de voz" com as chaves (segredos mascarados)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/admin?tab=servidorVoz');
  const panel = page.locator('[data-testid="voice-server-admin"]');
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="voice-server-status"]')).toContainText('configurado');
  await expect(panel).toContainText('URL do servidor de mídia');
  await expect(panel).toContainText('Servidores TURN');
  await expect(panel.locator('input[placeholder="••••1234"]')).toHaveAttribute('type', 'password');
  await expect(page.getByText('Provedores de voz')).toHaveCount(0);

  expect(errors, 'erros de JavaScript na página').toEqual([]);
});

test('resposta de provedor removido (jitsi) não carrega SDK externo e avisa que não conectou', async ({ page }) => {
  const external = [];
  page.on('request', (req) => {
    if (/external_api\.js|meet\.jit\.si|livekit/i.test(req.url())) external.push(req.url());
  });
  await page.route('**/api/voice/join**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ provider: 'jitsi', jitsi: { domain: 'meet.jit.si', room: 'sala-velha', jwt: null } }),
  }));

  await page.goto('/channels/v1');
  const joinBtn = page.getByRole('button', { name: /Entrar na chamada/ });
  await expect(joinBtn).toBeVisible({ timeout: 20_000 });
  await joinBtn.click();

  await expect(page.getByText(/Não foi possível conectar à chamada de voz/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/modo reserva/i)).toHaveCount(0);
  expect(external, 'nenhum SDK de provedor externo').toEqual([]);
});
