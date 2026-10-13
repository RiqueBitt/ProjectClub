import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Lote C — "Enviar depois" (agendar mensagem), "Lembrar-me" (lembrete a
// partir de uma mensagem) e a lista de lembretes em Notificações.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('theme', 'dark'); localStorage.setItem('layoutStyle', 'normal2'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* ok */ }
  });
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

test('agendar mensagem pelo menu "+" → chip "1 mensagem agendada" com cancelar', async ({ page }) => {
  const posted = [];
  let scheduledList = [];
  await page.route('**/api/**', (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname.replace(/^\/api/, '');
    if (p === '/messages/scheduled' && req.method() === 'POST') {
      const body = req.postDataJSON(); posted.push(body);
      const row = { id: 's1', ...body, status: 'PENDING', createdAt: new Date().toISOString() };
      scheduledList = [row];
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ scheduled: row }) });
    }
    if (p === '/messages/scheduled' && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ scheduled: scheduledList }) });
    if (p === '/messages/scheduled/s1' && req.method() === 'DELETE') { scheduledList = []; return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    return handler(route);
  });
  await page.goto('/channels/ch2');
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 20_000 });
  await page.locator('.message-input').click();
  await page.keyboard.type('bom dia pessoal');
  await page.locator('.attach-plus-btn').click();
  await page.getByRole('button', { name: /Enviar depois/ }).click();
  await expect(page.locator('.schedule-modal')).toBeVisible();
  await expect(page.locator('.schedule-preview')).toContainText('bom dia pessoal');
  await page.locator('.schedule-preset', { hasText: 'Em 1 hora' }).click();
  await expect(page.locator('.schedule-modal')).toHaveCount(0);
  expect(posted).toHaveLength(1);
  expect(posted[0].channelId).toBe('ch2');
  expect(posted[0].content).toBe('bom dia pessoal');
  const diffMin = (new Date(posted[0].sendAt) - Date.now()) / 60000;
  expect(diffMin).toBeGreaterThan(55); expect(diffMin).toBeLessThan(65);
  await expect(page.locator('.notice-toast-stack')).toContainText('agendada');
  // Composer esvaziou e o chip apareceu.
  await expect(page.locator('.message-input')).toHaveText('');
  const chip = page.locator('.scheduled-chip');
  await expect(chip).toContainText('1 mensagem agendada');
  await chip.click();
  await expect(page.locator('.scheduled-list li')).toHaveCount(1);
  await page.locator('.scheduled-list button[title="Cancelar envio"]').click();
  await expect(chip).toHaveCount(0);
});

test('botão direito no Enviar abre "Enviar depois"', async ({ page }) => {
  await page.route('**/api/**', handler);
  await page.goto('/channels/ch2');
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 20_000 });
  await page.locator('.message-input').click();
  await page.keyboard.type('até mais tarde');
  await page.locator('.chat-send-btn').click({ button: 'right' });
  await expect(page.locator('.schedule-modal')).toBeVisible();
});

test('"Lembrar-me" no menu da mensagem cria o lembrete com link e id da mensagem', async ({ page }) => {
  const posted = [];
  await page.route('**/api/**', (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname.replace(/^\/api/, '');
    if (p === '/reminders' && req.method() === 'POST') {
      posted.push(req.postDataJSON());
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ reminder: { id: 'r1', ...posted[0], dueAt: new Date(Date.now() + 3600000).toISOString() } }) });
    }
    if (p === '/reminders/preview') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dueAt: new Date(Date.now() + 7200000).toISOString() }) });
    return handler(route);
  });
  await page.goto('/channels/ch2');
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 20_000 });
  const first = page.locator('.message').first();
  await first.hover();
  await first.locator('.message-hover-action[title="Mais opções"]').click();
  await page.getByRole('menuitem', { name: /Lembrar-me/ }).or(page.locator('button', { hasText: 'Lembrar-me' })).first().click();
  await expect(page.locator('.schedule-modal')).toBeVisible();
  await expect(page.locator('#reminder-text')).not.toHaveValue('');
  // Texto livre com prévia antes de confirmar.
  await page.locator('#reminder-when').fill('em 2h');
  await expect(page.locator('.schedule-custom small')).toContainText('Vou te lembrar');
  await page.getByRole('button', { name: 'Lembrar', exact: true }).click();
  await expect(page.locator('.schedule-modal')).toHaveCount(0);
  expect(posted).toHaveLength(1);
  expect(posted[0].when).toBe('em 2h');
  expect(posted[0].link).toBe('/channels/ch2');
  expect(posted[0].messageId).toBeTruthy();
  await expect(page.locator('.notice-toast-stack')).toContainText('Vou te lembrar');
});

test('Notificações lista lembretes marcados e permite cancelar', async ({ page }) => {
  let active = [{ id: 'r1', text: 'responder a Lia', link: '/channels/ch2', messageId: 'm1', dueAt: new Date(Date.now() + 3600000).toISOString(), firedAt: null, createdAt: new Date().toISOString() }];
  await page.route('**/api/**', (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname.replace(/^\/api/, '');
    if (p === '/reminders' && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active, fired: [] }) });
    if (p === '/reminders/r1' && req.method() === 'DELETE') { active = []; return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    return handler(route);
  });
  await page.goto('/notifications');
  const sec = page.locator('.nt-reminders');
  await expect(sec).toBeVisible({ timeout: 20_000 });
  await expect(sec).toContainText('responder a Lia');
  await sec.getByRole('button', { name: 'Cancelar' }).click();
  await expect(sec).toHaveCount(0);
});
