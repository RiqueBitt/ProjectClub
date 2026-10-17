import { test, expect } from '@playwright/test';
import { handler, imageHandler, ME } from './mock-api.mjs';
import { normalizePercent, updateDisplay } from '../src/utils/updateProgress.js';

// Correções desta leva:
//  1. seletor de "cor da bolinha de status" removido da interface;
//  2. placa de identificação com ajuste de posição/zoom (enquadramento salvo);
//  3. X de fechar o YouTube Music visível/clicável em qualquer zoom;
//  4. helper de porcentagem do botão de atualização mapeia certo.

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

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

async function openSettingsProfile(page) {
  await page.goto('/inicio');
  await expect(page.locator('.home-hero')).toBeVisible({ timeout: 20_000 });
  await page.locator('.top-search-bar-icon-btn[title="Configurações"]').click();
  await expect(page.locator('.settings-modal-layout')).toBeVisible();
  // Garante que estamos na aba Perfil (onde fica a placa).
  const placaHead = page.getByRole('heading', { name: 'Placa de identificação' });
  if (!(await placaHead.isVisible().catch(() => false))) {
    await page.getByText(/^Perfil$/).first().click();
  }
  await expect(placaHead).toBeVisible();
}

test.describe('pc-fixes (1440px)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('1) seletor de cor da bolinha de status foi removido', async ({ page }) => {
    await openSettingsProfile(page);
    // O bloco e o seletor antigos não existem mais na interface.
    await expect(page.getByText('Cor de fundo da bolha de status')).toHaveCount(0);
    await expect(page.getByText('A cor atrás do indicador de status')).toHaveCount(0);
  });

  test('2) placa: ajuste de posição/zoom abre o editor e salva o enquadramento', async ({ page }) => {
    let patched = null;
    // Captura o PATCH do perfil (mais específico que o handler genérico).
    await page.route('**/api/users/me', async (route) => {
      if (route.request().method() === 'PATCH') {
        patched = JSON.parse(route.request().postData() || '{}');
        return json(route, { user: { ...ME, idCardFraming: patched.idCardFraming } });
      }
      return route.fallback();
    });
    await openSettingsProfile(page);

    const adjust = page.getByRole('button', { name: 'Ajustar posição/zoom' });
    await adjust.scrollIntoViewIfNeeded();
    await expect(adjust).toBeVisible();
    await adjust.click();

    // Abre o mesmo editor dos banners (ImageCropperModal).
    await expect(page.getByText('Ajustar enquadramento da placa')).toBeVisible();

    // Confirma — salva o enquadramento "x,y,zoom" via PATCH /users/me.
    await page.getByRole('button', { name: 'Aplicar' }).click();
    await expect.poll(() => patched, { timeout: 5000 }).not.toBeNull();
    expect(patched).toHaveProperty('idCardFraming');
    expect(String(patched.idCardFraming)).toMatch(/^[\d.]+,[\d.]+,[\d.]+$/);
  });

  test('3) YouTube Music: X de fechar fica visível e clicável em 80/100/120%', async ({ page }) => {
    // Vai pra uma tela do app (onde music.css já está carregado via MusicEngine).
    await page.goto('/channels/ch2');
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 });

    // Monta o painel real do YouTube Music (mesmas classes do MusicPanel).
    await page.evaluate(() => {
      const ov = document.createElement('div');
      ov.className = 'mu-overlay';
      ov.innerHTML = `<div class="mu-panel"><div class="mu-head">
        <span class="mu-logo">M</span><strong>Música</strong>
        <div class="mu-tabs"><button>Explorar</button><button>Fila (12)</button></div>
        <button type="button" class="mu-icon-btn" aria-label="Fechar" id="pc-mu-x">X</button>
      </div><div style="height:200px"></div></div>`;
      document.body.appendChild(ov);
    });

    const x = page.locator('#pc-mu-x');
    for (const zoom of [0.8, 1.0, 1.2]) {
      await page.evaluate((z) => {
        document.documentElement.style.zoom = String(z);
        document.documentElement.style.setProperty('--pc-css-zoom', String(z));
      }, zoom);
      await expect(x, `X visível em zoom ${zoom}`).toBeVisible();
      const ok = await x.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
        if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return false;
        const hit = document.elementFromPoint(cx, cy);
        return !!hit && (hit.id === 'pc-mu-x' || hit.closest('#pc-mu-x') != null);
      });
      expect(ok, `X clicável (dentro da tela) em zoom ${zoom}`).toBe(true);
    }
    // Limpa o zoom pra não afetar outros testes na mesma página.
    await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  });
});

// 4) Helper de porcentagem (puro) — mapeia progresso corretamente.
test('4) updateProgress: normalizePercent e updateDisplay mapeiam certo', async () => {
  expect(normalizePercent(42.7)).toBe(43);
  expect(normalizePercent(150)).toBe(100);
  expect(normalizePercent(-1)).toBe(0);
  expect(normalizePercent(undefined)).toBe(0);

  // Baixando sem progresso ainda → indeterminado (nunca 0% congelado).
  expect(updateDisplay({ status: { downloading: true, percent: 0 }, working: true, lastProgressAt: 0, now: 1000 }).indeterminate).toBe(true);
  // Progresso real → porcentagem.
  const d = updateDisplay({ status: { percent: 55 }, working: true, lastProgressAt: 900, now: 1000, stallMs: 4000 });
  expect(d.indeterminate).toBe(false);
  expect(d.percent).toBe(55);
  // Travado → volta pra indeterminado.
  expect(updateDisplay({ status: { percent: 40 }, working: true, lastProgressAt: 1000, now: 6000, stallMs: 4000 }).indeterminate).toBe(true);
  // Baixado → pronto; erro → estado de erro.
  expect(updateDisplay({ status: { downloaded: true }, working: true }).mode).toBe('ready');
  expect(updateDisplay({ status: { error: 'x' }, working: true }).mode).toBe('error');
});
