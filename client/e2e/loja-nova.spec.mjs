import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Loja reformulada: logo que é botão, menu de categorias com a pílula que
// desliza, ícone próprio do Cartão da carteira, caixinha 3D que gira de
// verdade (quadros renderizados no Blender), botões num padrão só, checkout
// com etapas e linhas animadas — e o menu de amigos novo.
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

test('Loja: logo volta pro início, a pílula acompanha a categoria e o Cartão da carteira tem ícone de cartão', async ({ page }) => {
  await page.goto('/loja');
  await expect(page.locator('.room-card').first()).toBeVisible({ timeout: 20_000 });
  const pill = page.locator('.room-nav-pill');
  const pillBox = async () => pill.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), o: getComputedStyle(el).opacity }; });
  await expect.poll(async () => (await pillBox()).o).toBe('1');
  const antes = await pillBox();

  // Trocar de categoria: o item fica ativo e a pílula vai até ele.
  const efeitos = page.locator('.room-nav-item', { hasText: 'Efeitos de texto' });
  await efeitos.click();
  await expect(efeitos).toHaveAttribute('aria-current', 'page');
  await expect.poll(async () => { const b = await pillBox(); return b.x !== antes.x || b.y !== antes.y; }).toBe(true);
  await expect.poll(async () => {
    const [p, m] = [await pill.boundingBox(), await efeitos.boundingBox()];
    return Math.abs(p.x - m.x) < 3 && Math.abs(p.y - m.y) < 3;
  }).toBe(true);

  // O ícone do Cartão da carteira é um cartão (retângulo com a tarja), não a moeda.
  const cartao = page.locator('.room-nav-item', { hasText: 'Cartão da carteira' });
  const d = await cartao.locator('svg path').first().getAttribute('d');
  expect(d).toContain('M3 9.5h18');
  expect(await cartao.locator('svg circle').count()).toBe(0);

  // A logo é um botão de verdade: leva pro início da Loja.
  await page.getByRole('button', { name: /Loja — voltar ao início/ }).click();
  await expect(page.locator('.room-nav-item', { hasText: 'Início' })).toHaveAttribute('aria-current', 'page');
});

