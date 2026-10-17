// Recursos de chat (tópicos, aviso de fixar, status, pular pra mensagem
// antiga): helpers puros do cliente.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isThreadRoot, threadRoomKey, isThreadArchived, threadReplyLabel, mergeThreadSummary, suggestThreadName,
  parseSystemMessage, STATUS_DURATIONS, statusExpiryPayload, describeStatusExpiry, windowReachesLoaded,
} from '../src/utils/chatFeatures.js';

test('tópico: raiz = mensagem de canal com título que responde outra (post de fórum não conta)', () => {
  assert.equal(isThreadRoot({ channelId: 'c', title: 'T', replyToId: 'p' }), true);
  assert.equal(isThreadRoot({ channelId: 'c', title: 'Post do fórum', replyToId: null }), false);
  assert.equal(isThreadRoot({ conversationId: 'd', title: 'T', replyToId: 'p' }), false);
  assert.equal(isThreadRoot(null), false);
  assert.equal(threadRoomKey('abc'), 'thread:abc');
  assert.equal(isThreadArchived({ archived: true }), true);
  assert.equal(isThreadArchived({ threadArchivedAt: '2026-10-01T00:00:00Z' }), true);
  assert.equal(isThreadArchived({}), false);
});

test('tópico: rótulo de respostas e nome sugerido', () => {
  assert.equal(threadReplyLabel(0), 'Nenhuma resposta');
  assert.equal(threadReplyLabel(1), '1 resposta');
  assert.equal(threadReplyLabel(12), '12 respostas');
  assert.equal(threadReplyLabel(5000), '999+ respostas');
  assert.equal(suggestThreadName('  **Bora** jogar   hoje? https://x.com/a  '), 'Bora jogar hoje?');
  assert.equal(suggestThreadName('a'.repeat(100), 20).length, 20);
  assert.equal(suggestThreadName(''), '');
  assert.equal(suggestThreadName('<:pepe:123> oi'), 'pepe oi');
});

test('tópico: message:update sem prévia mantém a última resposta que já tinha', () => {
  const prev = { id: 'r', threadLastReplyId: 'x', threadLastReply: { id: 'x', preview: 'oi' } };
  const fromReaction = { id: 'r', threadLastReplyId: 'x', reactions: [1] };
  assert.deepEqual(mergeThreadSummary(prev, fromReaction).threadLastReply, { id: 'x', preview: 'oi' });
  // resposta nova: a prévia antiga não vale mais
  assert.equal(mergeThreadSummary(prev, { id: 'r', threadLastReplyId: 'y' }).threadLastReply, undefined);
  // atualização que já traz prévia vence
  const withNew = { id: 'r', threadLastReplyId: 'y', threadLastReply: { id: 'y' } };
  assert.equal(mergeThreadSummary(prev, withNew), withNew);
});

test('aviso do sistema: só embed marcado como system', () => {
  assert.deepEqual(parseSystemMessage(JSON.stringify({ system: 'pin', targetId: 'm1' })), { system: 'pin', targetId: 'm1' });
  assert.equal(parseSystemMessage(JSON.stringify({ title: 'embed comum' })), null);
  assert.equal(parseSystemMessage('{"system": quebrado'), null);
  assert.equal(parseSystemMessage(null), null);
});

test('status: opções 30 min, 1h, 4h, hoje (fim do dia local) e nunca', () => {
  assert.deepEqual(STATUS_DURATIONS.map((d) => d.id), ['30m', '1h', '4h', 'today', 'never']);
  assert.deepEqual(statusExpiryPayload('30m'), { durationMinutes: 30 });
  assert.deepEqual(statusExpiryPayload('1h'), { durationMinutes: 60 });
  assert.deepEqual(statusExpiryPayload('4h'), { durationMinutes: 240 });
  assert.deepEqual(statusExpiryPayload('never'), { durationMinutes: null });
  assert.deepEqual(statusExpiryPayload('???'), { durationMinutes: null });
  const now = new Date(2026, 9, 17, 14, 30, 0);
  const { expiresAt } = statusExpiryPayload('today', now);
  const end = new Date(expiresAt);
  assert.equal(end.getDate(), 17);
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
});

test('status: texto de quando some', () => {
  const now = new Date(2026, 9, 17, 14, 0, 0);
  assert.equal(describeStatusExpiry(null, now), null);
  assert.equal(describeStatusExpiry(new Date(now.getTime() - 1000).toISOString(), now), null);
  assert.equal(describeStatusExpiry(new Date(now.getTime() + 25 * 60000).toISOString(), now), 'Some em 25 min');
  assert.match(describeStatusExpiry(new Date(2026, 9, 17, 23, 59).toISOString(), now), /^Some às 23:59$/);
  assert.match(describeStatusExpiry(new Date(2026, 9, 18, 8, 0).toISOString(), now), /^Some amanhã às 08:00$/);
});

test('pular pra mensagem antiga: janela só costura quando encosta no que já está carregado', () => {
  const loaded = [{ id: 'm50', createdAt: '2026-10-10T10:00:00Z' }, { id: 'm51', createdAt: '2026-10-10T10:01:00Z' }];
  assert.equal(windowReachesLoaded([{ id: 'm1', createdAt: '2026-01-01T00:00:00Z' }], loaded), false);
  assert.equal(windowReachesLoaded([{ id: 'm49', createdAt: '2026-10-10T09:59:00Z' }, { id: 'm50', createdAt: '2026-10-10T10:00:00Z' }], loaded), true);
  assert.equal(windowReachesLoaded([{ id: 'mx', createdAt: '2026-10-10T10:00:30Z' }], loaded), true);
  assert.equal(windowReachesLoaded([], loaded), false);
  assert.equal(windowReachesLoaded([{ id: 'a', createdAt: '2026-01-01T00:00:00Z' }], []), true);
});
