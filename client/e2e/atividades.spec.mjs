import { test, expect } from '@playwright/test';
import { handler, imageHandler, ME } from './mock-api.mjs';

// Atividades do chat: rolar dados (cartão animado), cartões de YouTube e
// Música (não tocam sozinhos, o link some do texto) e a escolha do serviço
// de música (YouTube Music / Spotify / Last.fm).
const now = Date.now();
const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();
const ORIGIN = 'http://localhost';
const base = (id, content, minsAgo) => ({ id, authorId: ME.id, author: ME, content, createdAt: iso(minsAgo), channelId: 'ch2', reactions: [], attachments: [] });
const DICE_ID = '11111111-2222-3333-4444-555555555555';
const VIDEO = 'dQw4w9WgXcQ';
const SONG = 'kJQP7kiw5Fk';

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL || ORIGIN).origin;
  const channelMessages = [
    base('d1', `${origin}/atividade/dados/${DICE_ID}`, 3),
    base('v1', `olha esse ${origin}/atividade/video/${VIDEO}`, 2),
    base('s1', `${origin}/atividade/musica/${SONG}`, 1),
  ];
  await page.addInitScript(() => {
    try { localStorage.setItem('theme', 'dark'); localStorage.setItem('layoutStyle', 'normal2'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* */ }
  });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route(/i\.ytimg\.com/, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"/>' }));
  page.sent = [];
  await page.route(/\/api\/messages(\?|$)/, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = req.postData() || '';
      const content = (body.match(/name="content"\r\n\r\n([^\r]*)/) || [])[1] || '';
      page.sent.push(content);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ message: base(`new${page.sent.length}`, content, 0) }) });
    }
    const url = new URL(req.url());
    const list = url.searchParams.get('channelId') === 'ch2' && !url.searchParams.get('before') ? channelMessages : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: list }) });
  });
  const roll = { id: DICE_ID, groups: [{ sides: 20, count: 1, results: [20] }, { sides: 6, count: 2, results: [3, 5] }], modifier: 2, label: 'Ataque', total: 30, notation: '1d20 + 2d6 + 2', user: ME, createdAt: iso(3) };
  await page.route(/\/api\/activities\/dice\/[0-9a-f-]+$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roll) }));
  await page.route(/\/api\/activities\/dice$/, (r) => r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...roll, id: '99999999-2222-3333-4444-555555555555', createdAt: new Date().toISOString() }) }));
  await page.route(/\/api\/activities\/youtube\//, (r) => {
    const id = new URL(r.request().url()).pathname.split('/').pop();
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videoId: id, title: id === VIDEO ? 'Vídeo de teste' : 'Música de teste', channel: 'Canal X', durationSec: 213 }) });
  });
  await page.route(/\/api\/music\/status/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ youtube: { configured: true, connected: false, playlists: [] }, spotify: { configured: true, connected: false, name: null }, lastfm: { configured: false, connected: false, name: null, lists: [] } }) }));
});

test('cartões de dados, vídeo e música no chat (link some do texto)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/channels/ch2');
  const dice = page.locator('.dice-card').first();
  await expect(dice).toBeVisible({ timeout: 20_000 });
  await expect(dice).toContainText('rolou 1d20 + 2d6 + 2');
  await expect(dice.locator('.dice-total strong')).toHaveText('30');
  await expect(dice.locator('.dice-verdict')).toHaveCount(0); // 3 dados: sem "crítico" de D20 sozinho
  await expect(dice.locator('.die')).toHaveCount(3);

  const video = page.locator('.mc-video');
  await expect(video).toContainText('Vídeo de teste');
  // Não toca sozinho: só a capa até clicar.
  await expect(video.locator('iframe')).toHaveCount(0);
  await video.getByRole('button', { name: 'Assistir aqui' }).click();
  await expect(video.locator('iframe')).toHaveAttribute('src', new RegExp(`youtube-nocookie\\.com/embed/${VIDEO}`));

  const music = page.locator('.mc-music');
  await expect(music).toContainText('Música de teste');
  await expect(music.getByRole('button', { name: /Ouvir/ })).toBeVisible();

  // O endereço da atividade não aparece no texto; o resto do texto fica.
  await expect(page.locator('.message-content', { hasText: '/atividade/' })).toHaveCount(0);
  await expect(page.locator('.message-content', { hasText: 'olha esse' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Atividades → Rolar dados escolhe os dados e manda o cartão', async ({ page }, info) => {
  test.skip(info.project.name !== 'pc', 'barra de digitação do PC');
  await page.goto('/channels/ch2');
  await page.getByRole('button', { name: 'Atividades' }).last().click();
  await page.getByRole('button', { name: /Rolar dados/ }).click();
  const picker = page.getByRole('dialog', { name: 'Rolar dados' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Adicionar um D6' }).first().click();
  await picker.getByRole('button', { name: 'Adicionar um D6' }).first().click();
  await expect(picker.locator('.dice-notation')).toHaveText('2d6 + 1d20');
  await picker.getByRole('button', { name: 'Rolar', exact: true }).click();
  await expect(picker).toBeHidden();
  await expect.poll(() => page.sent.length).toBe(1);
  expect(page.sent[0]).toMatch(/\/atividade\/dados\/99999999-2222-3333-4444-555555555555$/);
});

test('Atividades → Música mostra os serviços (Spotify sem chave avisa)', async ({ page }, info) => {
  test.skip(info.project.name !== 'pc', 'barra de digitação do PC');
  await page.goto('/channels/ch2');
  await page.getByRole('button', { name: 'Atividades' }).last().click();
  await page.getByRole('button', { name: /^Música/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Mandar música' });
  await expect(dlg.getByRole('tab', { name: /YouTube Music/ })).toHaveAttribute('aria-selected', 'true');
  await dlg.getByRole('tab', { name: /Spotify/ }).click();
  await expect(dlg.getByRole('button', { name: /Conectar Spotify/ })).toBeVisible();
  await dlg.getByRole('tab', { name: /Last\.fm/ }).click();
  await expect(dlg).toContainText('ainda não foi configurado');
});
