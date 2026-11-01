import { test, expect } from '@playwright/test';
import { handler, imageHandler, ME } from './mock-api.mjs';

// Mudancinhas: um botão só pra emoji/figurinha/GIF, número vermelho de não
// lidas no canal, bolinha "novo" em Novidades (some ao abrir), insígnias no
// topo do perfil completo e a barra do tema Windows 2000 sem vazar.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('theme', 'dark'); localStorage.setItem('layoutStyle', 'normal2'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* ok */ }
  });
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('barra de mensagem: um botão só abre emoji, figurinhas e GIFs em abas', async ({ page }) => {
  await page.route('**/api/**', handler);
  await page.goto('/channels/ch2');
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.chat-gif-btn')).toHaveCount(0);
  const btn = page.getByRole('button', { name: 'Emojis, figurinhas e GIFs' });
  await expect(btn).toHaveCount(1);
  await btn.click();
  const picker = page.locator('.emoji-picker, [class*="emoji-picker"]').first();
  await expect(picker).toBeVisible();
  await expect(page.getByRole('button', { name: 'GIFs', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'GIFs', exact: true }).click();
  await page.keyboard.press('Escape'); // fecha (no celular a folha cobre o botão)
  await expect(page.getByPlaceholder('Buscar GIFs...')).toHaveCount(0);
  await btn.click(); // reabre na última aba usada
  await expect(page.getByPlaceholder('Buscar GIFs...')).toBeVisible();
});

test('canal com mensagens novas mostra o número vermelho; Novidades mostra "novo" e apaga ao abrir', async ({ page }) => {
  const seen = [];
  let anuncios = 3;
  await page.route('**/api/**', (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname.replace(/^\/api/, '');
    if (p === '/community/channels/read-states') {
      return json(route, { states: { ch3: { lastMessageAt: new Date().toISOString(), myReadAt: null, unreadMentions: 0, lastMentionAt: null, unreadCount: 7 }, ch4: { lastMessageAt: new Date().toISOString(), myReadAt: null, unreadMentions: 2, lastMentionAt: new Date().toISOString(), unreadCount: 130 } } });
    }
    if (p === '/section-badges' && req.method() === 'GET') return json(route, { sections: { anuncios: { count: anuncios }, eventos: { count: 0 }, colecoes: { count: 0 } } });
    if (/^\/section-badges\/[a-z]+\/seen$/.test(p)) { seen.push(p); anuncios = 0; return json(route, { ok: true }); }
    if (p === '/anuncios') return json(route, { announcements: [], canManage: false });
    return handler(route);
  });
  await page.goto('/channels/ch2');
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 20_000 });
  const isPhone = (page.viewportSize()?.width || 1440) < 700;
  if (isPhone) return; // no celular a lista de canais fica atrás do menu; a lógica é a mesma
  await expect(page.locator('.unread-count-badge', { hasText: '7' })).toBeVisible();
  await expect(page.locator('.unread-count-badge.has-mention', { hasText: '99+' })).toBeVisible();
  // Novidades (antes o canal em destaque "Anúncios e Eventos") fica no menu principal.
  const item = page.locator('.n2-nav-item[href="/anuncios"]');
  const novo = item.locator('.n2-nav-badge');
  await expect(novo).toHaveText('3');
  await item.click();
  await expect(page).toHaveURL(/\/anuncios/);
  await expect.poll(() => seen).toContain('/section-badges/anuncios/seen');
  await expect(novo).toHaveCount(0);
});

test('perfil completo: até 4 insígnias no topo e barra do Windows 2000 dentro do cartão', async ({ page }) => {
  const keys = ['PLATFORM_OWNER', 'STAFF', 'ADMIN', 'BUG_HUNTER', 'BETA_TESTER', 'NEWCOMER'];
  const profile = {
    user: { ...ME, accountLevel: 7, profileStyle: 'win2000', bio: 'oi' }, levelProgress: 40, mutualFriends: [],
    badges: keys.map((k, i) => ({ id: `b${i}`, key: k, name: k, icon: '⭐', iconUrl: `/badges/${k}.png`, rarity: 'RARE' })),
  };
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (p === `/users/${ME.id}`) return json(route, profile);
    if (p === `/users/${ME.id}/summary`) {
      // Pega o resto do resumo do mock e troca só o perfil.
      let body;
      handler({ request: () => route.request(), fulfill: (o) => { body = o.body; } });
      return json(route, { ...JSON.parse(body), profile });
    }
    return handler(route);
  });
  await page.goto('/channels/ch2');
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 20_000 });
  await page.evaluate((id) => { window.history.pushState({}, '', `/profile/${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, ME.id);
  const head = page.locator('.pfx-head-badges');
  await page.locator('.profile-top-row').waitFor({ timeout: 8000 }).catch(() => {});
  if (!(await head.count())) {
    // Abre pelo próprio avatar da barra do usuário, se a rota não existir.
    await page.goto('/channels/ch2');
    await page.locator('.member-row').first().click();
    await page.getByRole('button', { name: /Ver perfil completo/ }).click();
  }
  await expect(head).toBeVisible({ timeout: 15_000 });
  await expect(head.locator('.pfx-head-badge:not(.more)')).toHaveCount(4);
  await expect(head.locator('.pfx-head-badge.more')).toHaveText('+2');
  await expect(head.locator('svg[data-badge-icon="crown"]')).toHaveCount(1);
  // Badges dentro da tela (canto de cima à direita).
  const box = await head.boundingBox();
  const vw = page.viewportSize().width;
  expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
  // Barra de título do Windows 2000: os botõezinhos ficam na própria barra.
  const bar = await page.evaluate(() => {
    const el = document.querySelector('.pstyle-win2000');
    if (!el) return null;
    const cs = getComputedStyle(el, '::before');
    const after = getComputedStyle(el, '::after');
    return { bg: cs.backgroundImage, width: parseFloat(cs.width), host: parseFloat(getComputedStyle(el).width), afterBg: after.backgroundImage };
  });
  expect(bar).not.toBeNull();
  expect(bar.bg).toContain('linear-gradient');
  expect(bar.afterBg).toBe('none');
  expect(bar.width).toBeLessThanOrEqual(bar.host + 1);
});
