import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { handler, imageHandler } from './mock-api.mjs';

// Mini-Jogos no celular: cada jogo mostra os controles na tela que precisa
// (direcional, ◀ ▶, botões de ação) e eles chegam no jogo como teclas; jogos
// de mouse recebem o toque direto. No PC os controles ficam escondidos e o
// teclado continua funcionando como antes.
// Capturas (Pixel 7 em pé/deitado e PC 1440) em /tmp/claude-0/minigames-final/.

const SHOTS = '/tmp/claude-0/minigames-final';
// Igual a um celular de verdade: som (AudioContext/autoplay) só depois de um gesto.
test.use({ launchOptions: { args: ['--autoplay-policy=user-gesture-required'] } });
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
      // Alguns jogos têm faixas de fundo em volta (letterbox): garante o
      // foco no iframe do jogo, como acontece quando a pessoa clica nele.
      await (await frame.frameElement()).focus();
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

// ---------------------------------------------------------------------------
// v2: Sair, tela deitada, encaixe, Pizzatron no toque e som destravado.
// ---------------------------------------------------------------------------

const HTML5_ASPECT = 1000 / 610;
const FLASH_ASPECT = 760 / 480;
const aspectOf = (slug) => (GAMES[slug]?.html5 ? HTML5_ASPECT : FLASH_ASPECT);

// Finge screen.orientation.lock/unlock e a tela cheia, gravando as chamadas
// (o Chrome de teste não gira a tela de verdade).
async function mockOrientation(page) {
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const calls = [];
    window.__orientCalls = calls;
    const SO = window.ScreenOrientation?.prototype;
    if (SO) {
      SO.lock = function (o) { calls.push(`lock:${o}`); return Promise.resolve(); };
      SO.unlock = function () { calls.push('unlock'); };
    }
    Element.prototype.requestFullscreen = function () { calls.push('fullscreen'); return Promise.resolve(); };
  });
}
const orientCalls = (page) => page.evaluate(() => window.__orientCalls.slice());

// Abre pela lista com um toque/clique de verdade (o gesto que libera a tela cheia).
async function openFromList(page, name, { touch }) {
  await page.goto('/minijogos');
  const card = page.locator('.mj-card', { hasText: name });
  await expect(card).toBeVisible({ timeout: 30_000 });
  if (touch) await card.tap(); else await card.click();
  await expect(page.getByTestId('mj-player')).toBeVisible();
  await expect(page.locator('.mj-player-loading')).toHaveCount(0, { timeout: 45_000 });
}

// Retângulo de um elemento do Game.html em coordenadas da página (o jogo
// fica dentro de 2 iframes e é escalado com transform).
async function gameRect(page, sel) {
  return page.evaluate((sel) => {
    const outer = document.querySelector('.mj-player-frame');
    const o = outer.getBoundingClientRect();
    const box = outer.contentDocument.querySelector('iframe.game-box');
    const b = box.getBoundingClientRect();
    const z = o.width / outer.contentWindow.innerWidth;
    const sx = (z * b.width) / box.offsetWidth; const sy = (z * b.height) / box.offsetHeight;
    const el = box.contentDocument.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: o.left + b.left * z + r.left * sx, y: o.top + b.top * z + r.top * sy, w: r.width * sx, h: r.height * sy };
  }, sel);
}
const mid = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

async function expectFits(page, slug) {
  const vp = page.viewportSize();
  const f = await page.getByTestId('mj-frame').boundingBox();
  expect(f.x).toBeGreaterThanOrEqual(-1);
  expect(f.y).toBeGreaterThanOrEqual(-1);
  expect(f.x + f.width).toBeLessThanOrEqual(vp.width + 1);
  expect(f.y + f.height).toBeLessThanOrEqual(vp.height + 1);
  // proporção do jogo mantida (sem esticar nem cortar)
  expect(Math.abs(f.width / f.height - aspectOf(slug)) / aspectOf(slug)).toBeLessThan(0.02);
  // centralizado na horizontal e encostando em pelo menos um dos lados do palco (maior tamanho)
  const st = await page.locator('.mj-player-stage').boundingBox();
  expect(Math.abs((f.x - st.x) - (st.x + st.width - (f.x + f.width)))).toBeLessThanOrEqual(2);
  const fillsW = f.width >= st.width - 22; const fillsH = f.height >= st.height - 22;
  expect(fillsW || fillsH, 'jogo do maior tamanho que cabe').toBe(true);
  // sem barra de rolagem
  const scroll = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth, document.documentElement.scrollHeight, document.documentElement.clientHeight]);
  expect(scroll[0]).toBeLessThanOrEqual(scroll[1]);
  expect(scroll[2]).toBeLessThanOrEqual(scroll[3]);
}

