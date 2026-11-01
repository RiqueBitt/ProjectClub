import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Páginas públicas novas: Blog (/blog) e Termos de privacidade (/termos,
// com o endereço antigo /privacidade). Precisam abrir sem erro de
// JavaScript, mostrar o título, o índice e todas as seções, e não vazar
// para os lados. No Blog, o filtro esconde as seções que não citam o termo.

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

const PAGES = [
  { path: '/blog', title: 'Tudo sobre o Project Club', minSections: 15 },
  { path: '/termos', title: 'Termos de privacidade', minSections: 10 },
  { path: '/privacidade', title: 'Termos de privacidade', minSections: 10 },
];

for (const { path, title, minSections } of PAGES) {
  test(`abre ${path}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Algo deu errado')).toHaveCount(0);

    const sections = page.locator('.wk-sec');
    expect(await sections.count()).toBeGreaterThanOrEqual(minSections);
    // Cada item do índice aponta para uma seção que existe.
    const targets = await page.locator('.wk-toc-list a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(targets.length).toBe(await sections.count());
    for (const href of targets) await expect(page.locator(href)).toHaveCount(1);

    // Topo com os links novos.
    await expect(page.locator('a[href="/blog"]').first()).toBeAttached();
    await expect(page.locator('a[href="/termos"]').first()).toBeAttached();

    expect(await sideOverflow(page), 'a página não pode ter rolagem lateral').toBeLessThanOrEqual(1);
    expect(errors, 'erros de JavaScript na página').toEqual([]);
  });
}

test('termos: data de atualização e seções principais', async ({ page }) => {
  await page.goto('/termos');
  await expect(page.getByText('Atualizado em 12 de outubro de 2026')).toBeVisible({ timeout: 20_000 });
  for (const id of ['dados', 'retencao', 'direitos', 'cookies', 'terceiros', 'seguranca', 'menores', 'contato']) {
    await expect(page.locator(`section#${id}`)).toHaveCount(1);
  }
});

test('blog: o filtro esconde as seções que não falam do termo', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/blog');
  const input = page.locator('#wk-filter');
  await expect(input).toBeVisible({ timeout: 20_000 });
  const total = await page.locator('.wk-sec').count();

  await input.fill('gemas');
  await expect(page.locator('section#economia')).toBeVisible();
  await expect(page.locator('section#voz')).toBeHidden();
  const shown = await page.locator('.wk-sec:visible').count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(total);

  await input.fill('xyzsemresultado');
  await expect(page.locator('.wk-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar o filtro' }).click();
  await expect(page.locator('.wk-sec:visible')).toHaveCount(total);
  expect(errors).toEqual([]);
});

test('blog: abrir com âncora leva até a seção', async ({ page }) => {
  await page.goto('/blog#apps');
  await expect(page.locator('section#apps')).toBeInViewport({ timeout: 20_000 });
  await expect(page.locator('#app-canvasproject')).toHaveCount(1);
});

test('início: perguntas sem a de privacidade e topo com Blog e Termos', async ({ page }) => {
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
  await expect(page.locator('#perguntas summary', { hasText: 'E os meus dados?' })).toHaveCount(0);
  await expect(page.locator('a[href="/blog"]').first()).toBeAttached();
  await expect(page.locator('a[href="/termos"]').first()).toBeAttached();
  expect(errors).toEqual([]);
});
