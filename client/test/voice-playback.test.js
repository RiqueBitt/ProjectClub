// Reprodução do áudio remoto (decisões puras do voice/playbackPlan.js):
// elemento como caminho principal, Web Audio só com o contexto rodando,
// saída de áudio salva × aparelhos reais, auto-cura e diagnóstico compacto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planPlayback, pickSinkId, healActions, clampVolume } from '../src/voice/playbackPlan.js';

test('planPlayback: 100% ou menos é SEMPRE o <audio> direto', () => {
  for (const ctxState of [null, 'suspended', 'running']) {
    const p = planPlayback({ volume: 1, ctxState });
    assert.equal(p.mode, 'element');
    assert.equal(p.elementMuted, false);
    assert.equal(p.elementVolume, 1);
  }
  const half = planPlayback({ volume: 0.4, ctxState: 'running' });
  assert.equal(half.mode, 'element');
  assert.equal(half.elementVolume, 0.4);
});

test('planPlayback: reforço >100% só com o AudioContext rodando', () => {
  const run = planPlayback({ volume: 1.5, ctxState: 'running' });
  assert.equal(run.mode, 'webaudio');
  assert.equal(run.gain, 1.5);
  assert.equal(run.elementMuted, true, 'elemento segue tocando mudo (crbug 121673)');
  // Contexto suspenso (autoplay) ou fechado: volta pro elemento com som, limitado a 100%.
  for (const ctxState of ['suspended', 'closed', null]) {
    const p = planPlayback({ volume: 1.5, ctxState });
    assert.equal(p.mode, 'element');
    assert.equal(p.elementMuted, false);
    assert.equal(p.elementVolume, 1);
    assert.equal(p.wantsWebAudio, true);
  }
  // Saída escolhida sem AudioContext.setSinkId: o reforço tocaria no lugar errado.
  assert.equal(planPlayback({ volume: 1.5, ctxState: 'running', ctxSinkOk: false }).mode, 'element');
  assert.equal(planPlayback({ volume: 1.5, ctxState: 'running', webAudioAvailable: false }).mode, 'element');
});

test('planPlayback: auto nivelar usa Web Audio; ensurdecer (0) é mudo no elemento', () => {
  assert.equal(planPlayback({ volume: 1, autoLevel: true, ctxState: 'running' }).mode, 'webaudio');
  assert.equal(planPlayback({ volume: 1, autoLevel: true, ctxState: 'suspended' }).mode, 'element');
  const deaf = planPlayback({ volume: 0, autoLevel: true, ctxState: 'running' });
  assert.equal(deaf.mode, 'element');
  assert.equal(deaf.elementMuted, true);
  assert.equal(clampVolume(9), 2);
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume('x'), 1);
});

test('pickSinkId: só aplica saída que existe; sem permissão não mexe', () => {
  const devs = [{ kind: 'audiooutput', deviceId: 'default' }, { kind: 'audiooutput', deviceId: 'fone-1' }, { kind: 'audioinput', deviceId: 'mic' }];
  assert.deepEqual(pickSinkId('', devs), { sinkId: '', stale: false });
  assert.deepEqual(pickSinkId('fone-1', devs), { sinkId: 'fone-1', stale: false });
  assert.deepEqual(pickSinkId('fone-velho', devs), { sinkId: '', stale: true }, 'saída que sumiu: padrão + esquecer');
  assert.deepEqual(pickSinkId('mic', devs), { sinkId: '', stale: true }, 'id de entrada não vale como saída');
  // Sem permissão de mídia os ids vêm vazios: não dá pra saber → não apaga a preferência.
  assert.deepEqual(pickSinkId('fone-1', [{ kind: 'audiooutput', deviceId: '' }]), { sinkId: null, stale: false });
  assert.deepEqual(pickSinkId('fone-1', []), { sinkId: null, stale: false });
});

test('healActions: bytes chegando + elemento pausado → toca de novo', () => {
  assert.deepEqual(healActions({ paused: true, bytesDelta: 1200 }), ['play']);
  assert.deepEqual(healActions({ paused: true, bytesDelta: null }), ['play'], 'sem estatística: tenta mesmo assim');
  assert.deepEqual(healActions({ paused: true, bytesDelta: 0 }), [], 'nada chegando (a pessoa está muda): não insiste');
  assert.deepEqual(healActions({ paused: false, bytesDelta: 500 }), []);
  assert.deepEqual(healActions({ srcOk: false, paused: false, bytesDelta: 10 }), ['reattach', 'play']);
  assert.deepEqual(healActions({ mode: 'webaudio', ctxState: 'suspended', bytesDelta: 10 }), ['resume-ctx', 'to-element']);
  assert.deepEqual(healActions({ mode: 'webaudio', ctxState: 'running', bytesDelta: 10 }), []);
  assert.deepEqual(healActions({ trackLive: false, paused: true }), [], 'faixa encerrada: nada a curar');
});
