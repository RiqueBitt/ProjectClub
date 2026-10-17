// Testes unitários (node --test) da leitura PURA da resposta de
// /api/voice/join — a voz usa só o servidor de mídia próprio.
// Sem React, sem rede, sem DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJoinResponse, VOICE_PROVIDER } from '../src/voice/joinResponse.js';

test('readJoinResponse: credenciais válidas do servidor próprio', () => {
  assert.equal(VOICE_PROVIDER, 'projectclub');
  const ice = [{ urls: ['stun:stun.example:3478'] }];
  const c = readJoinResponse({ provider: 'projectclub', projectclub: { url: 'wss://m.example/ws', token: 't', room: 'pc_1', identity: 'u1', iceServers: ice } });
  assert.deepEqual(c, { url: 'wss://m.example/ws', token: 't', room: 'pc_1', identity: 'u1', iceServers: ice });
  // Sem `provider` (servidor mínimo) também vale.
  assert.ok(readJoinResponse({ projectclub: { url: 'wss://x', token: 't' } }));
  assert.deepEqual(readJoinResponse({ projectclub: { url: 'wss://x', token: 't', iceServers: 'x' } }).iceServers, []);
});

test('readJoinResponse: resposta inválida ou de provedor removido → null', () => {
  for (const bad of [
    null, undefined, {}, 'x', 5,
    { provider: 'projectclub' },
    { provider: 'projectclub', projectclub: { url: '', token: 't' } },
    { provider: 'projectclub', projectclub: { url: 'wss://x' } },
    { provider: 'jitsi', jitsi: { domain: 'meet.jit.si', room: 'r' } },
    { provider: 'livekit', livekit: { url: 'wss://lk', token: 't' } },
    { provider: 'livekit', projectclub: { url: 'wss://x', token: 't' } },
  ]) {
    assert.equal(readJoinResponse(bad), null, JSON.stringify(bad));
  }
});
