import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { handler, imageHandler } from './mock-api.mjs';

// Configurações "Voz e vídeo": confere que os novos controles aparecem e
// que a escolha fica guardada (redutor de ruído B, apertar pra falar F,
// nivelar volume E, legendas K). Salva captura em /tmp/claude-0/calls/.
const SHOTS = process.env.CALLS_SHOTS_DIR || '/tmp/claude-0/calls';
fs.mkdirSync(SHOTS, { recursive: true });

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

async function openVoiceSettings(page) {
  await page.goto('/inicio');
  await expect(page.locator('.home-hero')).toBeVisible({ timeout: 20_000 });
  await page.locator('.top-search-bar-icon-btn[title="Configurações"]').click();
  await expect(page.locator('.settings-modal-layout')).toBeVisible();
  // Aba "Voz e vídeo".
  await page.getByText(/^Voz e vídeo$/).first().click();
  await expect(page.getByRole('heading', { name: 'Redutor de ruído' })).toBeVisible();
}

test('Voz e vídeo mostra os novos controles e guarda as escolhas', async ({ page }) => {
  await openVoiceSettings(page);

  // Os quatro blocos novos aparecem.
  await expect(page.getByRole('heading', { name: 'Redutor de ruído' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Apertar pra falar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nivelar volume automaticamente' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Legendas ao vivo/ })).toBeVisible();

  await page.screenshot({ path: `${SHOTS}/voice-settings.png`, fullPage: true });

  // Redutor de ruído começa ligado; desligar guarda noiseReduction:false.
  const denoise = page.getByRole('switch', { name: 'Redutor de ruído' });
  await expect(denoise).toHaveAttribute('aria-checked', 'true');
  await denoise.click();
  await expect(denoise).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => {
    return page.evaluate(() => JSON.parse(localStorage.getItem('pc.voicePrefs') || '{}').noiseReduction);
  }).toBe(false);

  // Ligar "apertar pra falar" revela a troca de tecla e guarda a escolha.
  const ptt = page.getByRole('switch', { name: 'Apertar pra falar' });
  await expect(ptt).toHaveAttribute('aria-checked', 'false');
  await ptt.click();
  await expect(ptt).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: /Trocar tecla/ })).toBeVisible();
  await expect.poll(async () => {
    return page.evaluate(() => JSON.parse(localStorage.getItem('pc.voicePrefs') || '{}').pushToTalkEnabled);
  }).toBe(true);
  // Atraso ao soltar a tecla (folga do PTT) também é guardado.
  const release = page.getByRole('slider', { name: /Atraso ao soltar a tecla/ });
  await expect(release).toHaveValue('200');
  await release.fill('400');
  await expect.poll(async () => {
    return page.evaluate(() => JSON.parse(localStorage.getItem('pc.voicePrefs') || '{}').pushToTalkReleaseMs);
  }).toBe(400);

  // Volume de entrada do microfone (0–200%).
  const inputVol = page.getByRole('slider', { name: 'Volume de entrada do microfone' });
  await expect(inputVol).toHaveValue('100');
  await inputVol.fill('150');
  await expect(page.getByRole('region', { name: 'Volume de entrada' }).locator('output')).toHaveText('150%');
  await expect.poll(async () => {
    return page.evaluate(() => JSON.parse(localStorage.getItem('pc-extra-prefs') || '{}').inputVolume);
  }).toBe(150);

  // Nivelar volume guarda autoLevelVolume:true.
  const auto = page.getByRole('switch', { name: 'Nivelar volume automaticamente' });
  await auto.click();
  await expect.poll(async () => {
    return page.evaluate(() => JSON.parse(localStorage.getItem('pc.voicePrefs') || '{}').autoLevelVolume);
  }).toBe(true);
});
