// Testes unitários (node --test) da lógica PURA da cadeia de voz
// (servidor próprio → Agora → Stream). Sem React, sem rede, sem DOM.
// Rodar:  node --test test/voice-provider.test.mjs   (dentro de client/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProviderResponse, shouldSwitchProvider, readJoinResponse, isReserveMode,
  PROVIDER_ORDER, CLIENT_READY_PROVIDERS,
} from '../src/voice/providerDecision.js';

test('cadeia tem só servidor próprio, Agora e Stream — todos prontos no cliente', () => {
  assert.deepEqual(PROVIDER_ORDER, ['projectclub', 'agora', 'getstream']);
  assert.deepEqual(CLIENT_READY_PROVIDERS, ['projectclub', 'agora', 'getstream']);
});

test('normalizeProviderResponse: Stream é modo reserva; próprio e Agora não', () => {
  assert.equal(normalizeProviderResponse({ provider: 'projectclub' }).fallbackActive, false);
  assert.equal(normalizeProviderResponse({ provider: 'agora' }).fallbackActive, false);
  assert.equal(normalizeProviderResponse({ provider: 'getstream' }).fallbackActive, true);
  assert.equal(isReserveMode('getstream'), true);
});

test('normalizeProviderResponse: provedor removido/inválido cai pro agora', () => {
  for (const bad of [null, undefined, {}, { provider: 'jitsi' }, { provider: 'livekit' }, { provider: 5 }, 'x']) {
    assert.equal(normalizeProviderResponse(bad).provider, 'agora');
  }
});

test('shouldSwitchProvider: só troca quando muda de verdade', () => {
  assert.equal(shouldSwitchProvider('agora', 'getstream'), true);
  assert.equal(shouldSwitchProvider('projectclub', 'projectclub'), false);
  assert.equal(shouldSwitchProvider('agora', 'jitsi'), false);
});

test('readJoinResponse: credenciais do Agora', () => {
  const r = readJoinResponse({ provider: 'agora', agora: { token: 't', appId: 'app', uid: 'u1' } });
  assert.deepEqual(r.agora, { token: 't', appId: 'app', uid: 'u1' });
  assert.equal(readJoinResponse({ provider: 'agora', agora: { appId: 'app' } }).agora, null);
});

test('readJoinResponse: credenciais do servidor próprio', () => {
  const r = readJoinResponse({ provider: 'projectclub', projectclub: { url: 'wss://x/ws', token: 'jwt', iceServers: [{ urls: 'stun:x' }] } });
  assert.equal(r.projectclub.url, 'wss://x/ws');
  assert.equal(r.projectclub.iceServers.length, 1);
});

test('readJoinResponse: credenciais do Stream (apiKey + token + callId obrigatórios)', () => {
  const r = readJoinResponse({ provider: 'getstream', getstream: { apiKey: 'k', token: 't', userId: 'u', callId: 'pc_abc' } });
  assert.deepEqual(r.getstream, { apiKey: 'k', token: 't', userId: 'u', callId: 'pc_abc' });
  assert.equal(readJoinResponse({ provider: 'getstream', getstream: { apiKey: 'k', token: 't' } }).getstream, null);
});
