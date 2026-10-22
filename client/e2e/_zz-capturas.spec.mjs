import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

const OUT = process.env.SHOTS_DIR;
const DECO = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><circle cx="120" cy="120" r="104" fill="none" stroke="#f5c542" stroke-width="14"/><circle cx="120" cy="120" r="104" fill="none" stroke="#fff6" stroke-width="3" stroke-dasharray="6 10"/><g fill="#ff5ea8"><circle cx="120" cy="12" r="14"/><circle cx="214" cy="170" r="12"/><circle cx="30" cy="170" r="12"/></g><path d="M100 4 120 -10 140 4 132 26H108z" fill="#f5c542"/></svg>`;
const decoUser = (o) => {
  if (Array.isArray(o)) return o.map(decoUser);
  if (o && typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) out[k] = decoUser(v);
    if (out.id === '2' && out.username) out.avatarDecoration = JSON.stringify({ id: 'd1', url: 'http://localhost:' + (process.env.PW_PORT || 4173) + '/mock-img/deco.svg', s: 1.25 });
    return out;
  }
  return o;
};
const patched = (route) => handler({
  request: () => route.request(),
  abort: (...a) => route.abort(...a),
  continue: (...a) => route.continue(...a),
  fulfill: (opts) => {
    let body = opts.body;
    try { body = JSON.stringify(decoUser(JSON.parse(body))); } catch { /* não é JSON */ }
    return route.fulfill({ ...opts, body });
  },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('layoutStyle', 'normal2'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* ok */ } });
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route('**/mock-img/deco.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: DECO }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/api/**', patched);
});

test('capturas', async ({ page }, info) => {
  const tag = info.project.name;
  await page.goto('/channels/ch2');
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  if (tag === 'pc') {
    await page.screenshot({ path: `${OUT}/1-topo-painel-pc.png`, clip: { x: 0, y: 0, width: 1440, height: 80 } });
    await page.keyboard.press('Control+k');
    await page.keyboard.type('lo');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/2-busca-unificada-pc.png` });
    await page.keyboard.press('Escape');
    // miniperfil de quem tem moldura
    await page.locator('.members-list').getByText('Loritta', { exact: true }).first().click();
    await expect(page.locator('.mini-profile-card .mini-profile-avatar')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1200);
    const box = await page.locator('.mini-profile-card').boundingBox();
    await page.screenshot({ path: `${OUT}/3-moldura-miniperfil-pc.png`, clip: { x: box.x - 10, y: box.y - 10, width: box.width + 20, height: Math.min(box.height + 20, 520) } });
    await page.keyboard.press('Escape');
    await page.goto('/anuncios'); await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/4-anuncios-e-eventos-pc.png` });
    await page.goto('/loja'); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/5-loja-economia-pc.png` });
    await page.goto('/economia'); await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/6-economia-abas-pc.png` });
  } else {
    await page.screenshot({ path: `${OUT}/7-topo-celular.png` });
    await page.getByRole('button', { name: 'Buscar em Project Club' }).first().click();
    await page.keyboard.type('lo');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/8-busca-celular.png` });
  }
});
