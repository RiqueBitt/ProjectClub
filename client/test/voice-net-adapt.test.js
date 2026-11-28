// Revisão "voz-turbo" (lógica pura): jitter na reconexão, buffer de áudio
// adaptativo à perda, getStats único por transport, avisos de fala só pra
// quem mudou e camada máxima do dynacast.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  jitteredDelay, jitterTargetDecision, JITTER_ADAPT, matchInboundStats, speakingChanges, producerMaxLayer,
} from '../src/voice/netAdapt.js';

test('jitteredDelay espalha ±30% em volta da espera base (sem rajada de reconexões)', () => {
  assert.equal(jitteredDelay(1000, () => 0), 700);
  assert.equal(jitteredDelay(1000, () => 1), 1300);
  assert.equal(jitteredDelay(1000, () => 0.5), 1000);
  assert.equal(jitteredDelay(0, () => 0.5), 0);
  assert.equal(jitteredDelay(-5), 0);
  assert.equal(jitteredDelay(1000, () => NaN), 1000, 'aleatório inválido = meio');
  for (let i = 0; i < 200; i += 1) {
    const d = jitteredDelay(8000);
    assert.ok(d >= 5600 && d <= 10400, `fora da faixa: ${d}`);
  }
  // Clientes diferentes caem em instantes diferentes.
  const set = new Set(Array.from({ length: 50 }, () => jitteredDelay(1000)));
  assert.ok(set.size > 10);
});

test('jitterTargetDecision: perda sobe o buffer (RTT + folga), rede limpa volta pro automático', () => {
  const win = 2 * 48000; // 2s de áudio
  // Sem perda: continua automático.
  let d = jitterTargetDecision({ prevMs: null, concealedDelta: 0, samplesDelta: win, rttMs: 30 });
  assert.equal(d.targetMs, null); assert.equal(d.changed, false); assert.equal(d.cleanStreak, 1);
  // 5% de concealment → RTT 30 + 40 = 70ms.
  d = jitterTargetDecision({ prevMs: null, concealedDelta: win * 0.05, samplesDelta: win, rttMs: 30 });
  assert.equal(d.targetMs, 70); assert.equal(d.changed, true);
  // Nunca abaixo do mínimo nem acima do máximo.
  assert.equal(jitterTargetDecision({ concealedDelta: win * 0.1, samplesDelta: win, rttMs: 5 }).targetMs, JITTER_ADAPT.minMs);
  assert.equal(jitterTargetDecision({ concealedDelta: win * 0.1, samplesDelta: win, rttMs: 900 }).targetMs, JITTER_ADAPT.maxMs);
  // Já alto: não desce por causa de um RTT menor enquanto ainda perde.
  d = jitterTargetDecision({ prevMs: 120, concealedDelta: win * 0.05, samplesDelta: win, rttMs: 10 });
  assert.equal(d.targetMs, 120); assert.equal(d.changed, false);
  // Janela "meio termo" (entre 0,5% e 3%): mantém e zera a contagem limpa.
  d = jitterTargetDecision({ prevMs: 120, concealedDelta: win * 0.01, samplesDelta: win, rttMs: 30, cleanStreak: 3 });
  assert.equal(d.targetMs, 120); assert.equal(d.cleanStreak, 0);
  // Silêncio/DTX (poucas amostras): não decide nada.
  d = jitterTargetDecision({ prevMs: 120, concealedDelta: 0, samplesDelta: 100, rttMs: 30, cleanStreak: 2 });
  assert.equal(d.targetMs, 120); assert.equal(d.cleanStreak, 2); assert.equal(d.changed, false);
  // Rede limpa por N janelas seguidas → volta pro automático.
  let st = { prevMs: 120, cleanStreak: 0 };
  for (let i = 1; i < JITTER_ADAPT.cleanWindowsToRelax; i += 1) {
    const r = jitterTargetDecision({ ...st, concealedDelta: 0, samplesDelta: win, rttMs: 30 });
    assert.equal(r.targetMs, 120, `ainda segura na janela ${i}`);
    st = { prevMs: r.targetMs, cleanStreak: r.cleanStreak };
  }
  const end = jitterTargetDecision({ ...st, concealedDelta: 0, samplesDelta: win, rttMs: 30 });
  assert.equal(end.targetMs, null); assert.equal(end.changed, true);
});

test('matchInboundStats: um relatório do transport serve todos os consumers (mid ou trackIdentifier)', () => {
  const report = new Map([
    ['a', { type: 'inbound-rtp', mid: '0', trackIdentifier: 'tA', packetsLost: 1 }],
    ['b', { type: 'inbound-rtp', mid: '1', trackIdentifier: 'tB', packetsLost: 2 }],
    ['c', { type: 'inbound-rtp', trackIdentifier: 'tC', packetsLost: 3 }], // navegador sem mid nas stats
    ['x', { type: 'candidate-pair' }],
  ]);
  const m = matchInboundStats(report, [{ id: 'c0', mid: '0', trackId: 'zzz' }, { id: 'c1', mid: null, trackId: 'tB' }, { id: 'c2', mid: '9', trackId: 'tC' }, { id: 'c3', mid: '7', trackId: 'nada' }]);
  assert.equal(m.get('c0').packetsLost, 1);
  assert.equal(m.get('c1').packetsLost, 2);
  assert.equal(m.get('c2').packetsLost, 3);
  assert.equal(m.has('c3'), false, 'sem par: o engine cai no getStats do próprio consumer');
  assert.equal(matchInboundStats(null, [{ id: 'c0' }]).size, 0);
});

test('speakingChanges: só quem mudou recebe aviso', () => {
  const peers = new Set(['a', 'b', 'c']);
  let r = speakingChanges(new Set(), new Set(['a']), peers);
  assert.deepEqual(r.changes, [['a', true]]);
  r = speakingChanges(r.next, new Set(['a', 'b']), peers);
  assert.deepEqual(r.changes, [['b', true]]);
  r = speakingChanges(r.next, new Set(['a', 'b']), peers);
  assert.deepEqual(r.changes, [], 'nada mudou: nenhum callback');
  r = speakingChanges(r.next, new Set(['zz']), peers);
  assert.deepEqual(r.changes, [['a', false], ['b', false]], 'quem não é da sala é ignorado');
  assert.equal(r.next.size, 0);
});

test('producerMaxLayer: -1 mantém a camada baixa; nunca passa da última', () => {
  assert.equal(producerMaxLayer(-1, 2), 0);
  assert.equal(producerMaxLayer(0, 2), 0);
  assert.equal(producerMaxLayer(1, 2), 1);
  assert.equal(producerMaxLayer(5, 3), 2);
  assert.equal(producerMaxLayer(undefined, 3), 2, 'aviso estranho: tudo ligado');
  assert.equal(producerMaxLayer(1.7, 3), 1);
});