test.describe('v2 celular: Sair, tela deitada e encaixe', () => {
  test.skip(({ isMobile }) => !isMobile, 'só no celular');

  for (const [label, vp] of [['portrait', { width: 412, height: 839 }], ['landscape', { width: 915, height: 412 }]]) {
    test(`abrir trava deitado; Sair destrava e volta pra lista (${label})`, async ({ page }) => {
      await mockOrientation(page);
      await page.setViewportSize(vp);
      await openFromList(page, 'Pizzatron 3000', { touch: true });
      await expect.poll(() => orientCalls(page)).toEqual(expect.arrayContaining(['fullscreen', 'lock:landscape']));
      // Sair: no canto de cima à esquerda, grande o bastante pro dedo
      const exit = page.getByTestId('mj-exit');
      await expect(exit).toBeVisible();
      const b = await exit.boundingBox();
      expect(b.x).toBeLessThan(vp.width * 0.2);
      expect(b.y).toBeLessThan(vp.height * 0.2);
      expect(b.height).toBeGreaterThanOrEqual(36);
      await expectFits(page, 'pizzatron');
      // som não começa mudo no celular (mesmo com o mudo salvo de antes)
      await expect(page.getByTestId('mj-mute')).toHaveAttribute('aria-pressed', 'false');
      await page.screenshot({ path: `${SHOTS}/v2-pizzatron-pixel7-${label}.png` });
      await exit.tap();
      await expect(page.getByTestId('mj-player')).toHaveCount(0);
      await expect(page.locator('.mj-card').first()).toBeVisible();
      expect(await orientCalls(page)).toContain('unlock');
      expect(new URL(page.url()).searchParams.get('jogo')).toBeNull();
    });
  }

  test('voltar do Android/navegador também sai do jogo e destrava', async ({ page }) => {
    await mockOrientation(page);
    await page.setViewportSize({ width: 915, height: 412 });
    await openFromList(page, 'Gelo Fino', { touch: true });
    await page.goBack();
    await expect(page.getByTestId('mj-player')).toHaveCount(0);
    await expect.poll(() => orientCalls(page)).toContain('unlock');
  });

  for (const slug of ['beancounters', 'sledracing', 'thinice', 'aquagrabber', 'dance']) {
    test(`${slug}: jogo encaixado sem cortar, controles na moldura`, async ({ page }) => {
      await page.setViewportSize({ width: 915, height: 412 });
      await openGame(page, slug);
      await page.waitForTimeout(800);
      await expectFits(page, slug);
      // deitado: barra flutuante (o jogo usa a altura toda)
      await expect(page.getByTestId('mj-player')).toHaveClass(/is-immersive/);
      if (hasControls(GAMES[slug])) {
        const f = await page.getByTestId('mj-frame').boundingBox();
        for (const el of await page.locator('.mjt-key, .mjt-dpad, .mjt-joy-zone').all()) {
          const b = await el.boundingBox();
          const inGame = b.x + 2 > f.x && b.x + b.width - 2 < f.x + f.width;
          expect(inGame, 'controle fica na moldura, fora do jogo').toBe(false);
        }
      }
      await page.screenshot({ path: `${SHOTS}/v2-${slug}-pixel7-landscape.png` });
      await page.setViewportSize({ width: 412, height: 839 });
      await page.waitForTimeout(800);
      await expectFits(page, slug);
      await page.screenshot({ path: `${SHOTS}/v2-${slug}-pixel7-portrait.png` });
    });
  }
});

