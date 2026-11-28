import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Páginas públicas: Blog (/blog e /blog/:slug) e os termos/privacidade, que
// agora são artigos do Blog (/termos e /privacidade levam pra lá). Precisam
// abrir sem erro de JavaScript, mostrar o título e não vazar para os lados.

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Unhandled render error|TypeError|ReferenceError/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

async function sideOverflow(page) {
  return page.evaluate(() => {
    const doc = document.scrollingElement;
    const lp = document.querySelector('.lp');
    return Math.max(doc.scrollWidth - doc.clientWidth, lp ? lp.scrollWidth - lp.clientWidth : 0);
  });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

test('blog: lista com destaque, categorias e cartões com link próprio', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/blog');
  await expect(page.getByRole('heading', { level: 1, name: /Novidades, tutoriais/ })).toBeVisible({ timeout: 20_000 });
  const cards = page.locator('.bl-card a');
  expect(await cards.count()).toBeGreaterThanOrEqual(20);
  // Todo cartão leva a /blog/<nome>.
  const hrefs = await cards.evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  for (const h of hrefs) expect(h).toMatch(/^\/blog\/[a-z0-9-]+$/);
  expect(new Set(hrefs).size).toBe(hrefs.length);

  // Filtro por categoria e busca.
  await page.getByRole('tab', { name: 'Segurança e privacidade' }).click();
  await expect(page.locator('.bl-card a[href="/blog/politica-de-privacidade"]')).toHaveCount(1);
  await expect(page.locator('.bl-card a[href="/blog/chat"]')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Todos' }).click();
  await page.getByPlaceholder(/Buscar/).fill('xyzsemresultado');
  await expect(page.locator('.bl-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Ver todos' }).click();
  expect(await cards.count()).toBeGreaterThanOrEqual(20);

  expect(await sideOverflow(page), 'a página não pode ter rolagem lateral').toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('blog: artigo abre no endereço próprio, com anterior/próximo e relacionados', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/blog/efeitos-de-texto-na-loja');
  await expect(page.getByRole('heading', { level: 1, name: 'Efeitos de texto chegaram na Loja' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.bl-pager a')).not.toHaveCount(0);
  await expect(page.locator('.bl-related .bl-card')).toHaveCount(3);
  await page.locator('.bl-pager a.is-next').click();
  await expect(page).toHaveURL(/\/blog\/[a-z0-9-]+$/);
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Efeitos de texto chegaram na Loja');
  expect(await sideOverflow(page)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('blog: artigo que não existe volta pra lista', async ({ page }) => {
  await page.goto('/blog/nao-existe-esse-artigo');
  await expect(page).toHaveURL(/\/blog$/, { timeout: 20_000 });
});

for (const path of ['/termos', '/privacidade']) {
  test(`${path} leva à política de privacidade no Blog`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(path);
    await expect(page).toHaveURL(/\/blog\/politica-de-privacidade/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Política de privacidade' })).toBeVisible();
    for (const id of ['dados', 'retencao', 'direitos', 'cookies', 'terceiros', 'seguranca', 'menores']) {
      await expect(page.locator(`section#${id}`)).toHaveCount(1);
    }
    // Índice lateral aponta pra partes que existem.
    const targets = await page.locator('.bl-toc a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(targets.length).toBeGreaterThanOrEqual(8);
    for (const href of targets) await expect(page.locator(href)).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test('/termos#contato leva aos termos de uso, na parte certa', async ({ page }) => {
  await page.goto('/termos#contato');
  await expect(page).toHaveURL(/\/blog\/termos-de-uso#contato/, { timeout: 20_000 });
  await expect(page.locator('section#contato')).toBeInViewport();
});

test('início: perguntas e topo com Blog e Privacidade', async ({ page }) => {
  // Sem sessão: a raiz mostra a página inicial pública.
  await page.route('**/api/**', (r) => {
    const u = r.request().url();
    if (u.includes('/platform/pulse')) return r.fulfill({ json: { members: 10, online: 2, messagesToday: 5 } });
    if (u.includes('/app-catalog/versions')) return r.fulfill({ json: {} });
    return r.fulfill({ status: 401, json: { error: 'sem sessão' } });
  });
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#perguntas')).toBeAttached({ timeout: 20_000 });
  await expect(page.locator('#perguntas summary', { hasText: 'Roda em PC fraco?' })).toHaveCount(1);
  await expect(page.locator('a[href="/blog"]').first()).toBeAttached();
  await expect(page.locator('a[href="/blog/politica-de-privacidade"]').first()).toBeAttached();
  expect(errors).toEqual([]);
});
