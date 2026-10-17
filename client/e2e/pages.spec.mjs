import { test, expect } from '@playwright/test';
import { handler, imageHandler } from './mock-api.mjs';

// Cada página principal precisa: abrir sem erro de JavaScript, não cair
// na tela "Algo deu errado", mostrar o elemento principal dela e não
// ter rolagem lateral (conteúdo vazando da tela).
const PAGES = [
  { path: '/inicio', ready: '.home-hero' },
  { path: '/comunidades', ready: '.fp-card' },
  { path: '/dms', ready: '.social-hero' },
  { path: '/progresso', ready: '.pg-hero' },
  { path: '/progresso?tab=conquistas', ready: '.pg-ach-card' },
  { path: '/tickets', ready: '.sp-item' },
  { path: '/jogos', ready: '.app-card' },
  { path: '/channels/ch2', ready: '.chat-header' },
];

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
  // Fontes externas não são necessárias para o teste.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

for (const { path, ready } of PAGES) {
  test(`abre ${path}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && /Unhandled render error|TypeError|ReferenceError/.test(m.text())) errors.push(m.text());
    });

    await page.goto(path);
    // A tela de carregamento espera o socket (que aqui não existe) por alguns segundos.
    await expect(page.locator(ready).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Algo deu errado')).toHaveCount(0);

    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow, 'a página não pode ter rolagem lateral').toBeLessThanOrEqual(1);
    expect(errors, 'erros de JavaScript na página').toEqual([]);
  });
}

test('suporte: abrir um chamado mostra a conversa', async ({ page }) => {
  await page.goto('/tickets');
  await page.locator('.sp-item').first().click();
  await expect(page.locator('.sp-bubble').first()).toBeVisible();
  await expect(page.locator('.sp-composer textarea')).toBeVisible();
});

test('configurações abrem sem erro', async ({ page }) => {
  await page.goto('/inicio');
  await expect(page.locator('.home-hero')).toBeVisible({ timeout: 20_000 });
  await page.locator('.top-search-bar-icon-btn[title="Configurações"]').click();
  await expect(page.locator('.settings-modal-layout')).toBeVisible();
  await expect(page.getByText('Algo deu errado')).toHaveCount(0);
});

test('clubes: aba Clubes lista convites e clubes abertos', async ({ page }) => {
  await page.goto('/dms');
  await expect(page.locator('.social-hero')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: /Clubes/ }).click();
  await expect(page.locator('.cb-card').first()).toBeVisible();
  await expect(page.getByText('Algo deu errado')).toHaveCount(0);
});

test('miniperfil abre e fecha ao abrir outro menu', async ({ page }) => {
  await page.goto('/channels/ch2');
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 20_000 });
  const row = page.locator('.member-row').first();
  if (!(await row.isVisible())) test.skip(true, 'lista de membros escondida neste tamanho');
  await row.click();
  await expect(page.locator('.mini-profile-card')).toBeVisible();
  await page.locator('.top-search-bar-icon-btn[title="Configurações"]').click();
  await expect(page.locator('.mini-profile-card')).toHaveCount(0);
});
