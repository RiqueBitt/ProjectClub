// Deploy/reinício do servidor: leituras tentam de novo com calma
// (utils/serverRestart.js) em vez de cada tela mostrar erro na hora.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isServerRestartError, isRetryableRequest, retryDelayMs, shouldRetry, retryDuringRestart,
  isServerRestarting, _resetServerRestart,
} from '../src/utils/serverRestart.js';

const gateway = (status, { ct = 'text/html', data = '<html>', method = 'get', attempt } = {}) => ({
  config: { method, url: '/x', ...(attempt ? { _restartAttempt: attempt } : {}) },
  response: { status, headers: { 'content-type': ct }, data },
});

test('reconhece 502/503/504 do proxy e conexão caída — mas não o 503 da própria API', () => {
  assert.equal(isServerRestartError(gateway(502)), true);
  assert.equal(isServerRestartError(gateway(503)), true);
  assert.equal(isServerRestartError(gateway(504)), true);
  assert.equal(isServerRestartError(gateway(500)), false);
  // Manutenção/sistema desligado: JSON da API, é resposta de verdade.
  assert.equal(isServerRestartError(gateway(503, { ct: 'application/json', data: { maintenance: true } })), false);
  // O aviso "atualizando" do deploy também é JSON, mas marcado restarting.
  assert.equal(isServerRestartError(gateway(503, { ct: 'application/json; charset=utf-8', data: { restarting: true } })), true);
  assert.equal(isServerRestartError({ code: 'ERR_NETWORK', config: {} }), true);
  assert.equal(isServerRestartError({ code: 'ERR_CANCELED', config: {} }), false);
  assert.equal(isServerRestartError(null), false);
});

test('só repete leituras, com espera crescente e limite de tentativas', () => {
  assert.equal(isRetryableRequest({ method: 'get' }), true);
  assert.equal(isRetryableRequest({ method: 'post' }), false);
  assert.equal(isRetryableRequest({ method: 'get', _noRestartRetry: true }), false);
  assert.equal(shouldRetry(gateway(503, { method: 'post' })), false);
  assert.equal(shouldRetry(gateway(503, { attempt: 5 })), false);
  const mid = () => 0.5;
  assert.equal(retryDelayMs(1, undefined, mid), 1000);
  assert.equal(retryDelayMs(3, undefined, mid), 4000);
  assert.equal(retryDelayMs(9, undefined, mid), 10000);
  assert.equal(retryDelayMs(1, '7', mid), 7000); // Retry-After do servidor
  assert.equal(retryDelayMs(1, '999', mid), 15000);
});

test('retryDuringRestart: espera, tenta de novo e marca quando o servidor volta', async () => {
  _resetServerRestart();
  const waits = [];
  const wait = async (ms) => { waits.push(ms); };
  let calls = 0;
  const request = async (config) => { calls += 1; assert.equal(config._restartAttempt, 1); return { data: 'ok' }; };
  const res = await retryDuringRestart(gateway(503), request, wait);
  assert.deepEqual(res, { data: 'ok' });
  assert.equal(calls, 1);
  assert.equal(waits.length, 1);
  assert.equal(isServerRestarting(), false);

  // Erro que não é de reinício: rejeita na hora, sem esperar.
  const err = gateway(404);
  await assert.rejects(retryDuringRestart(err, request, wait), (e) => e === err);
  assert.equal(waits.length, 1);
});
