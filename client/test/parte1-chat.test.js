// Parte 1 (velocidade e chat): helpers puros do cliente.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDifferentWebVersion, parseVersionPayload } from '../src/utils/webVersionWatch.js';
import {
  classifySendError, enqueueSend, flushSendQueue, queuedCount, hasQueuedFor, dequeueSend, _resetSendQueue,
} from '../src/utils/sendQueue.js';
import { planImageResize, isAnimatedWebP, isCompressibleType, renameForMime } from '../src/utils/imageCompress.js';
import { sanitizeForCache, updateCacheIndex } from '../src/utils/messageCacheCore.js';
import { swipeAxis, swipeOffset, swipeProgress, swipeShouldReply } from '../src/utils/swipeReplyCore.js';
import { channelFilterQuery, completeChannelFilter, matchChannelsForFilter } from '../src/utils/searchFilters.js';
import { findYouTubeLink, parseYouTubeStart, youTubeEmbedUrl } from '../src/components/voice/ytUtils.js';

test('versão nova: só quando as duas existem e são diferentes', () => {
  assert.equal(isDifferentWebVersion('2026.10.16-1400-abc1234', '2026.10.16-1530-def5678'), true);
  assert.equal(isDifferentWebVersion('2026.10.16-1400-abc1234', '2026.10.16-1400-abc1234'), false);
  assert.equal(isDifferentWebVersion('', '2026.10.16'), false, 'dev (sem versão) nunca avisa');
  assert.equal(isDifferentWebVersion('a', null), false);
  assert.equal(isDifferentWebVersion('a', '<html>'), false, 'lixo (página de erro) não conta');
  assert.equal(parseVersionPayload({ web: 'x1' }), 'x1');
  assert.equal(parseVersionPayload({}), null);
  assert.equal(parseVersionPayload('texto'), null);
});

test('fila offline: classifica os erros de envio', () => {
  assert.equal(classifySendError({ code: 'ERR_NETWORK' }), 'retry');
  assert.equal(classifySendError({ code: 'ECONNABORTED' }), 'retry');
  for (const status of [502, 503, 504, 408]) assert.equal(classifySendError({ response: { status } }), 'retry', String(status));
  for (const status of [400, 403, 413, 429, 500]) assert.equal(classifySendError({ response: { status } }), 'fail', String(status));
  assert.equal(classifySendError({ code: 'ERR_CANCELED', name: 'CanceledError' }), 'canceled');
  assert.equal(classifySendError(null), 'fail');
});

test('fila offline: reenvia na ordem e para no primeiro que ainda não foi', async () => {
  _resetSendQueue();
  const order = [];
  let online = false;
  const make = (id) => async () => { if (!online) return 'retry'; order.push(id); return 'ok'; };
  enqueueSend('a', make('a'), 'room1');
  enqueueSend('b', make('b'), 'room1');
  enqueueSend('c', make('c'), 'room2');
  assert.equal(queuedCount(), 3);
  assert.equal(hasQueuedFor('room1'), true);
  await flushSendQueue();
  assert.equal(queuedCount(), 3, 'sem conexão nada sai');
  online = true;
  await flushSendQueue();
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.equal(queuedCount(), 0);
  assert.equal(hasQueuedFor('room1'), false);
  _resetSendQueue();
});

test('fila offline: recusado (fail) sai da fila e não trava os próximos; descartar tira', async () => {
  _resetSendQueue();
  const done = [];
  enqueueSend('x', async () => 'fail');
  enqueueSend('y', async () => { done.push('y'); return 'ok'; });
  enqueueSend('z', async () => { done.push('z'); return 'ok'; });
  dequeueSend('z');
  await flushSendQueue();
  assert.deepEqual(done, ['y']);
  assert.equal(queuedCount(), 0);
  _resetSendQueue();
});

