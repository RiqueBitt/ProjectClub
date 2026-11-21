import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Bug: o miniperfil "pulava" de lugar ao fechar, e o pulo mudava conforme
// onde a pessoa clicava pra fechar. Aqui abrimos o miniperfil, clicamos em
// vários pontos fora dele e amostramos a posição (top/left do elemento
// fixo, que não muda com o transform da animação) a cada frame até ele
// sumir: a posição tem que ficar exatamente a mesma do card aberto.

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

async function openFromChatAvatar(page) {
  const avatar = page.locator('.message .avatar.clickable').first();
  await avatar.click();
  const card = page.locator('.mini-profile-card');
  await expect(card).toBeVisible();
  // Espera a animação de abrir e a posição assentarem.
  await page.waitForTimeout(400);
  return card;
}

// Começa a amostrar a posição a cada frame (inclusive durante a animação de
// fechar) até o card ser desmontado.
async function startSampling(page) {
  await page.evaluate(() => {
    window.__mpSamples = [];
    const loop = () => {
      const el = document.querySelector('.mini-profile-card');
      if (!el) { window.__mpDone = true; return; }
      // Clicou em OUTRO item que abre miniperfil: o card fechou e abriu de
      // novo lá (comportamento esperado) — para de amostrar quando reabre.
      if (window.__mpSawClosing && !el.classList.contains('mini-profile-closing')) { window.__mpDone = true; return; }
      if (el.classList.contains('mini-profile-closing')) window.__mpSawClosing = true;
      window.__mpSamples.push({ top: el.style.top, left: el.style.left, ot: el.offsetTop, ol: el.offsetLeft });
      requestAnimationFrame(loop);
    };
    window.__mpDone = false;
    window.__mpSawClosing = false;
    loop();
  });
}

for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'celular', width: 430, height: 900 }]) {
  test.describe(`miniperfil fica parado ao fechar (${vp.name})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('clicando em vários pontos fora', async ({ page }) => {
      await page.goto('/channels/ch2');
      await expect(page.locator('.chat-header')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.message .avatar.clickable').first()).toBeVisible({ timeout: 20_000 });

      const points = [
        [5, 5], [vp.width - 5, vp.height - 5], [Math.round(vp.width / 2), Math.round(vp.height / 2)],
        [vp.width - 10, 120], [10, vp.height - 60],
      ];
      for (const [x, y] of points) {
        // O clique anterior pode ter aberto outra tela (menu, gaveta...): volta pro chat.
        if (!(await page.locator('.message .avatar.clickable').first().isVisible())) {
          await page.goto('/channels/ch2');
          await expect(page.locator('.message .avatar.clickable').first()).toBeVisible({ timeout: 20_000 });
        }
        const card = await openFromChatAvatar(page);
        const before = await card.evaluate((el) => ({ top: el.style.top, left: el.style.left, ot: el.offsetTop, ol: el.offsetLeft }));
        const box = await card.boundingBox();
        // Só vale clique FORA do card.
        if (x >= box.x - 2 && x <= box.x + box.width + 2 && y >= box.y - 2 && y <= box.y + box.height + 2) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(250);
          continue;
        }
        // Ponto em cima de OUTRO item que abre miniperfil (ex.: lista de
        // membros) abre o card lá — não é "fechar", então não entra aqui.
        const opensAnother = await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('.member-row, .avatar.clickable, .friend-row'), [x, y]);
        if (opensAnother) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); continue; }
        await startSampling(page);
        await page.mouse.click(x, y);
        await page.waitForFunction(() => window.__mpDone === true, null, { timeout: 3000 }).catch(() => { throw new Error(`o card não fechou ao clicar em (${x}, ${y})`); });
        const samples = await page.evaluate(() => window.__mpSamples);
        expect(samples.length, 'amostrou frames durante o fechamento').toBeGreaterThan(0);
        for (const s of samples) {
          expect(s, `posição mudou ao clicar em (${x}, ${y})`).toEqual(before);
        }
        // Se o clique caiu em algo que abre outra tela/modal, fecha antes de seguir.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
      }
    });

    test('clicar de novo no mesmo avatar fecha (não reabre nem pula)', async ({ page }) => {
      await page.goto('/channels/ch2');
      await expect(page.locator('.message .avatar.clickable').first()).toBeVisible({ timeout: 20_000 });
      const card = await openFromChatAvatar(page);
      const before = await card.evaluate((el) => ({ top: el.style.top, left: el.style.left, ot: el.offsetTop, ol: el.offsetLeft }));
      await startSampling(page);
      await page.locator('.message .avatar.clickable').first().click();
      await page.waitForFunction(() => window.__mpDone === true, null, { timeout: 3000 });
      const samples = await page.evaluate(() => window.__mpSamples);
      for (const s of samples) expect(s).toEqual(before);
      await page.waitForTimeout(300);
      await expect(page.locator('.mini-profile-card')).toHaveCount(0);
    });

    test('fechando com Esc', async ({ page }) => {
      await page.goto('/channels/ch2');
      await expect(page.locator('.message .avatar.clickable').first()).toBeVisible({ timeout: 20_000 });
      const card = await openFromChatAvatar(page);
      const before = await card.evaluate((el) => ({ top: el.style.top, left: el.style.left, ot: el.offsetTop, ol: el.offsetLeft }));
      await startSampling(page);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__mpDone === true, null, { timeout: 3000 });
      const samples = await page.evaluate(() => window.__mpSamples);
      for (const s of samples) expect(s).toEqual(before);
    });
  });
}
