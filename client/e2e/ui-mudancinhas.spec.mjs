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

test('canal: bolinha vermelha só com menção ou resposta (mensagem comum não acende); Central mostra "novo" e apaga ao abrir', async ({ page }) => {
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
  // ch4 tem 2 menções/respostas pra mim (de 130 mensagens novas): "@2" em vermelho.
  const red = page.locator('.unread-count-badge');
  await expect(red).toHaveCount(1);
  await expect(red).toHaveClass(/has-mention/);
  await expect(red).toHaveText('@2');
  // ch3 tem 7 mensagens novas, nenhuma pra mim: sem vermelho nenhum.
  await expect(page.locator('.unread-count-badge', { hasText: '7' })).toHaveCount(0);
  // Novidades entrou na Central (canal em destaque no topo da lista): a
  // bolinha soma Anúncios + Eventos; abrir a Central marca como visto.
  const novo = page.locator('.featured-inicio .section-new-badge');
  await expect(novo).toHaveText('3');
  await expect(page.locator('.featured-inicio')).toContainText('Central');
  await page.locator('.featured-inicio').click();
  await expect(page).toHaveURL(/\/inicio/);
  await expect.poll(() => seen).toContain('/section-badges/anuncios/seen');
  await expect(novo).toHaveCount(0);
});

test('menu da mensagem enxuto: reações, 4 ações rápidas e o resto guardado em submenus', async ({ page }, testInfo) => {
  await page.route('**/api/**', handler);
  await page.goto('/channels/ch2');
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 20_000 });
  await page.locator('.message', { hasText: 'alguém pra call' }).first().click({ button: 'right' });
  const menu = page.locator('.context-menu.cm-v2').first();
  await expect(menu).toBeVisible();
  // Uma fileira de botões pequenos pras ações do dia a dia.
  await expect(menu.locator('.cm-actions .cm-action')).toHaveText(['Responder', 'Reagir', 'Copiar', 'Encaminhar']);
  // Antes eram ~20 linhas de uma vez, ocupando a tela toda.
  expect(await menu.locator('.cm-item').count()).toBeLessThanOrEqual(7);
  const box = await menu.boundingBox();
  expect(box.height).toBeLessThan(page.viewportSize().height * 0.7);
  // Nada sumiu: o resto está em "Mais ações" e no submenu de quem escreveu.
  // (No PC o submenu abre ao lado; no celular a folha troca de conteúdo.)
  const celular = testInfo.project.name === 'celular';
  const painel = () => (celular ? menu : page.locator('.cm-submenu'));
  await menu.getByRole('menuitem', { name: 'Mais ações' }).click();
  for (const nome of ['Lembrar-me', 'Marcar como não lida', 'Copiar link da mensagem']) {
    await expect(painel().getByRole('menuitem', { name: nome })).toBeVisible();
  }
  if (celular) await menu.locator('.cm-back').click();
  await menu.getByRole('menuitem', { name: 'Lia', exact: true }).click();
  for (const nome of ['Ver perfil', 'Copiar ID do usuário']) {
    await expect(painel().getByRole('menuitem', { name: nome })).toBeVisible();
  }
  // Ação rápida funciona e fecha o menu.
  if (celular) await menu.locator('.cm-back').click();
  await menu.locator('.cm-action', { hasText: 'Responder' }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.chat-reply-banner')).toBeVisible();
});