test('compressão: decide quando e como reduzir a foto', () => {
  const MB = 1024 * 1024;
  assert.equal(planImageResize({ type: 'image/jpeg', size: 1 * MB, width: 1200, height: 900 }), null, 'pequena: manda como está');
  assert.equal(planImageResize({ type: 'image/gif', size: 8 * MB, width: 4000, height: 3000 }), null, 'GIF nunca');
  assert.equal(planImageResize({ type: 'video/mp4', size: 8 * MB, width: 4000, height: 3000 }), null);
  const big = planImageResize({ type: 'image/jpeg', size: 6 * MB, width: 4032, height: 3024 });
  assert.deepEqual(big, { width: 2560, height: 1920, mime: 'image/webp', quality: 0.85 });
  const tall = planImageResize({ type: 'image/png', size: 1 * MB, width: 1000, height: 5120 });
  assert.equal(tall.height, 2560);
  assert.equal(tall.width, 500);
  const heavy = planImageResize({ type: 'image/jpeg', size: 3 * MB, width: 2000, height: 1500 });
  assert.equal(heavy.width, 2000, 'só recodifica, sem aumentar');
  const noWebp = planImageResize({ type: 'image/jpeg', size: 6 * MB, width: 4000, height: 3000 }, { canWebp: false });
  assert.equal(noWebp.mime, 'image/jpeg');
  assert.equal(planImageResize({ type: 'image/png', size: 3 * MB, width: 2000, height: 1500 }, { canWebp: false }), null, 'PNG sem WebP não vira JPEG (perderia transparência)');
  assert.equal(isCompressibleType('image/webp'), true);
  assert.equal(isCompressibleType('image/gif'), false);
  assert.equal(renameForMime('foto.final.JPG', 'image/webp'), 'foto.final.webp');
  assert.equal(renameForMime('', 'image/jpeg'), 'imagem.jpg');
});

test('compressão: reconhece WebP animado pelo cabeçalho', () => {
  const header = (flags) => {
    const b = new Uint8Array(32);
    const put = (at, str) => { for (let i = 0; i < str.length; i += 1) b[at + i] = str.charCodeAt(i); };
    put(0, 'RIFF'); put(8, 'WEBP'); put(12, 'VP8X');
    b[20] = flags;
    return b;
  };
  assert.equal(isAnimatedWebP(header(0x02)), true);
  assert.equal(isAnimatedWebP(header(0x10)), false);
  assert.equal(isAnimatedWebP(new Uint8Array([1, 2, 3])), false);
});