test.describe('v2 celular: Pizzatron 3000 no toque', () => {
  test.skip(({ isMobile }) => !isMobile, 'só no celular');

  test('pega o queijo no toque, arrasta e solta na pizza', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: 915, height: 412 });
    await openGame(page, 'pizzatron');
    const frame = await gameFrame(page, true);
    await expect.poll(() => frame.evaluate(() => window.app.currentState()), { timeout: 30_000 }).toBe('Main');
    const start = await gameRect(page, '.start-button');
    await page.touchscreen.tap(mid(start).x, mid(start).y);
    await expect.poll(() => frame.evaluate(() => window.app.currentState())).toBe('Game');

    const cdp = await page.context().newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ ...p, id: 1 })) });
    const drag = async (from, to, steps = 10) => {
      await touch('touchStart', [from]);
      for (let i = 1; i <= steps; i += 1) {
        await touch('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
        await page.waitForTimeout(16);
      }
    };
    // espera a pizza entrar inteira na esteira
    await expect.poll(() => frame.evaluate(() => parseInt(window.$('.pizza-dough').css('left'), 10)), { timeout: 20_000 }).toBeGreaterThan(110);

    // O essencial pro celular: arrastar um ingrediente com o dedo precisa
    // chegar no jogo e cair na pizza. Montar a pizza inteira (molho espalhado
    // na esteira em movimento + sincronia de tempo) é instável de automatizar,
    // então aqui a gente garante que o toque-arrasta funciona de fato.
    // Queijo: tocar no pote "pega" o ingrediente, que passa a seguir o dedo.
    const cheese = mid(await gameRect(page, '.ingredient-trigger.cheese'));
    await touch('touchStart', [cheese]);
    await page.waitForTimeout(60);
    // o toque chegou no jogo e pegou o queijo (ele agora segue o dedo)
    await expect.poll(() => frame.evaluate(() => window.$('.ingredient-holding:not(.dropped)').length), { timeout: 10_000 }).toBe(1);
    // arrasta até a pizza e solta — o queijo cai na massa
    const pizza = mid(await gameRect(page, '.pizza-trigger'));
    for (let i = 1; i <= 10; i += 1) {
      await touch('touchMove', [{ x: cheese.x + ((pizza.x - cheese.x) * i) / 10, y: cheese.y + ((pizza.y - cheese.y) * i) / 10 }]);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', [{ x: pizza.x, y: pizza.y }]);
    await expect.poll(() => frame.evaluate(() => window.currentPizza?.ingredients?.Cheese || 0), { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(frame.locator('.cheese-tick')).not.toHaveClass(/hid/);
    await page.screenshot({ path: `${SHOTS}/v2-pizzatron-touch-played.png` });
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

test.describe('v2 celular: som destravado no primeiro toque', () => {
  test.skip(({ isMobile }) => !isMobile, 'só no celular');

  for (const [slug, g] of Object.entries(GAMES)) {
    test(`${slug}: AudioContext "running" depois de tocar no jogo`, async ({ page }) => {
      await page.setViewportSize({ width: 915, height: 412 });
      await openGame(page, slug);
      const frame = await gameFrame(page, g.html5);
      await expect.poll(() => frame.evaluate(() => typeof window.__pcAudioState === 'function' && window.__pcAudioState().contexts.length), { timeout: 30_000 }).toBeGreaterThan(0);
      const f = await page.getByTestId('mj-frame').boundingBox();
      // toca num canto do jogo (longe de botões de menu)
      await page.touchscreen.tap(f.x + f.width * 0.5, f.y + f.height * 0.06);
      await expect.poll(() => frame.evaluate(() => window.__pcAudioState().contexts), { timeout: 10_000 }).not.toContain('suspended');
      const st = await frame.evaluate(() => window.__pcAudioState());
      expect(st.contexts.length).toBeGreaterThan(0);
      expect(st.contexts.every((s) => s === 'running')).toBe(true);
      if (g.html5) {
        // HTML5 no celular: efeitos/música tocam pela ponte de Web Audio
        expect(st.bridge).toBe(true);
      }
    });
  }
});

test.describe('v2 PC: Sair, encaixe e visual', () => {
  test.skip(({ isMobile }) => !!isMobile, 'só no PC');

  test('Sair no canto de cima à esquerda volta pra lista; não trava orientação', async ({ page }) => {
    await mockOrientation(page);
    await openFromList(page, 'Pizzatron 3000', { touch: false });
    const exit = page.getByTestId('mj-exit');
    const b = await exit.boundingBox();
    const p = await page.getByTestId('mj-player').boundingBox();
    expect(b.x - p.x).toBeLessThan(40);
    expect(b.y - p.y).toBeLessThan(40);
    await expectFits(page, 'pizzatron');
    // PC: mudo continua salvo como antes
    await expect(page.getByTestId('mj-mute')).toHaveAttribute('aria-pressed', 'true');
    expect(await orientCalls(page)).not.toContain('lock:landscape');
    await page.screenshot({ path: `${SHOTS}/v2-pizzatron-desktop-1440.png` });
    await exit.click();
    await expect(page.getByTestId('mj-player')).toHaveCount(0);
    await expect(page.locator('.mj-card').first()).toBeVisible();
  });

  for (const [slug, vp] of [['thinice', { width: 1440, height: 900 }], ['beancounters', { width: 1280, height: 640 }], ['cartsurfer', { width: 1024, height: 900 }]]) {
    test(`${slug}: maior tamanho mantendo a proporção (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize(vp);
      await openGame(page, slug);
      await page.waitForTimeout(600);
      await expectFits(page, slug);
      await page.screenshot({ path: `${SHOTS}/v2-${slug}-desktop-${vp.width}x${vp.height}.png` });
      // controles na tela ligados na mão (estilo novo) pra conferir o visual
      if (hasControls(GAMES[slug])) {
        await page.getByTestId('mj-touch-toggle').click();
        await expect(page.getByTestId('mjt-controls')).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/v2-${slug}-desktop-controls.png` });
        await page.getByTestId('mj-touch-toggle').click();
      }
    });
  }
});
