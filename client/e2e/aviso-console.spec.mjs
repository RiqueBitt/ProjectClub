import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Aviso de segurança no console: o cartão completo ("PARE! NÃO COLE NADA
// AQUI!" + texto de apoio) assim que a página abre e, a cada 5 segundos, só o
// lembrete curto com o título — em qualquer rota, sem intervalo em dobro.
const TITLE = 'NÃO COLE NADA AQUI!';
const TEXT = 'Colar códigos desconhecidos no console pode comprometer sua conta';

async function open(page, path) {
  const seen = { title: 0, text: 0 };
  page.on('console', (msg) => {
    if (msg.type() !== 'log') return;
    const t = msg.text();
    if (t.includes(TITLE)) seen.title += 1;
    if (t.includes(TEXT)) seen.text += 1;
  });
  await page.clock.install();
  await page.addInitScript(() => { try { sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* sem storage */ } });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.goto(path);
  await expect.poll(() => seen.title).toBeGreaterThanOrEqual(1);
  await pause(page);
  return seen;
}

// Para o relógio da página: daqui em diante o tempo só anda com fastForward,
// então qualquer janela de 5 s contém exatamente 1 repetição do aviso (não
// importa quanto a página demorou pra abrir).
async function pause(page) {
  await expect(async () => {
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 1000); // 1 s à frente: o relógio ainda corria entre ler e parar
  }).toPass({ timeout: 10_000 });
  await page.waitForTimeout(250); // o que disparou até aqui já chegou ao teste
}

test('aparece ao abrir com o texto de apoio e o lembrete volta a cada 5 segundos', async ({ page }) => {
  const seen = await open(page, '/channels/ch2');
  const start = seen.title;
  expect(seen.text).toBe(1); // o texto de apoio vem uma vez, no cartão da abertura
  await page.clock.fastForward(5000);
  await expect.poll(() => seen.title).toBe(start + 1);
  await page.clock.fastForward(5000);
  await expect.poll(() => seen.title).toBe(start + 2);
  await page.clock.runFor(10000); // runFor dispara todos os timers do período
  await expect.poll(() => seen.title).toBe(start + 4); // 20 s = 4 repetições, nem mais nem menos
  expect(seen.text).toBe(1); // os lembretes são curtos: o texto longo não se repete
});

test('trocar de página dentro do site não cria outro intervalo', async ({ page }) => {
  const seen = await open(page, '/channels/ch2');
  const before = seen.title;
  // navegação interna (sem recarregar): Loja → Progresso → Amigos
  for (const path of ['/loja', '/progresso', '/dms']) {
    await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
  expect(seen.title).toBe(before);
  const start = seen.title; // navegar não repete o aviso fora de hora (relógio parado)
  await page.clock.fastForward(5000);
  await expect.poll(() => seen.title).toBe(start + 1); // um intervalo só: +1, não +4
  await page.clock.fastForward(5000);
  await expect.poll(() => seen.title).toBe(start + 2);
});

test('funciona também numa página pública (login)', async ({ page }) => {
  const seen = { title: 0 };
  page.on('console', (msg) => { if (msg.type() === 'log' && msg.text().includes(TITLE)) seen.title += 1; });
  await page.clock.install();
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (/\/api\/auth\/(refresh|me)/.test(url)) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"sem sessão"}' });
    return handler(route);
  });
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.goto('/login');
  await expect.poll(() => seen.title).toBeGreaterThanOrEqual(1);
  await pause(page);
  const start = seen.title;
  await page.clock.fastForward(5000);
  await expect.poll(() => seen.title).toBe(start + 1);
});