test('cache de mensagens: só guarda o confirmado, sem campos da tela', () => {
  const msgs = [
    { id: 'm1', content: 'a', _animateIn: true, nonce: 'temp-1' },
    { id: 'temp-2', content: 'b', pending: true },
    { id: 'm3', content: 'c', deleted: true },
    { id: 'm4', content: 'd', upload: { pct: 3 } },
    { id: 'm5', content: 'e', queued: true },
  ];
  const clean = sanitizeForCache(msgs);
  assert.deepEqual(clean, [{ id: 'm1', content: 'a' }, { id: 'm4', content: 'd' }]);
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}` }));
  const last = sanitizeForCache(many, 50);
  assert.equal(last.length, 50);
  assert.equal(last[0].id, 'm30');
});

test('cache de mensagens: índice com teto de salas, de tamanho e de idade', () => {
  let idx = [];
  let evicted = [];
  for (let i = 0; i < 5; i += 1) {
    const r = updateCacheIndex(idx, `room${i}`, 100, 1000 + i, { maxRooms: 3, maxChars: 10_000 });
    idx = r.index; evicted = evicted.concat(r.evict);
  }
  assert.deepEqual(idx.map((e) => e.r), ['room2', 'room3', 'room4']);
  assert.deepEqual(evicted, ['room0', 'room1']);
  // Reabrir uma sala leva ela pro fim (mais recente).
  idx = updateCacheIndex(idx, 'room2', 100, 2000, { maxRooms: 3 }).index;
  assert.deepEqual(idx.map((e) => e.r), ['room3', 'room4', 'room2']);
  // Teto de tamanho total.
  const big = updateCacheIndex(idx, 'huge', 950, 2001, { maxRooms: 10, maxChars: 1000 });
  assert.ok(big.evict.includes('room3'));
  assert.ok(big.index.reduce((n, e) => n + e.n, 0) <= 1000);
  // Velhas demais saem.
  const aged = updateCacheIndex([{ r: 'old', at: 0, n: 10 }], 'new', 10, 10_000, { maxAge: 5000 });
  assert.deepEqual(aged.evict, ['old']);
});

test('arrastar pra responder: direção, deslocamento e ponto de responder', () => {
  assert.equal(swipeAxis(4, 3), null);
  assert.equal(swipeAxis(30, 5), 'x');
  assert.equal(swipeAxis(30, 25), 'y', 'diagonal é rolagem');
  assert.equal(swipeAxis(-30, 2), 'y', 'pra esquerda não é resposta');
  assert.equal(swipeAxis(2, 40), 'y');
  assert.equal(swipeOffset(-10), 0);
  assert.equal(swipeOffset(40), 40);
  assert.ok(swipeOffset(100) < 100 && swipeOffset(100) > 60);
  assert.equal(swipeOffset(1000), 96);
  assert.equal(swipeProgress(30), 0.5);
  assert.equal(swipeProgress(200), 1);
  assert.equal(swipeShouldReply(59), false);
  assert.equal(swipeShouldReply(60), true);
});

test('busca: filtro em:#canal / in:#canal', () => {
  assert.equal(channelFilterQuery('oi em:#ge'), 'ge');
  assert.equal(channelFilterQuery('in:#'), '');
  assert.equal(channelFilterQuery('em:geral'), 'geral');
  assert.equal(channelFilterQuery('em:#geral oi'), null, 'já completou');
  assert.equal(channelFilterQuery('membros'), null);
  assert.equal(completeChannelFilter('oi em:#ge', 'geral'), 'oi em:#geral ');
  assert.equal(completeChannelFilter('in:#ba', 'bate papo'), 'in:"bate papo" ');
  const channels = [
    { id: '1', name: 'geral', type: 'TEXT' },
    { id: '2', name: 'Anúncios', type: 'ANNOUNCEMENT' },
    { id: '3', name: 'voz-geral', type: 'VOICE' },
    { id: '4', name: 'memes-gerais', type: 'TEXT' },
    { id: '1', name: 'geral', type: 'TEXT' },
  ];
  assert.deepEqual(matchChannelsForFilter(channels, 'ger').map((c) => c.id), ['1', '4']);
  assert.deepEqual(matchChannelsForFilter(channels, 'anuncio').map((c) => c.id), ['2']);
  assert.equal(matchChannelsForFilter(channels, '').length, 3);
});

test('YouTube: acha o vídeo no texto (watch, youtu.be, shorts) e o início', () => {
  assert.deepEqual(findYouTubeLink('olha isso https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s kkk'),
    { id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s', start: 65, isShort: false });
  assert.equal(findYouTubeLink('https://youtu.be/dQw4w9WgXcQ?t=42').start, 42);
  assert.equal(findYouTubeLink('https://youtube.com/shorts/dQw4w9WgXcQ').isShort, true);
  assert.equal(findYouTubeLink('https://m.youtube.com/watch?v=dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.equal(findYouTubeLink('primeiro https://exemplo.com e depois https://youtu.be/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.equal(findYouTubeLink('https://youtube.com.golpe.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(findYouTubeLink('https://www.youtube.com/@canal'), null);
  assert.equal(findYouTubeLink('sem link'), null);
  assert.equal(parseYouTubeStart('https://youtu.be/x?t=1h2m3s'), 3723);
  assert.equal(parseYouTubeStart('https://youtu.be/x?t=abc'), 0);
  const embed = youTubeEmbedUrl('dQw4w9WgXcQ', { start: 65, origin: 'https://projectclub.shardweb.app' });
  assert.ok(embed.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?'));
  assert.ok(embed.includes('autoplay=1') && embed.includes('start=65'));
});