test('Loja: a caixinha é o modelo 3D do Blender desenhado ao vivo e gira com o mouse', async ({ page }, testInfo) => {
  await page.goto('/loja');
  await page.locator('.room-nav-item', { hasText: 'Efeitos de texto' }).click();
  const card = page.locator('.room-card', { hasText: 'Brasa' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  // o motor 3D liga (canvas com o modelo) e o item ganha a matriz da pose
  const pack = card.locator('.room-pack');
  await expect(pack).toHaveClass(/\bp3d\b/, { timeout: 20_000 });
  await expect(pack.locator('canvas.room-pack-3d')).toHaveCount(1);
  const fundo = () => pack.locator('.room-pack-back').evaluate((el) => el.style.transform);
  await expect.poll(fundo, { timeout: 15000 }).toContain('matrix3d(');
  // sem placa de vídeo (como no CI) a caixinha fica parada de propósito
  const animates = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl'); const i = c?.getExtension('WEBGL_debug_renderer_info'); return !(i && /swiftshader|llvmpipe|software/i.test(String(c.getParameter(i.UNMASKED_RENDERER_WEBGL)))); });
  test.skip(testInfo.project.name === 'celular' || !animates, 'passar o mouse — só no PC com placa de vídeo');
  const parado = await fundo();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
  await page.mouse.move(box.x + box.width * 0.97, box.y + box.height * 0.3, { steps: 8 });
  await expect.poll(fundo, { timeout: 4000 }).not.toBe(parado);
});

test('Loja: todos os botões da cartela seguem o mesmo padrão', async ({ page }) => {
  await page.goto('/loja');
  await page.locator('.room-nav-item', { hasText: 'Efeitos de texto' }).click();
  await expect(page.locator('.room-card').first()).toBeVisible({ timeout: 20_000 });
  const estilos = await page.locator('.room-card .room-card-foot .room-btn').evaluateAll((els) => els.map((el) => {
    const st = getComputedStyle(el);
    return [el.textContent.trim(), st.height, st.borderRadius, st.fontWeight, st.fontSize, st.borderTopWidth].join('|');
  }));
  expect(estilos.length).toBeGreaterThan(1);
  expect(estilos.some((s) => s.startsWith('Pôr na cesta'))).toBe(true);
  // mesma altura, canto, peso, tamanho de letra e borda em todos
  const formas = new Set(estilos.map((s) => s.split('|').slice(1).join('|')));
  expect([...formas]).toHaveLength(1);
});

test('Checkout: etapas acompanham o que acontece e a linha some com animação ao tirar', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('shopBasket:v1'); } catch { /* ok */ } });
  await page.goto('/loja');
  await page.locator('.room-nav-item', { hasText: 'Efeitos de texto' }).click();
  for (const nome of ['Brasa', 'Aurora Boreal']) {
    await page.locator('.room-card', { hasText: nome }).getByRole('button', { name: new RegExp(`Pôr ${nome} na cestinha`) }).click();
  }
  await page.locator('.shop-basket-fab').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Checkout' })).toBeVisible();
  await expect(page.locator('.shop-receipt-row')).toHaveCount(2);
  // tudo certo na cesta: a etapa 1 fica concluída e a 2 (Pagamento) é a atual
  const etapa = (n) => page.locator('.shop-step').nth(n);
  await expect(etapa(0)).toHaveClass(/done/);
  await expect(etapa(1)).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('.shop-receipt-total')).toContainText('750');

  // tirar um item: a linha encolhe (is-leaving) e depois sai; o total acompanha
  await page.getByRole('button', { name: /Tirar Aurora Boreal da cestinha/ }).click();
  await expect(page.locator('.shop-receipt-row')).toHaveCount(1);
  await expect(page.locator('.shop-receipt-total')).toContainText('450');

  // esvaziou: volta pra etapa 1 e oferece o caminho de volta pros itens
  await page.getByRole('button', { name: 'Esvaziar a cestinha' }).click();
  await expect(page.locator('.shop-receipt-row')).toHaveCount(0);
  await expect(etapa(0)).toHaveAttribute('aria-current', 'step');
  await page.getByRole('button', { name: /Ver os itens da Loja/ }).click();
  await expect(page.locator('.room-nav-item', { hasText: 'Início' })).toHaveAttribute('aria-current', 'page');
});

test('Amigos: abas e filtros trocam com transição, linhas limpas e ações funcionando', async ({ page }, testInfo) => {
  await page.goto('/dms?tab=amigos');
  await expect(page.locator('.social-hero')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.fx-card')).toHaveCount(2);
  // no PC as ações secundárias (remover, bloquear) só aparecem ao passar o mouse; a de mensagem fica sempre à vista
  const linha = page.locator('.fx-card').first();
  await expect(linha.getByRole('button', { name: 'Enviar mensagem' })).toBeVisible();
  if (testInfo.project.name === 'pc') {
    await page.mouse.move(5, 5);
    const remover = linha.getByRole('button', { name: 'Remover amigo' });
    await expect.poll(() => remover.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
    await linha.hover();
    await expect.poll(() => remover.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  }
  // filtros
  await page.getByRole('tab', { name: /Todos/ }).click();
  await expect(page.locator('.fx-card')).toHaveCount(3);
  await page.getByRole('tab', { name: /Pendentes/ }).click();
  await expect(page.locator('.fx-card.is-incoming')).toHaveCount(1);
  // abas da página
  await page.getByRole('tab', { name: /Mensagens/ }).click();
  await expect(page.locator('.social-content-mensagens')).toBeVisible();
  await page.getByRole('tab', { name: /Clubes/ }).click();
  await expect(page.locator('.social-content-clubes')).toBeVisible();
  // nada vaza pros lados
  const sobra = await page.evaluate(() => { const el = document.querySelector('.social'); return el.scrollWidth - el.clientWidth; });
  expect(sobra).toBeLessThanOrEqual(1);
});
