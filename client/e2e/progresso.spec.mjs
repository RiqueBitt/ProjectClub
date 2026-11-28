import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Progresso: cabeçalho numa faixa só, pódio em 3D (render do Blender em
// public/progresso) com cada pessoa em cima do seu bloco, lista a partir do
// 4º, filtros das conquistas numa linha e a trilha de recompensas.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('theme', 'dark'); localStorage.setItem('layoutStyle', 'normal2'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* ok */ }
  });
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/api/**', handler);
});

test('Progresso: pódio em 3D com cada pessoa em cima do seu bloco e lista a partir do 4º', async ({ page }) => {
  await page.goto('/progresso');
  await expect(page.locator('.pg-hero')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.pg-hero')).toContainText('Faltam 720 XP para o nível 8');

  // A imagem dos blocos existe e é a renderizada (não um arquivo vazio).
  const art = await page.evaluate(() => new Promise((res) => {
    const i = new Image();
    i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
    i.onerror = () => res(null);
    i.src = '/progresso/podio.webp?v=1';
  }));
  expect(art?.w).toBeGreaterThanOrEqual(1000);

  await expect(page.locator('.pg-podium-spot')).toHaveCount(3);
  await expect(page.locator('.pg-podium-spot.place-1')).toContainText('Loritta');
  await expect(page.locator('.pg-podium-spot.place-2')).toContainText('Lia');
  await expect(page.locator('.pg-podium-spot.place-3')).toContainText('Rio Bot');

  // Espera a entrada terminar e mede: 2º à esquerda, 1º no meio e mais alto, 3º à direita e mais baixo.
  await page.waitForTimeout(1200);
  const stage = await page.locator('.pg-podium').boundingBox();
  const av = async (n) => page.locator(`.pg-podium-spot.place-${n} .pg-podium-avatar`).boundingBox();
  const [a1, a2, a3] = [await av(1), await av(2), await av(3)];
  expect(a2.x).toBeLessThan(a1.x);
  expect(a1.x).toBeLessThan(a3.x);
  expect(a1.y).toBeLessThan(a2.y);
  expect(a2.y).toBeLessThan(a3.y);
  // Cada um centralizado no seu bloco (posições de medidas.json) e com o pé no topo dele.
  const alvo = { 1: [50, 20.04], 2: [21.13, 36.79], 3: [78.77, 47.17] };
  for (const [n, a] of [[1, a1], [2, a2], [3, a3]]) {
    const cx = ((a.x + a.width / 2 - stage.x) / stage.width) * 100;
    const pe = ((a.y + a.height - stage.y) / stage.height) * 100;
    expect(Math.abs(cx - alvo[n][0])).toBeLessThan(1.5);
    expect(Math.abs(pe - alvo[n][1])).toBeLessThan(4);
  }

  // A lista continua do 4º; quem está fora do top aparece no fim, marcado.
  await expect(page.locator('.pg-list .pg-row').first()).toContainText('Haiz Bot');
  await expect(page.locator('.pg-row.is-me')).toContainText('você');

  // Nada vaza pros lados (no celular o pódio encolhe junto com a tela).
  const sobra = await page.evaluate(() => { const el = document.querySelector('.pg'); return el.scrollWidth - el.clientWidth; });
  expect(sobra).toBeLessThanOrEqual(1);
});

test('Progresso: conquistas com filtros numa linha e recompensas com a próxima destacada', async ({ page }) => {
  await page.goto('/progresso?tab=conquistas');
  await expect(page.locator('.pg-ach-card')).toHaveCount(5, { timeout: 20_000 });

  // Raridade filtra e desfaz no mesmo botão.
  const rara = page.getByRole('button', { name: /Rara/ });
  await rara.click();
  await expect(page.locator('.pg-ach-card')).toHaveCount(1);
  await expect(page.locator('.pg-ach-card')).toContainText('Tagarela');
  await page.getByRole('button', { name: 'Desbloqueadas' }).click();
  await expect(page.getByText('Nada com esses filtros')).toBeVisible();
  await rara.click();
  await expect(page.locator('.pg-ach-card')).toHaveCount(2);

  await page.getByRole('tab', { name: /Recompensas/ }).click();
  await expect(page.locator('.pg-next')).toContainText('Próxima recompensa');
  await expect(page.locator('.pg-next')).toContainText('Criar um Clube');
  await expect(page.locator('.pg-track-item.next')).toContainText('Faltam 3 níveis');
  // O medalhão (3D, pintado pelo CSS) carregou.
  const med = await page.evaluate(() => new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(0); i.src = '/progresso/medalhao.webp?v=1'; }));
  expect(med).toBeGreaterThanOrEqual(256);
});
