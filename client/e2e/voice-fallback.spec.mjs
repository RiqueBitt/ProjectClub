import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { handler, imageHandler } from './mock-api.mjs';

// Modo reserva (Jitsi): quando /api/voice/join responde "jitsi" (servidor
// de mídia próprio fora do ar), entrar num canal de voz deve conectar pelo Jitsi
// e mostrar o aviso "Chamada em modo reserva" — sem deslogar ninguém.
// Aqui o external_api.js do Jitsi é SIMULADO (stub), então o teste não
// depende de rede nem de um iframe real. Salva captura em /tmp/claude-0/calls.
const SHOTS = process.env.CALLS_SHOTS_DIR || '/tmp/claude-0/calls';
fs.mkdirSync(SHOTS, { recursive: true });

// Stub mínimo da Jitsi IFrame External API: define window.JitsiMeetExternalAPI
// com a mesma superfície que o engine usa (addListener/removeListener/
// executeCommand/dispose/isAudioMuted...). Ao ser construído, "entra" na
// conferência no próximo tick.
const JITSI_STUB = `
window.JitsiMeetExternalAPI = class {
  constructor(domain, options) {
    this.domain = domain; this.options = options || {}; this._l = {};
    // Marca visível pra depuração: um nó dentro do parentNode.
    try { if (options && options.parentNode) { var d = document.createElement('div'); d.setAttribute('data-fake-jitsi','1'); d.textContent='Jitsi (simulado)'; options.parentNode.appendChild(d); } } catch (e) {}
    var self = this;
    setTimeout(function(){ self._emit('videoConferenceJoined', { id: 'me', roomName: (options||{}).roomName }); }, 0);
  }
  addListener(ev, fn) { (this._l[ev] = this._l[ev] || []).push(fn); }
  removeListener(ev, fn) { this._l[ev] = (this._l[ev]||[]).filter(function(f){ return f !== fn; }); }
  _emit(ev, p) { (this._l[ev]||[]).slice().forEach(function(fn){ try { fn(p); } catch(e){} }); }
  executeCommand() {}
  isAudioMuted() { return Promise.resolve(true); }
  isVideoMuted() { return Promise.resolve(true); }
  getParticipantsInfo() { return []; }
  dispose() {}
};
`;

const JITSI_PROVIDER = { provider: 'jitsi', reason: 'fallback', minutesUsed: 0, limit: null };
const JITSI_JOIN = {
  ...JITSI_PROVIDER,
  jitsi: { domain: 'meet.jit.si', room: 'projectclub-teste-reserva', jwt: null },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('layoutStyle', 'normal2');
      sessionStorage.setItem('inicio-redirect-done', '1');
    } catch { /* sem storage */ }
  });
  // Handler genérico primeiro; as rotas específicas de /voice vêm DEPOIS
  // (o Playwright dá precedência à rota registrada por ÚLTIMO).
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // O servidor manda usar o Jitsi (precedência sobre o /api/** padrão).
  await page.route('**/api/voice/provider', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(JITSI_PROVIDER) }));
  await page.route('**/api/voice/join**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(JITSI_JOIN) }));
  // external_api.js do Jitsi → stub local (nada de rede).
  await page.route('**/external_api.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: JITSI_STUB }));
  // Qualquer outra chamada ao domínio do Jitsi (ex.: a página da sala) é
  // cortada — o stub não abre iframe real.
  await page.route(/meet\.jit\.si\/(?!external_api\.js)/, (r) => r.abort());
});

test('entra em modo reserva (Jitsi) e mostra o aviso quando o servidor manda jitsi', async ({ page }) => {
  // Abre direto o canal de voz "Call ¹" (id v1 no mock-api).
  await page.goto('/channels/v1');

  // Lobby do canal de voz: botão de entrar.
  const joinBtn = page.getByRole('button', { name: /Entrar na chamada/ });
  await expect(joinBtn).toBeVisible({ timeout: 20_000 });
  await joinBtn.click();

  // Conectou pelo Jitsi → o aviso de modo reserva aparece (na tela da
  // chamada e/ou na barra de chamada).
  await expect(page.getByText(/Chamada em modo reserva/).first()).toBeVisible({ timeout: 20_000 });

  // O palco do Jitsi (stub) foi montado dentro da tela da chamada.
  await expect(page.locator('.vc-jitsi-mount')).toBeVisible();

  await page.screenshot({ path: `${SHOTS}/voice-fallback.png`, fullPage: true });
});