test('perfil completo: até 4 insígnias no topo e barra do Windows 2000 dentro do cartão', async ({ page, isMobile }) => {
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
    // No celular a lista de membros é uma gaveta: abre pelo botão de pessoas.
    if (isMobile) await page.locator('.mobile-members-toggle').click();
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

test('perfil completo organizado: números e ações numa faixa, menu Mais e o resto em abas', async ({ page }, info) => {
  const other = { id: '5', publicId: '100000005', username: 'lia', displayName: 'Lia', avatarUrl: null, status: 'ONLINE', platformRole: 'USER', bio: 'Oi, eu sou a Lia.', accountLevel: 4, createdAt: '2025-03-10T12:00:00.000Z', youtubeUrl: 'https://youtube.com/@lia' };
  const profile = { user: other, levelProgress: 40, badges: [], mutualFriends: [{ id: '2', displayName: 'Loritta', username: 'loritta' }], likeCount: 3, dislikeCount: 1, myVote: 0, totalUps: 3, displayedAchievements: [] };
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (p === '/users/5') return json(route, profile);
    if (p === '/users/5/summary') return json(route, { profile, fan: { count: 9, isFan: false }, traits: null, polls: { polls: [] } });
    if (p === '/scraps/5') return json(route, { scraps: [], total: 0, totalPages: 1 });
    if (p === '/reputation/user/5') return json(route, { total: 2 });
    if (p === '/profile-visits/5/register' || p === '/profile-visits/5') return json(route, { ok: true });
    return handler(route);
  });
  await page.goto('/channels/ch2');
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 20_000 });
  // Abre pelo link do perfil. O app ainda pode estar trocando o endereço do
  // canal pelo nome bonito e passar por cima: nesse caso tenta de novo.
  await expect(async () => {
    await page.evaluate(() => { window.history.pushState({}, '', '/u/5'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await expect(page.locator('.profile-top-row')).toBeVisible({ timeout: 6000 });
  }).toPass({ timeout: 30_000 });
  const bar = page.locator('.pfl-bar');
  await expect(bar).toBeVisible({ timeout: 15_000 });
  // Números: nível (com a barrinha), Ups, reputação e seguidores — sem repetir insígnias/datas.
  await expect(bar.locator('.pf-stat')).toHaveCount(4);
  await expect(bar.locator('.pfl-level [role="progressbar"]')).toHaveAttribute('aria-valuenow', '40');
  await expect(bar.locator('.pf-stat', { hasText: 'Seguidores' })).toContainText('9');
  // Ações: só três botões com nome; o resto fica no menu "Mais".
  const actions = bar.locator('.pfl-actions');
  await expect(actions.locator('.btn-primary, .btn-secondary')).toHaveText(['Mensagem', 'Adicionar amigo', 'Seguir']);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await actions.getByRole('button', { name: 'Mais opções' }).click();
  await expect(page.getByRole('menuitem')).toHaveText([/Compartilhar perfil/, /Ignorar/, /Denunciar perfil/]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('.profile-fullscreen-overlay')).toBeVisible(); // Esc fecha só o menu
  // "Sobre": coluna à esquerda no computador; primeira aba no celular.
  const mobile = info.project.name === 'celular';
  if (mobile) {
    await expect(page.getByRole('tab').first()).toHaveText(/Sobre/);
    await expect(page.getByRole('tab', { name: 'Sobre' })).toHaveAttribute('aria-selected', 'true');
  } else {
    await expect(page.locator('.pfl-aside')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sobre' })).toHaveCount(0);
  }
  await expect(page.getByText('Oi, eu sou a Lia.')).toBeVisible();
  await expect(page.getByText(/No Project Club desde 10 de março de 2025/)).toBeVisible();
  // Abas: uma aberta por vez, e as setas do teclado trocam.
  await page.getByRole('tab', { name: 'Recados' }).click();
  await expect(page.getByRole('tab', { name: 'Recados' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByPlaceholder(/Deixe um recado pra Lia/)).toBeVisible();
  await expect(page.locator('.pf-tabpanel:not([hidden])')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Recados' }).press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Recados' })).toHaveAttribute('aria-selected', 'false');
  // Nada vaza pros lados.
  const overflow = await page.evaluate(() => { const b = document.querySelector('.profile-modal-fullscreen'); return b.scrollWidth - b.clientWidth; });
  expect(overflow).toBeLessThanOrEqual(1);
});

test('Economia: cartão da carteira com moedas e gemas vira ao clicar e no teclado', async ({ page }) => {
  await page.route('**/api/**', handler);
  await page.route('**/api/economy', (r) => json(r, { coins: 1861, gems: 19, dailyStreak: 1, streakRequired: 5, lastDailyAt: null, nextDailyAt: null, accountLevel: 7 }));
  await page.route('**/api/economy/chests', (r) => json(r, { chests: [] }));
  await page.route('**/api/missions', (r) => json(r, { missions: [], resets: {} }));
  await page.goto('/economia');
  const card = page.locator('.wcard');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText('1.861');
  await expect(card).toContainText('19');
  await expect(card).toContainText('ClubPay');
  await expect(card).toHaveAttribute('aria-label', /Mostrando a frente/);
  await expect(card.locator('.wcard-back')).toBeHidden();
  await card.click();
  await expect(card).toHaveAttribute('aria-label', /Mostrando o verso/);
  // O verso aparece de verdade (tarja, assinatura, CVV) e a frente some.
  await expect(card.locator('.wcard-back')).toBeVisible();
  await expect(card.locator('.wcard-sig-label')).toBeVisible();
  await expect(card.locator('.wcard-cvv')).toBeVisible();
  await expect(card.locator('.wcard-front')).toBeHidden();
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(card).toHaveAttribute('aria-label', /Mostrando a frente/);
  // Histórico e Sorteio saíram das abas.
  await expect(page.getByRole('tab', { name: /Histórico/ })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Sorteio/ })).toHaveCount(0);
});

