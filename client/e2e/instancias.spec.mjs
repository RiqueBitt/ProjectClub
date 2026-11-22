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
