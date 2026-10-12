import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { handler, imageHandler } from './mock-api.mjs';

// Mini-Jogos no celular: cada jogo mostra os controles na tela que precisa
// (direcional, ◀ ▶, botões de ação) e eles chegam no jogo como teclas; jogos
// de mouse recebem o toque direto. No PC os controles ficam escondidos e o
// teclado continua funcionando como antes.
// Capturas (Pixel 7 em pé/deitado e PC 1440) em /tmp/claude-0/minigame-shots/.

const SHOTS = '/tmp/claude-0/minigame-shots';
fs.mkdirSync(SHOTS, { recursive: true });

// Esquema esperado de cada jogo (espelha src/minijogos/touch/schemes.js).
const GAMES = {
  beancounters: { html5: true, keys: [], actions: ['space'] },
  pizzatron: { html5: true, keys: [], actions: [] },
  sledracing: { html5: true, keys: ['left', 'right'], actions: [] },
  thinice: { keys: ['up', 'right', 'down', 'left'], dpad: true, actions: [] },
  astrobarrier: { keys: ['left', 'right'], actions: ['space', 'enter'] },
  cartsurfer: { keys: ['up', 'right', 'down', 'left'], dpad: true, actions: ['space', 'enter'] },
  icefishing: { keys: [], actions: [] },
  aquagrabber: { keys: [], joystick: true, actions: ['space', 'enter'] },
  catchinwaves: { keys: [], actions: [] },
  dance: { keys: ['left', 'down', 'up', 'right'], actions: [] },
  systemdefender: { keys: [], actions: [] },
  hydrohopper: { keys: [], actions: [] },
  balloonpop: { keys: [], actions: [] },
  feedapuffle: { keys: [], actions: [] },
  pufflepaddle: { keys: [], actions: [] },
  puffleroundup: { keys: [], actions: [] },
  pufflesoaker: { keys: ['up', 'right', 'down', 'left'], dpad: true, actions: ['space', 'enter'] },
  fluffy: { keys: [], actions: [] },
};
const KEY = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', space: ' ', enter: 'Enter' };
const hasControls = (g) => g.keys.length > 0 || g.actions.length > 0 || g.joystick;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('layoutStyle', 'normal2');
      localStorage.setItem('minijogos:muted', '1');
      sessionStorage.setItem('inicio-redirect-done', '1');
    } catch { /* ignora */ }
  });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

// Janela onde o jogo escuta: Game.html (HTML5) ou player.html (Flash).
async function gameFrame(page, html5) {
  let frame = null;
  await expect.poll(() => {
    frame = page.frames().find((f) => (html5 ? /\/Game\.html/.test(f.url()) : /\/flash\/player\.html/.test(f.url())));
    return !!frame;
  }, { timeout: 30_000 }).toBe(true);
  return frame;
}

// Grava teclas e toques/cliques que chegam no jogo.
async function installRecorder(frame) {
  await frame.evaluate(() => {
    const log = [];
    window.__pcLog = log;
    ['keydown', 'keyup'].forEach((t) => window.addEventListener(t, (e) => log.push(`${t}:${e.key}`), true));
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach((t) => window.addEventListener(t, () => log.push(t), true));
  });
}
const readLog = (frame) => frame.evaluate(() => window.__pcLog.slice());
const clearLog = (frame) => frame.evaluate(() => { window.__pcLog.length = 0; });

async function openGame(page, slug) {
  await page.goto(`/minijogos?jogo=${slug}`);
  await expect(page.locator('.mj-player')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.mj-player-loading')).toHaveCount(0, { timeout: 45_000 });
}

// Segura um controle com um "dedo" de verdade (eventos de toque do Chrome).
async function touchHold(cdp, points, type) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i + 1 })) });
}
async function centerOf(locator) {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
}