test('Economia nova: abas no topo, cartão com espessura, baú e missões em linha, sem vazar pros lados', async ({ page }) => {
  await page.route('**/api/**', handler);
  await page.route('**/api/economy', (r) => json(r, { coins: 12480, gems: 37, dailyStreak: 3, streakRequired: 5, lastDailyAt: null, nextDailyAt: null, accountLevel: 7, cardStyle: 'DEFAULT', cardStyles: ['DEFAULT', 'GOLD'] }));
  await page.route('**/api/economy/chests', (r) => json(r, { chests: [] }));
  await page.route('**/api/missions', (r) => json(r, { multiplier: 1, resets: {}, missions: [
    { id: 'm1', period: 'DAILY', type: 'MESSAGES', title: 'Mande 20 mensagens', target: 20, progress: 20, completed: true, claimed: false, rewardCoins: 60, finalCoins: 60, rewardGems: 0, rewardXp: 30, unit: 'mensagens' },
    { id: 'm2', period: 'DAILY', type: 'REACTIONS', title: 'Reaja a 5 mensagens', target: 5, progress: 3, completed: false, claimed: false, rewardCoins: 30, finalCoins: 30, rewardGems: 0, rewardXp: 0, unit: 'reações' },
  ] }));
  await page.goto('/economia');
  const card = page.locator('.wcard');
  await expect(card).toBeVisible({ timeout: 20_000 });
  // A barra de abas fica no topo (igual à Loja) e a visão geral tem o cartão e o baú.
  await expect(page.locator('.hub-tabs-bar [role="tab"]')).toHaveCount(4);
  await expect(page.locator('.eco-top .eco-daily')).toBeVisible();
  await expect(page.locator('.eco-streak li.done')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /Resgatar baú diário/ })).toBeEnabled();
  // O cartão tem frente, verso e as fatias da espessura.
  await expect(card.locator('.wcard-slab')).toHaveCount(5);
  await expect(card.locator('.wcard-front')).toContainText('Nível 7');
  // Arrastar gira o cartão junto com o dedo/mouse.
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2, { steps: 8 });
  const ry = await page.locator('.wcard-scene').evaluate((el) => parseFloat(el.style.getPropertyValue('--ry')));
  expect(ry).toBeGreaterThan(20);
  await page.mouse.up();
  // Nada vaza pros lados (PC e celular).
  const overflow = await page.locator('.pk-page.eco').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // Missões saíram da Economia (nov/2026): o atalho leva pro Progresso, e o
  // endereço antigo também.
  await page.locator('.eco-missions-moved').click();
  await expect(page).toHaveURL(/\/progresso\?tab=missoes/);
  await expect(page.locator('.eco-mission')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator('.eco-mission.ready .eco-mission-claim')).toBeVisible();
  await page.goto('/missoes');
  await expect(page).toHaveURL(/\/progresso\?tab=missoes/);
});

test('Loja: estilos do cartão da carteira (Assinante usa o dourado, arco-íris bloqueado)', async ({ page }) => {
  await page.route('**/api/**', handler);
  await page.route('**/api/economy', (r) => json(r, { coins: 500, gems: 2, dailyStreak: 0, streakRequired: 5, accountLevel: 3, cardStyle: 'GOLD', cardStyles: ['DEFAULT', 'GOLD'] }));
  await page.goto('/loja?secao=cartao');
  await expect(page.getByRole('heading', { name: 'Cartão da carteira' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.wcs-option')).toHaveCount(3);
  await expect(page.locator('.wcs-option.is-current .wcard--gold')).toHaveCount(1);
  await expect(page.locator('.wcs-option.is-locked')).toHaveCount(1);
  await expect(page.locator('.wcs-option.is-locked .wcard--rainbow')).toHaveCount(1);
});
