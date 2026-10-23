import { test, expect } from '@playwright/test';
import { handler, imageHandler, ME } from './mock-api.mjs';

// Recursos de chat: aviso "fixou uma mensagem", tópico a partir de uma
// mensagem (cartão na lista + painel à direita / tela cheia no celular,
// responder no tópico) e lista de tópicos do cabeçalho.
const SHOTS = process.env.FEAT_SHOTS;
const shot = async (page, name, info) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png` }); };
const now = Date.now();
const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();
const LIA = { id: '5', username: 'lia', displayName: 'Lia', avatarUrl: null, status: 'ONLINE' };
const base = (id, author, content, minsAgo, extra = {}) => ({
  id, authorId: author.id, author, content, createdAt: iso(minsAgo), channelId: 'ch2', reactions: [], attachments: [], ...extra,
});
const parent = base('p1', LIA, 'Bora organizar o torneio de sábado?', 40);
const root = base('t1', ME, null, 38, {
  title: 'Torneio de sábado', replyToId: 'p1', replyTo: parent, isThread: true,
  threadReplyCount: 2, threadLastReplyId: 'r2', threadLastReplyAt: iso(20),
  threadLastReply: { id: 'r2', createdAt: iso(20), author: LIA, preview: 'Eu levo o controle extra' },
});
const pinSystem = base('s1', ME, null, 10, { embed: JSON.stringify({ system: 'pin', targetId: 'p1', description: '📌 RiqueBitt fixou uma mensagem neste canal.' }) });
const channelMessages = [parent, root, base('m9', LIA, 'fechado então', 15), pinSystem];
const replies = [
  base('r1', ME, 'Começa às 15h?', 30, { threadId: 't1' }),
  base('r2', LIA, 'Eu levo o controle extra', 20, { threadId: 't1' }),
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('theme', 'dark'); localStorage.setItem('layoutStyle', 'normal2'); sessionStorage.setItem('inicio-redirect-done', '1'); } catch { /* sem storage */ }
  });
  await page.route('**/api/**', handler);
  await page.route('**/socket.io/**', (r) => r.abort());
  await page.route('**/mock-img/**', imageHandler);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const sent = [];
  page.sentThreadReplies = sent;
  // Rotas registradas depois têm prioridade sobre o handler geral.
  await page.route(/\/api\/messages(\?|$)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'POST') {
      const body = req.postData() || '';
      sent.push(body);
      const content = (body.match(/name="content"\r\n\r\n([^\r]*)/) || [])[1] || '';
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ message: base(`new${sent.length}`, ME, content, 0, { threadId: 't1' }) }) });
    }
    if (url.searchParams.get('threadId') === 't1') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [root, ...replies] }) });
    }
    const list = url.searchParams.get('channelId') === 'ch2' && !url.searchParams.get('before') ? channelMessages : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: list }) });
  });
  await page.route(/\/api\/messages\/threads/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ threads: [root] }) }));
});

test('tópicos e aviso de fixar no chat', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/channels/ch2');

  // Aviso do sistema ao fixar.
  const sys = page.locator('.chat-system-row', { hasText: 'fixou' });
  await expect(sys).toBeVisible({ timeout: 20_000 });
  await expect(sys).toContainText('RiqueBitt fixou uma mensagem neste canal');

  // Raiz do tópico vira a linha "criou um tópico" com contador + prévia.
  const starter = page.locator('.thread-starter-row');
  await expect(starter).toContainText('Torneio de sábado');
  await expect(starter).toContainText('2 respostas');
  await expect(starter).toContainText('Eu levo o controle extra');
  await shot(page, 'chat-topico-fixar', info);

  // Abre o painel do tópico.
  await starter.locator('.thread-card').click();
  const panel = page.locator('.thread-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('h3')).toHaveText('Torneio de sábado');
  await expect(panel).toContainText('Bora organizar o torneio de sábado?'); // mensagem de origem
  await expect(panel).toContainText('Começa às 15h?');
  await shot(page, 'painel-topico', info);

  const box = await panel.boundingBox();
  const vw = page.viewportSize().width;
  if (info.project.name === 'celular') expect(Math.round(box.width)).toBeGreaterThanOrEqual(vw - 1);
  else expect(box.width).toBeLessThanOrEqual(460);

  // Responder no tópico (Enter envia, com threadId).
  const input = panel.getByLabel('Mensagem do tópico');
  await input.fill('Levo pipoca');
  await input.press('Enter');
  await expect(panel).toContainText('Levo pipoca');
  expect(page.sentThreadReplies.some((b) => b.includes('name="threadId"') && b.includes('t1'))).toBe(true);

  // Fecha com o X.
  await panel.getByRole('button', { name: 'Fechar tópico' }).click();
  await expect(panel).toHaveCount(0);

  // Lista de tópicos no cabeçalho reabre o painel.
  await page.getByRole('button', { name: 'Tópicos', exact: true }).click();
  await expect(page.locator('.threads-popover')).toContainText('Torneio de sábado');
  await shot(page, 'lista-topicos', info);
  await page.locator('.threads-popover .thread-card').first().click();
  await expect(page.locator('.thread-panel')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