test.describe('celular (Pixel 7)', () => {
  test.skip(({ isMobile }) => !isMobile, 'só no celular');

  for (const [slug, g] of Object.entries(GAMES)) {
    test(`${slug}: controles na tela no lugar certo`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openGame(page, slug);
      const controls = page.getByTestId('mjt-controls');
      const frame = await gameFrame(page, g.html5);
      await installRecorder(frame);
      await page.waitForTimeout(g.html5 ? 1500 : 3000);

      if (!hasControls(g)) {
        // Jogo de mouse: sem controles, o toque vai direto no jogo.
        await expect(controls).toHaveCount(0);
        await expect(page.getByTestId('mj-touch-toggle')).toHaveCount(0);
        const box = await page.locator('.mj-player-frame').boundingBox();
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await expect.poll(async () => (await readLog(frame)).some((e) => e === 'mousedown' || e === 'pointerdown')).toBe(true);
      } else {
        await expect(controls).toBeVisible();
        await expect(page.getByTestId('mj-touch-toggle')).toHaveAttribute('aria-pressed', 'true');
        const cdp = await page.context().newCDPSession(page);

        // Setas soltas / direcional: segurar mantém a tecla apertada, soltar solta.
        for (const dir of g.keys) {
          let pt;
          if (g.dpad) {
            const c = await centerOf(page.getByTestId('mjt-dpad'));
            const off = c.w * 0.36;
            pt = { x: c.x + (dir === 'right' ? off : dir === 'left' ? -off : 0), y: c.y + (dir === 'down' ? off : dir === 'up' ? -off : 0) };
          } else {
            pt = await centerOf(page.getByTestId(`mjt-key-${dir}`));
          }
          await clearLog(frame);
          await touchHold(cdp, [pt], 'touchStart');
          await page.waitForTimeout(250);
          let log = await readLog(frame);
          expect(log, `${dir} apertada`).toContain(`keydown:${KEY[dir]}`);
          expect(log, `${dir} ainda segurada`).not.toContain(`keyup:${KEY[dir]}`);
          await touchHold(cdp, [], 'touchEnd');
          await expect.poll(async () => readLog(frame)).toContain(`keyup:${KEY[dir]}`);
          log = await readLog(frame);
          expect(log.filter((e) => e === `keydown:${KEY[dir]}`).length, `${dir} não repete o keydown sem querer`).toBeLessThanOrEqual(slug === 'sledracing' ? 3 : 1);
        }

        // Analógico: arrastar pra direita aperta → e soltar solta.
        if (g.joystick) {
          const c = await centerOf(page.getByTestId('mjt-joystick'));
          await clearLog(frame);
          await touchHold(cdp, [{ x: c.x, y: c.y }], 'touchStart');
          await touchHold(cdp, [{ x: c.x + 50, y: c.y }], 'touchMove');
          await expect.poll(async () => readLog(frame)).toContain('keydown:ArrowRight');
          await touchHold(cdp, [], 'touchEnd');
          await expect.poll(async () => readLog(frame)).toContain('keyup:ArrowRight');
        }

        // Botões de ação: toque rápido ainda vira tecla (segura o mínimo pro jogo ver).
        for (const key of g.actions) {
          await clearLog(frame);
          await page.getByTestId(`mjt-action-${key}`).tap();
          await expect.poll(async () => readLog(frame)).toContain(`keyup:${KEY[key]}`);
          expect(await readLog(frame)).toContain(`keydown:${KEY[key]}`);
        }

        // Multitoque: mover e apertar a ação ao mesmo tempo.
        const moveKey = g.keys.includes('right') ? 'right' : null;
        if (moveKey && g.actions.length) {
          const mv = g.dpad
            ? await centerOf(page.getByTestId('mjt-dpad')).then((c) => ({ x: c.x + c.w * 0.36, y: c.y }))
            : await centerOf(page.getByTestId(`mjt-key-${moveKey}`));
          const act = await centerOf(page.getByTestId(`mjt-action-${g.actions[0]}`));
          await clearLog(frame);
          await touchHold(cdp, [{ ...mv, id: 1 }], 'touchStart');
          await touchHold(cdp, [{ ...mv, id: 1 }, { ...act, id: 2 }], 'touchStart');
          await page.waitForTimeout(250);
          const log = await readLog(frame);
          expect(log).toContain('keydown:ArrowRight');
          expect(log).toContain(`keydown:${KEY[g.actions[0]]}`);
          // App em segundo plano solta tudo (pinguim não anda sozinho).
          await page.evaluate(() => window.dispatchEvent(new Event('blur')));
          await expect.poll(async () => readLog(frame)).toContain('keyup:ArrowRight');
          await touchHold(cdp, [], 'touchCancel');
        }

        // Botão "Controles na tela" esconde e mostra de novo.
        await page.getByTestId('mj-touch-toggle').tap();
        await expect(controls).toHaveCount(0);
        await page.getByTestId('mj-touch-toggle').tap();
        await expect(controls).toBeVisible();
        await page.evaluate(() => localStorage.removeItem('minijogos:touchControls'));
      }

      // Controles não cobrem a barra do player nem saem da tela.
      if (hasControls(g)) {
        const vp = page.viewportSize();
        const bar = await page.locator('.mj-player-bar').boundingBox();
        for (const el of await page.locator('.mjt-key, .mjt-dpad, .mjt-joy-zone').all()) {
          const b = await el.boundingBox();
          expect(b.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
          expect(b.x).toBeGreaterThanOrEqual(-1);
          expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1);
          expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 1);
          expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
        }
      }

      await page.screenshot({ path: `${SHOTS}/${slug}-pixel7-portrait.png` });
      await page.setViewportSize({ width: 915, height: 412 });
      await page.waitForTimeout(1200);
      if (hasControls(g)) {
        await expect(page.locator('.mjt-controls')).toBeVisible();
        // Deitado: o jogo tem faixas livres dos lados — controles ficam nelas.
        await expect(page.locator('.mjt-controls')).toHaveClass(/fit-side/);
      }
      await expect(page.locator('.mj-rotate-hint')).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/${slug}-pixel7-landscape.png` });
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
});

test.describe('PC (teclado e mouse)', () => {
  test.skip(({ isMobile }) => !!isMobile, 'só no PC');

  for (const [slug, g] of Object.entries(GAMES)) {
    test(`${slug}: sem controles na tela e teclado funcionando`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openGame(page, slug);
      const frame = await gameFrame(page, g.html5);
      await installRecorder(frame);
      await page.waitForTimeout(g.html5 ? 800 : 2000);

      await expect(page.getByTestId('mjt-controls')).toHaveCount(0);
      await expect(page.locator('.mj-rotate-hint')).toHaveCount(0);
      await expect(page.locator('.mj-touch-hint')).toHaveCount(0);
      // O botão manual só existe pra quem tem controles na tela.
      await expect(page.getByTestId('mj-touch-toggle')).toHaveCount(hasControls(g) ? 1 : 0);

      // Teclado de verdade chega no jogo.
      const box = await page.locator('.mj-player-frame').boundingBox();
      await page.mouse.click(box.x + 4, box.y + box.height - 4);
      await clearLog(frame);
      await page.keyboard.down('ArrowRight');
      await page.keyboard.up('ArrowRight');
      await expect.poll(async () => readLog(frame)).toContain('keyup:ArrowRight');
      expect(await readLog(frame)).toContain('keydown:ArrowRight');

      await page.screenshot({ path: `${SHOTS}/${slug}-desktop-1440.png` });

      // Dá pra ligar os controles na mão no PC (ex.: notebook com tela touch).
      if (hasControls(g)) {
        await page.getByTestId('mj-touch-toggle').click();
        await expect(page.getByTestId('mjt-controls')).toBeVisible();
        if (g.actions.length) {
          await clearLog(frame);
          await page.getByTestId(`mjt-action-${g.actions[0]}`).click();
          await expect.poll(async () => readLog(frame)).toContain(`keyup:${KEY[g.actions[0]]}`);
        }
        await page.getByTestId('mj-touch-toggle').click();
        await expect(page.getByTestId('mjt-controls')).toHaveCount(0);
      }
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
});
