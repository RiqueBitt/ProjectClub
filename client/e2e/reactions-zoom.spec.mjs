import { test, expect } from '@playwright/test';
import { handler, imageHandler, REACTORS } from './mock-api.mjs';

// 1) Menu "quem reagiu" dos chips de reação: clique direito no PC (popover
//    junto do clique) e segurar o dedo no celular (folha embaixo da tela).
// 2) Visualizador de imagem no celular: pinça com dois dedos, toque duplo e
//    arrastar sem perder a imagem (eventos de toque de verdade via CDP).

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

async function openChat(page) {
  await page.goto('/channels/ch2');
  await expect(page.locator('.reaction-chip[data-emoji="🎉"]')).toBeVisible({ timeout: 20_000 });
  // A foto anexada carrega depois e empurra o resto: espera assentar antes
  // de medir posições.
  await page.waitForFunction(() => [...document.querySelectorAll('.attachment-image')].every((i) => i.complete && i.naturalWidth > 0));
  await page.waitForTimeout(300);
}

const touch = (cdp, type, points) => cdp.send('Input.dispatchTouchEvent', {
  type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })),
});

test.describe('reações: quem reagiu', () => {
  test('PC: clique direito mostra a lista, pagina, teclado e miniperfil', async ({ page }, info) => {
    test.skip(info.project.name !== 'pc', 'só no PC');
    await openChat(page);
    const party = page.locator('.reaction-chip[data-emoji="🎉"]');
    await expect(party).toContainText(String(REACTORS.length)); // total do payload enxuto

    // Dica ao passar o mouse.
    await page.locator('.reaction-chip[data-emoji="👍"]').hover();
    await expect(page.locator('.reaction-tooltip')).toContainText('RiqueBitt e Lia reagiram com');

    await party.click({ button: 'right' });
    const menu = page.locator('.reaction-users-menu');
    await expect(menu).toBeVisible();
    await expect(menu).not.toHaveClass(/cm-sheet/);
    // Nem o menu nativo nem o menu da mensagem.
    await expect(page.locator('.context-menu:not(.reaction-users-menu)')).toHaveCount(0);
    await expect(menu.locator('.rum-count')).toContainText(String(REACTORS.length));
    await expect(menu.locator('.rum-action')).toContainText('Reagir com');
    await expect(menu.locator('.rum-user').first()).toContainText('Lia');
    await expect(menu.locator('.rum-user').first()).toContainText('@lia');
    // Rola até o fim: busca as próximas páginas até ter todo mundo.
    for (let i = 0; i < 6 && (await menu.locator('.rum-user').count()) < REACTORS.length; i += 1) {
      await menu.locator('.rum-list').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(250);
    }
    await expect(menu.locator('.rum-user')).toHaveCount(REACTORS.length);
    // Dentro da tela.
    const box = await menu.boundingBox();
    const vp = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);

    // Esc fecha e devolve o foco pro chip.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(party).toBeFocused();

    // Teclado: Shift+F10 abre; setas andam pelos itens.
    await page.mouse.move(5, 5); // o cursor parado em cima do menu "rouba" o foco (hover foca o item)
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await expect(menu).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.locator('.rum-action')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.locator('.rum-user').first()).toBeFocused();
    // Clicar numa pessoa abre o miniperfil dela.
    await menu.locator('.rum-user[data-user-id="5"]').click();
    await expect(menu).toHaveCount(0);
    await expect(page.locator('.mini-profile-card')).toBeVisible();
  });

  test('PC: emoji que é meu oferece "Remover reação" e clique normal continua reagindo', async ({ page }, info) => {
    test.skip(info.project.name !== 'pc', 'só no PC');
    await openChat(page);
    const thumbs = page.locator('.reaction-chip[data-emoji="👍"]');
    await thumbs.click({ button: 'right' });
    const menu = page.locator('.reaction-users-menu');
    await expect(menu.locator('.rum-action')).toHaveText('Remover reação');
    await expect(menu.locator('.rum-user')).toHaveCount(2);
    // Clique fora fecha.
    await page.mouse.click(5, 5);
    await expect(menu).toHaveCount(0);

    const reacted = page.waitForRequest((r) => r.url().includes('/api/messages/m4/react') && r.method() === 'POST');
    await thumbs.click();
    const req = await reacted;
    expect(req.postDataJSON()).toEqual({ emoji: '👍' });
    await expect(menu).toHaveCount(0);
  });

  test('celular: segurar o chip abre a folha com quem reagiu', async ({ page }, info) => {
    test.skip(info.project.name !== 'celular', 'só no celular');
    await openChat(page);
    let reacted = 0;
    page.on('request', (r) => { if (r.url().includes('/react') && r.method() === 'POST') reacted += 1; });
    const chip = page.locator('.reaction-chip[data-emoji="🎉"]');
    await chip.scrollIntoViewIfNeeded();
    const b = await chip.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const pt = [b.x + b.width / 2, b.y + b.height / 2];
    await touch(cdp, 'touchStart', [pt]);
    await page.waitForTimeout(700);
    await touch(cdp, 'touchEnd', []);
    const sheet = page.locator('.reaction-users-menu.cm-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.locator('.context-menu:not(.reaction-users-menu)')).toHaveCount(0);
    await expect(sheet.locator('.rum-user').first()).toContainText('Lia');
    await expect(sheet.locator('.rum-count')).toContainText(String(REACTORS.length));
    // Folha presa embaixo, ocupando a largura.
    const sb = await sheet.boundingBox();
    const vp = page.viewportSize();
    expect(Math.round(sb.x)).toBe(0);
    expect(Math.abs(sb.y + sb.height - vp.height)).toBeLessThan(3);
    await page.waitForTimeout(300);
    expect(reacted).toBe(0); // soltar o dedo não reagiu

    // Toque curto ainda reage normalmente.
    await page.locator('.rum-close').tap();
    await expect(sheet).toHaveCount(0);
    const req = page.waitForRequest((r) => r.url().includes('/api/messages/m4/react') && r.method() === 'POST');
    await chip.tap();
    await req;
  });
});

