// Voz à prova de falhas (lógica pura): fechamento do servidor de mídia,
// código de falha pro disjuntor, tempo limite, memória de provedores que
// falharam, import() com novas tentativas e recarregamento protegido, ICE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyClose, failureCode, withTimeout, createFailureMemory, importWithRetry, guardedReload, iceAction, isChunkError, micErrorReason,
} from '../src/voice/resilience.js';

test('classifyClose segue o contrato do media-server', () => {
  // Outro aparelho: NUNCA reconecta (senão vira ping-pong).
  assert.equal(classifyClose({ code: 4409 }), 'replaced');
  assert.equal(classifyClose({ code: 1006, kicked: 'replaced' }), 'replaced');
  assert.equal(classifyClose({ code: 4409, kicked: 'flapping' }), 'replaced');
  // Token vencido/recusado: token novo e reconecta.
  assert.equal(classifyClose({ code: 4401, detail: 'expired' }), 'refresh-token');
  assert.equal(classifyClose({ code: 4401, detail: 'invalid' }), 'refresh-token');
  // Servidor reiniciando a sala / queda de rede / limites: reconecta.
  assert.equal(classifyClose({ code: 1012 }), 'reconnect');
  assert.equal(classifyClose({ code: 1006 }), 'reconnect');
  assert.equal(classifyClose({ code: 4429 }), 'reconnect');
  assert.equal(classifyClose({ code: 4503 }), 'reconnect');
  // Abuso / expulso por outro motivo: desiste.
  assert.equal(classifyClose({ code: 1008 }), 'give-up');
  assert.equal(classifyClose({ code: 1000, kicked: 'banido' }), 'give-up');
  assert.equal(classifyClose(), 'reconnect');
});

test('failureCode extrai um código curto e seguro', () => {
  const agora = new Error('AgoraRTCError CAN_NOT_GET_GATEWAY_SERVER: flag: 4096, message: AgoraRTCError CAN_NOT_GET_GATEWAY_SERVER: invalid token');
  assert.equal(failureCode(agora), 'CAN_NOT_GET_GATEWAY_SERVER');
  assert.equal(failureCode({ code: 'CAN_NOT_GET_GATEWAY_SERVER', message: 'x' }), 'CAN_NOT_GET_GATEWAY_SERVER');
  assert.equal(failureCode(Object.assign(new Error('t'), { code: 'ICE_TIMEOUT' })), 'ICE_TIMEOUT');
  // DOMException tem code numérico: usa o nome.
  assert.equal(failureCode({ name: 'NotAllowedError', code: 0, message: 'Permission denied' }), 'NotAllowedError');
  assert.equal(failureCode(new Error('qualquer coisa')), 'client');
  assert.equal(failureCode(null), 'client');
  assert.equal(failureCode({ code: 'a b/c<d>' + 'x'.repeat(100) }).length <= 60, true);
  assert.match(failureCode({ code: 'a b/c<d>' }), /^[\w:.-]+$/);
});

test('withTimeout rejeita com code e não atrapalha quem resolve antes', async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
  await assert.rejects(withTimeout(new Promise(() => {}), 20, 'AGORA_JOIN_TIMEOUT'), (e) => e.code === 'AGORA_JOIN_TIMEOUT');
  await assert.rejects(withTimeout(Promise.reject(new Error('falhou')), 50), /falhou/);
});

test('createFailureMemory tira quem falhou da lista por um tempo', () => {
  let now = 1000;
  const mem = createFailureMemory({ ttlMs: 10000, now: () => now });
  const ready = ['projectclub', 'agora', 'livekit', 'jitsi'];
  mem.mark('agora');
  assert.deepEqual(mem.filter(ready), ['projectclub', 'livekit', 'jitsi']);
  assert.equal(mem.has('agora'), true);
  now += 10001;
  assert.deepEqual(mem.filter(ready), ready, 'expirou: volta a tentar');
  ready.forEach((p) => mem.mark(p));
  assert.deepEqual(mem.filter(ready), ready, 'todos falharam: tenta tudo de novo (nunca lista vazia)');
  mem.clear();
  assert.deepEqual(mem.excluded(), []);
});

test('importWithRetry: tenta de novo e só pede recarregar em erro de chunk', async () => {
  let calls = 0;
  const ok = await importWithRetry(async () => { calls += 1; if (calls < 2) throw new Error('rede'); return { default: 1 }; }, { sleep: async () => {} });
  assert.equal(ok.default, 1);
  assert.equal(calls, 2);

  let reloads = 0;
  const chunkErr = new TypeError('Failed to fetch dynamically imported module: https://x/assets/vendor-mediasoup-D0.js');
  await assert.rejects(importWithRetry(async () => { throw chunkErr; }, { retries: 2, sleep: async () => {}, onChunkFailure: () => { reloads += 1; } }), /dynamically imported/);
  assert.equal(reloads, 1);

  reloads = 0;
  await assert.rejects(importWithRetry(async () => { throw new Error('outra coisa'); }, { retries: 1, sleep: async () => {}, onChunkFailure: () => { reloads += 1; } }));
  assert.equal(reloads, 0, 'erro que não é de chunk não recarrega');
  assert.equal(isChunkError(chunkErr), true);
  assert.equal(isChunkError(new Error('Importing a module script failed.')), true);
});

test('guardedReload: uma vez só, nunca no meio de uma call', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  let reloads = 0;
  const reload = () => { reloads += 1; };
  assert.equal(guardedReload({ storage, inCall: true, now: 1000, reload }), false);
  assert.equal(guardedReload({ storage, now: 100000, reload }), true);
  assert.equal(guardedReload({ storage, now: 110000, reload }), false, 'trava contra loop');
  assert.equal(guardedReload({ storage, now: 200000, reload }), true);
  assert.equal(reloads, 2);
  // Storage quebrado (modo privado): ainda recarrega.
  assert.equal(guardedReload({ storage: { getItem() { throw new Error('x'); } }, now: 1, reload }), true);
});

test('iceAction: disconnected espera, failed reinicia ICE, depois refaz a sessão', () => {
  assert.equal(iceAction('connected'), 'connected');
  assert.equal(iceAction('disconnected'), 'grace');
  assert.equal(iceAction('failed', { iceRestarts: 0 }), 'restart-ice');
  assert.equal(iceAction('failed', { iceRestarts: 1 }), 'restart-ice');
  assert.equal(iceAction('failed', { iceRestarts: 2 }), 'reconnect');
  assert.equal(iceAction('closed'), 'reconnect');
  assert.equal(iceAction('new'), 'none');
  assert.equal(iceAction('connecting'), 'none');
});

test('micErrorReason separa negado / ocupado / ausente', () => {
  assert.equal(micErrorReason({ name: 'NotAllowedError' }), 'denied');
  assert.equal(micErrorReason({ name: 'SecurityError' }), 'denied');
  assert.equal(micErrorReason({ name: 'NotReadableError' }), 'busy');
  assert.equal(micErrorReason({ name: 'NotFoundError' }), 'missing');
  assert.equal(micErrorReason({ name: 'OverconstrainedError' }), 'missing');
  assert.equal(micErrorReason(new Error('limite de mídias')), null);
});
