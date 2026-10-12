import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { handler, imageHandler } from './mock-api.mjs';

// Turminha do login (AuthCharacters) + botões "Entrar com…": muda de
// expressão conforme a pessoa digita, foca a senha, mostra a senha, erra
// e acerta. Também tira fotos de cada estado no PC (1440) e no celular
// (430) em SHOTS_DIR, pra revisão visual.
const SHOTS_DIR = process.env.LOGIN_SHOTS_DIR || '/tmp/claude-0/login-shots';
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const SIZES = [
  { name: 'pc', width: 1440, height: 900 },
  { name: 'celular', width: 430, height: 932 },
];

const ME = { id: 'u1', username: 'ana', displayName: 'Ana', emailVerified: true, email: 'ana@exemplo.com' };

async function mockApi(page) {
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace(/^\/api/, '');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/auth/refresh') return json({ error: 'Sessão expirada.' }, 401);
    if (p === '/auth/oauth/providers') return json({ providers: [{ id: 'google', label: 'Google' }, { id: 'discord', label: 'Discord' }, { id: 'github', label: 'GitHub' }] });
    if (p === '/auth/oauth/signup') return json({ pending: null });
    if (p === '/platform/status') return json({ maintenanceMode: false });
    if (p === '/auth/login') {
      const body = JSON.parse(req.postData() || '{}');
      if (body.password === 'senhaCerta1') return json({ user: ME, accessToken: 'tok' });
      return json({ error: 'Credenciais inválidas.' }, 401);
    }
    return json({});
  });
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
}

// Espera o modo (e, opcionalmente, um detalhe do desenho) no MESMO quadro —
// as reações duram ~1,2s, então nada de checar em duas etapas.
const waitMode = (page, m, extra = null) => page.waitForFunction(([want, sel]) => {
  if (document.querySelector('.pcc-stage')?.dataset.mode !== want) return false;
  return !sel || !!document.querySelector(sel);
}, [m, extra], { polling: 'raf', timeout: 15_000 });
const mode = (page) => page.locator('.pcc-stage').getAttribute('data-mode');
const pupil = (page) => page.locator('.pcc-roxo .pcc-pupil').first().evaluate((el) => el.style.transform);
const shot = (page, size, name) => page.screenshot({ path: `${SHOTS_DIR}/${size}-${name}.png` });