test.describe('visualizador de imagem: zoom por toque', () => {
  async function openViewer(page) {
    await openChat(page);
    const thumb = page.locator('.attachment-image').first();
    await thumb.scrollIntoViewIfNeeded();
    await thumb.tap();
    const img = page.locator('.lightbox-zoomable');
    await expect(img).toBeVisible();
    await page.waitForTimeout(300);
    return img;
  }
  const scaleOf = async (img) => Number(await img.getAttribute('data-scale'));

  test('pinça aumenta o zoom e arrastar não perde a imagem', async ({ page }, info) => {
    test.skip(info.project.name !== 'celular', 'só no celular');
    const img = await openViewer(page);
    const vp = page.viewportSize();
    const cx = vp.width / 2;
    const cy = vp.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await touch(cdp, 'touchStart', [[cx - 30, cy], [cx + 30, cy]]);
    for (let i = 1; i <= 10; i += 1) {
      await touch(cdp, 'touchMove', [[cx - 30 - i * 12, cy], [cx + 30 + i * 12, cy]]);
      await page.waitForTimeout(16);
    }
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(100);
    const s = await scaleOf(img);
    expect(s).toBeGreaterThan(2.5); // distância 60 → 300 = 5x, limitado a 5
    expect(s).toBeLessThanOrEqual(5);
    // Zoom em volta do meio dos dedos (centro da tela): o centro continua no centro.
    const r0 = await img.boundingBox();
    expect(Math.abs(r0.x + r0.width / 2 - cx)).toBeLessThan(6);

    // Arrasta muito pra esquerda e pra cima: a imagem para na borda.
    await touch(cdp, 'touchStart', [[cx, cy]]);
    for (let i = 1; i <= 12; i += 1) {
      await touch(cdp, 'touchMove', [[cx - i * 150, cy - i * 150]]);
      await page.waitForTimeout(16);
    }
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(100);
    const stage = await page.locator('.lightbox-stage').boundingBox();
    const r = await img.boundingBox();
    expect(r.x + r.width).toBeGreaterThanOrEqual(stage.x + stage.width - 1);
    expect(r.x).toBeLessThan(stage.x);
    // Mais alta que a tela? encosta embaixo; senão fica centralizada.
    if (r.height > stage.height) expect(r.y + r.height).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
    else expect(Math.abs(r.y + r.height / 2 - (stage.y + stage.height / 2))).toBeLessThan(2);
    // Deslizar pra baixo com zoom NÃO fecha.
    await touch(cdp, 'touchStart', [[cx, 200]]);
    for (let i = 1; i <= 6; i += 1) { await touch(cdp, 'touchMove', [[cx, 200 + i * 60]]); await page.waitForTimeout(16); }
    await touch(cdp, 'touchEnd', []);
    await expect(img).toBeVisible();
  });

  test('toque duplo alterna 2,5x/1x e deslizar pra baixo fecha', async ({ page }, info) => {
    test.skip(info.project.name !== 'celular', 'só no celular');
    const img = await openViewer(page);
    const b = await img.boundingBox();
    const pt = [b.x + b.width * 0.3, b.y + b.height * 0.4];
    const cdp = await page.context().newCDPSession(page);
    const tap = async () => { await touch(cdp, 'touchStart', [pt]); await touch(cdp, 'touchEnd', []); };
    await tap();
    await page.waitForTimeout(80);
    await tap();
    await page.waitForTimeout(350);
    expect(await scaleOf(img)).toBeCloseTo(2.5, 2);
    await tap();
    await page.waitForTimeout(80);
    await tap();
    await page.waitForTimeout(350);
    expect(await scaleOf(img)).toBeCloseTo(1, 2);
    // A página por trás não ampliou (zoom só na imagem).
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

    // Sem zoom: deslizar pra baixo fecha.
    const vp = page.viewportSize();
    await touch(cdp, 'touchStart', [[vp.width / 2, 250]]);
    for (let i = 1; i <= 8; i += 1) { await touch(cdp, 'touchMove', [[vp.width / 2, 250 + i * 30]]); await page.waitForTimeout(16); }
    await touch(cdp, 'touchEnd', []);
    await expect(page.locator('.lightbox-overlay')).toHaveCount(0);
  });

  test('PC: roda do mouse e clique continuam ampliando', async ({ page }, info) => {
    test.skip(info.project.name !== 'pc', 'só no PC');
    await openChat(page);
    await page.locator('.attachment-image').first().click();
    const img = page.locator('.lightbox-zoomable');
    await expect(img).toBeVisible();
    await page.waitForTimeout(300);
    const b = await img.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(200);
    expect(await scaleOf(img)).toBeGreaterThan(1.2);
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(200);
    expect(await scaleOf(img)).toBeCloseTo(1, 2);
    await img.click();
    await page.waitForTimeout(350);
    expect(await scaleOf(img)).toBeCloseTo(2.5, 2);
    await page.keyboard.press('Escape');
    await expect(page.locator('.lightbox-overlay')).toHaveCount(0);
  });
});
