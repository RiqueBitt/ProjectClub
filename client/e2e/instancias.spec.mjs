import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Instâncias: seletor ao lado de "Comunidade" no topo troca as categorias e
// canais; o Painel da Equipe → Gerenciamento de instâncias libera pessoas.
const INSTANCES = [
  { id: 'publica', name: 'Pública', icon: '🌎', isPublic: true },
  { id: 'amigos', name: 'Amigos', icon: '🤝', isPublic: false },
  { id: 'empresarial', name: 'Empresarial', icon: '💼', isPublic: false },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* */ } });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

test('troca de instância pelo seletor do topo e mostra só os canais dela', async ({ page }) => {
  let current = 'publica';
  const puts = [];
  // Sem pacote de abertura: o app busca /community direto (rota abaixo).
  await page.route('**/api/bootstrap**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/community', async (route) => {
    // Resposta do mock geral, com as instâncias por cima.
    let raw;
    await handler({ request: () => route.request(), fulfill: (o) => { raw = o.body; } });
    const body = JSON.parse(raw);
    const amigos = current === 'amigos';
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ...body,
        categories: amigos
          ? [{ id: 'cat-amg', name: 'Só os amigos', position: 0, instanceId: 'amigos', channels: [{ id: 'ch-amg', name: 'papo-dos-amigos', type: 'TEXT', categoryId: 'cat-amg', instanceId: 'amigos', position: 0 }] }]
          : body.categories,
        community: { ...body.community, instance: current, instances: INSTANCES },
      }),
    });
  });
  await page.route('**/api/community/instance', async (route) => {
    const { instanceId } = route.request().postDataJSON();
    puts.push(instanceId);
    current = instanceId;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ instance: instanceId }) });
  });

  await page.goto('/');
  const btn = page.locator('.instance-switcher-btn');
  await expect(btn).toBeVisible({ timeout: 20_000 });
  await expect(btn).toContainText('Pública');
  await btn.click();
  const menu = page.getByRole('listbox', { name: 'Escolher instância' });
  await expect(menu.getByRole('option')).toHaveCount(3);
  await menu.getByRole('option', { name: /Amigos/ }).click();

  await expect(btn).toContainText('Amigos');
  expect(puts).toEqual(['amigos']);
  await expect(page.getByText('papo-dos-amigos').first()).toBeVisible();
  await expect(btn).toHaveClass(/is-private/);
});

test('painel: gerenciamento de instâncias lista Amigos e Empresarial e libera alguém', async ({ page }) => {
  const added = [];
  let members = [];
  await page.route('**/api/admin/instances**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'POST' && url.pathname.endsWith('/members')) {
      const { userId } = req.postDataJSON();
      added.push(userId);
      members = [{ user: { id: userId, username: 'amigo', displayName: 'Amigo' }, addedAt: new Date().toISOString() }];
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ member: members[0] }) });
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        public: { id: 'publica', name: 'Pública', icon: '🌎', isPublic: true, categories: 4, channels: 12 },
        instances: [
          { id: 'amigos', name: 'Amigos', icon: '🤝', position: 1, categories: 0, channels: 0, members },
          { id: 'empresarial', name: 'Empresarial', icon: '💼', position: 2, categories: 0, channels: 0, members: [] },
        ],
      }),
    });
  });

  await page.goto('/admin?tab=instancias');
  await expect(page.getByRole('heading', { name: 'Gerenciamento de instâncias' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.inst-card', { hasText: 'Amigos' })).toBeVisible();
  await expect(page.locator('.inst-card', { hasText: 'Empresarial' })).toBeVisible();
  await expect(page.locator('.inst-card.active')).toContainText('Amigos');

  // Escolhe alguém no seletor de pessoas e libera.
  const firstOption = page.locator('.inst-add-picker').getByRole('option').first();
  await expect(firstOption).toBeVisible({ timeout: 15_000 });
  await firstOption.click();
  await page.getByRole('button', { name: 'Liberar acesso' }).click();
  await expect.poll(() => added.length).toBe(1);
  await expect(page.locator('.inst-members li')).toHaveCount(1);
});

test('lista de membros: fecha pelo X do cabeçalho e reabre pela setinha', async ({ page }) => {
  await page.goto('/');
  const list = page.getByRole('complementary', { name: 'Membros' });
  await expect(list).toBeVisible({ timeout: 20_000 });
  await expect(list.locator('.members-list-title')).toContainText('Membros');
  await list.getByRole('button', { name: 'Fechar lista de membros' }).click();
  await expect(list).toBeHidden();
  await page.getByRole('button', { name: 'Mostrar painel lateral' }).click();
  await expect(page.getByRole('complementary', { name: 'Membros' })).toBeVisible();
});

test('barra do topo: só a barra de busca, sem lupa solta e sem "Ctrl K"', async ({ page }, testInfo) => {
  await page.goto('/');
  const bar = page.locator('.top-search-bar');
  await expect(bar).toBeVisible({ timeout: 20_000 });
  await expect(bar.locator('.top-search-bar-kbd')).toHaveCount(0);
  if (testInfo.project.name === 'pc') {
    await expect(bar.locator('.top-search-bar-form')).toBeVisible();
    await expect(bar.locator('.top-search-mobile-btn')).toBeHidden();
  } else {
    // No celular a barra não cabe: a lupa continua sendo o jeito de buscar.
    await expect(bar.locator('.top-search-mobile-btn')).toBeVisible();
  }
});

test('BLACKOUT: botão só nos destaques da instância BLACKOUT e abre o compêndio', async ({ page }) => {
  let current = 'publica';
  const list = [...INSTANCES, { id: 'blackout', name: 'BLACKOUT', icon: '🎲', isPublic: false }];
  await page.route('**/api/bootstrap**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/community', async (route) => {
    let raw;
    await handler({ request: () => route.request(), fulfill: (o) => { raw = o.body; } });
    const body = JSON.parse(raw);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...body, community: { ...body.community, instance: current, instances: list } }) });
  });
  await page.route('**/api/community/instance', async (route) => {
    current = route.request().postDataJSON().instanceId;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ instance: current }) });
  });
  let sessions = 0;
  await page.route('**/api/blackout/session', (r) => { sessions += 1; return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"url":"/blackout/"}' }); });
  await page.route(/\/blackout\/$/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!DOCTYPE html><title>BLACKOUT</title><h1 id="bo">Compêndio BLACKOUT</h1>' }));

  await page.goto('/');
  const btn = page.locator('.instance-switcher-btn');
  await expect(btn).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.featured-channels')).toBeVisible();
  await expect(page.locator('.featured-blackout')).toHaveCount(0);

  await btn.click();
  await page.getByRole('listbox', { name: 'Escolher instância' }).getByRole('option', { name: /BLACKOUT/ }).click();
  const bo = page.locator('.featured-blackout');
  await expect(bo).toBeVisible();
  await bo.click();
  await expect(page).toHaveURL(/\/compendio-blackout$/);
  await expect.poll(() => sessions).toBe(1);
  await expect(page.frameLocator('iframe.blackout-frame').locator('#bo')).toHaveText('Compêndio BLACKOUT');
});