for (const size of SIZES) {
  test.describe(`login ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('bonequinhos reagem ao formulário', async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await mockApi(page);
      await page.goto('/login');
      const stage = page.locator('.pcc-stage');
      await expect(stage).toBeVisible();
      await expect(stage).toHaveAttribute('aria-hidden', 'true');
      // Botões de OAuth aparecem (provedores simulados).
      await expect(page.getByRole('button', { name: 'Entrar com Discord' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Entrar com GitHub' })).toBeVisible();

      // Parado: segue o mouse. O campo de e-mail começa com foco
      // (autoFocus), então tira o foco antes.
      await page.locator('.pc-auth-head h1').click();
      await expect.poll(() => mode(page)).toBe('idle');
      await page.mouse.move(size.width * 0.15, size.height * 0.1);
      await page.mouse.move(size.width * 0.2, size.height * 0.12);
      await page.waitForTimeout(450);
      const idlePupil = await pupil(page);
      await shot(page, size.name, '1-parado');

      // Digitando: inclinam pro campo e os olhos acompanham o cursor.
      const email = page.getByLabel('E-mail ou ClubTag');
      await email.click();
      await email.pressSequentially('ana', { delay: 20 });
      await expect.poll(() => mode(page)).toBe('typing');
      await page.waitForTimeout(350);
      const p1 = await pupil(page);
      await email.pressSequentially('@exemplo.com.br', { delay: 15 });
      await page.waitForTimeout(350);
      const p2 = await pupil(page);
      expect(p1).not.toBe(idlePupil);
      expect(p2).not.toBe(p1); // o cursor andou, as pupilas também
      await shot(page, size.name, '2-digitando');

      // Senha: fecham os olhos / olham pro lado.
      const pass = page.getByLabel('Senha', { exact: true });
      await pass.click();
      await pass.pressSequentially('senhaErrada1', { delay: 10 });
      // Laranja de olhos fechados (pálpebra visível, olho aberto escondido).
      await waitMode(page, 'password', '.pcc-laranja .pcc-lid[style*="opacity: 1"]');
      await page.waitForTimeout(450);
      await shot(page, size.name, '3-senha');

      // "Mostrar senha" com texto: o roxo espia.
      await page.getByRole('button', { name: 'Mostrar senha' }).focus();
      await page.keyboard.press('Enter');
      await expect(pass).toHaveAttribute('type', 'text');
      await waitMode(page, 'peek', '.pcc-hands');
      await page.waitForTimeout(450);
      await shot(page, size.name, '4-espiando');
      await page.keyboard.press('Enter'); // esconde de novo
      await expect(pass).toHaveAttribute('type', 'password');

      // Erro: tremem com cara de espanto/bravos (~1,2s) e voltam.
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      // Sobrancelha brava aparece no mesmo quadro do modo "error".
      await waitMode(page, 'error', '.pcc-roxo .pcc-brows[data-on]');
      await expect(page.locator('.pc-alert-error')).toContainText('Credenciais inválidas');
      await page.waitForTimeout(260);
      await shot(page, size.name, '5-erro');
      await expect.poll(() => mode(page), { timeout: 3000 }).not.toBe('error');

      // Nenhum erro de JavaScript nas telas de login (depois do sucesso o
      // app abre com a API simulada vazia — fora do escopo deste teste).
      expect(errors).toEqual([]);

      // Sucesso: pulinho antes de entrar.
      await pass.fill('senhaCerta1');
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await waitMode(page, 'success');
      await page.waitForTimeout(280);
      await shot(page, size.name, '6-sucesso');
      await expect(page).toHaveURL(/\/inicio$/);
    });

    test('inscrição e esqueci a senha também têm a turma', async ({ page }) => {
      await mockApi(page);
      await page.goto('/register');
      await expect(page.locator('.pcc-stage')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Inscrever-se com Discord' })).toBeVisible();
      await page.locator('.pc-auth-head h1').click();
      await page.waitForTimeout(300);
      await shot(page, size.name, '7-inscricao');
      await page.goto('/forgot-password');
      await expect(page.locator('.pcc-stage')).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, size.name, '8-esqueci-senha');
    });

    test('erro vindo do provedor aparece com a turma brava', async ({ page }) => {
      await mockApi(page);
      await page.goto('/login?oauth_error=email_existente&provider=github');
      await expect(page.locator('.pc-alert-error')).toContainText('Configurações → Segurança');
      await expect.poll(() => mode(page)).toBe('error');
      await expect(page).toHaveURL(/\/login$/);
      await page.waitForTimeout(250);
      await shot(page, size.name, '9-erro-oauth');
    });
  });
}

test('modo calmo (prefers-reduced-motion): sem animação contínua', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApi(page);
  await page.goto('/login');
  const stage = page.locator('.pcc-stage');
  await expect(stage).toHaveAttribute('data-calm', 'true');
  await expect(page.locator('.pcc-breathe').first()).toHaveCSS('animation-name', 'none');
  await page.getByLabel('Senha', { exact: true }).click();
  await expect.poll(() => mode(page)).toBe('password');
});

test('Configurações → Segurança: contas conectadas (conectar/desconectar)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('layoutStyle', 'normal2');
      sessionStorage.setItem('inicio-redirect-done', '1');
    } catch { /* sem storage */ }
  });
  let unlinked = null;
  let accounts = [{ provider: 'discord', email: 'ana@exemplo.com', createdAt: '2026-10-01T12:00:00.000Z' }];
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/auth/oauth/accounts') {
      return json({ accounts, providers: [{ id: 'google', label: 'Google', enabled: true }, { id: 'discord', label: 'Discord', enabled: true }, { id: 'github', label: 'GitHub', enabled: true }] });
    }
    if (p.startsWith('/api/auth/oauth/accounts/') && req.method() === 'DELETE') {
      unlinked = p.split('/').pop();
      accounts = [];
      return json({ ok: true });
    }
    if (p === '/api/auth/oauth/github/link') return json({ url: '/oauth/retorno?vinculado=github' });
    return handler(route);
  });
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

  await page.goto('/inicio');
  await expect(page.locator('.home-hero')).toBeVisible({ timeout: 20_000 });
  await page.locator('.top-search-bar-icon-btn[title="Configurações"]').click();
  await expect(page.locator('.settings-modal-layout')).toBeVisible();
  await page.locator('.settings-modal-sidebar-item', { hasText: 'Segurança' }).first().click();
  const block = page.getByTestId('connected-accounts');
  await expect(block).toBeVisible();
  await expect(block).toContainText('Conectada (ana@exemplo.com)');
  await block.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS_DIR}/pc-10-contas-conectadas.png` });
  await block.getByRole('button', { name: 'Desconectar' }).click();
  await expect.poll(() => unlinked).toBe('discord');
  await expect(block).toContainText('Discord desconectado.');

  // Conectar: segue pra URL do provedor (aqui, direto pra volta simulada),
  // e a volta reabre as Configurações em Segurança com o aviso.
  await block.getByRole('button', { name: 'Conectar' }).last().click();
  await expect(page.getByTestId('connected-accounts')).toContainText('GitHub conectada', { timeout: 20_000 });
});
