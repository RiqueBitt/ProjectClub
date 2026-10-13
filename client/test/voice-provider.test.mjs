// Testes unitários (node --test) da lógica PURA do modo reserva de voz:
//  1. escolha/normalização do provedor (Agora ⇆ Jitsi);
//  2. tradução de eventos da External API do Jitsi pro estado da UI.
// Sem React, sem rede, sem DOM — importa só os módulos puros.
//
// Rodar:  node --test test/voice-provider.test.mjs   (dentro de client/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProviderResponse, shouldSwitchProvider, readJoinResponse, isReserveMode,
} from '../src/voice/providerDecision.js';
import { mapJitsiEvent } from '../src/voice/jitsiMapping.js';

// ---------- providerDecision ----------
test('normalizeProviderResponse: aceita agora/jitsi e marca fallback', () => {
  const a = normalizeProviderResponse({ provider: 'agora', minutesUsed: 10, limit: 10000, reason: 'ok' });
  assert.equal(a.provider, 'agora');
  assert.equal(a.fallbackActive, false);
  const j = normalizeProviderResponse({ provider: 'jitsi', minutesUsed: 9900, limit: 10000, reason: 'limite-mensal-agora' });
  assert.equal(j.provider, 'jitsi');
  assert.equal(j.fallbackActive, true);
  assert.equal(j.minutesUsed, 9900);
});

test('normalizeProviderResponse: entrada inválida cai pro agora (padrão seguro)', () => {
  for (const bad of [null, undefined, {}, { provider: 'foo' }, { provider: 5 }, 'x']) {
    const d = normalizeProviderResponse(bad);
    assert.equal(d.provider, 'agora');
    assert.equal(d.fallbackActive, false);
  }
});

test('shouldSwitchProvider: só troca quando muda de verdade', () => {
  assert.equal(shouldSwitchProvider('agora', 'jitsi'), true);
  assert.equal(shouldSwitchProvider('agora', 'agora'), false);
  assert.equal(shouldSwitchProvider('jitsi', 'jitsi'), false);
  assert.equal(shouldSwitchProvider('agora', 'invalido'), false);
});

test('readJoinResponse: extrai credenciais do Agora quando válidas', () => {
  const r = readJoinResponse({ provider: 'agora', agora: { token: 't', appId: 'app', uid: 'u1' }, minutesUsed: 5, limit: 100 });
  assert.equal(r.provider, 'agora');
  assert.deepEqual(r.agora, { token: 't', appId: 'app', uid: 'u1' });
});

test('readJoinResponse: Agora sem token vira agora com credencial nula', () => {
  const r = readJoinResponse({ provider: 'agora', agora: { appId: 'app' } });
  assert.equal(r.provider, 'agora');
  assert.equal(r.agora, null);
});

test('readJoinResponse: extrai sala do Jitsi (domínio+room obrigatórios, jwt opcional)', () => {
  const r = readJoinResponse({ provider: 'jitsi', jitsi: { domain: 'meet.jit.si', room: 'projectclub-abc', jwt: null } });
  assert.equal(r.provider, 'jitsi');
  assert.deepEqual(r.jitsi, { domain: 'meet.jit.si', room: 'projectclub-abc', jwt: null });
  // Sem room: inválido.
  const bad = readJoinResponse({ provider: 'jitsi', jitsi: { domain: 'meet.jit.si' } });
  assert.equal(bad.jitsi, null);
});

// ---------- mapJitsiEvent (evento → ação de estado) ----------
test('mapJitsiEvent: entrada/saída da conferência', () => {
  assert.deepEqual(mapJitsiEvent('videoConferenceJoined', { id: 'p1' }), { kind: 'joined', myId: 'p1' });
  assert.deepEqual(mapJitsiEvent('videoConferenceLeft', {}), { kind: 'left' });
  assert.deepEqual(mapJitsiEvent('readyToClose', {}), { kind: 'left' });
});

test('mapJitsiEvent: dominante vira "meu falando" só quando sou eu', () => {
  const ctx = { myParticipantId: 'me' };
  assert.deepEqual(mapJitsiEvent('dominantSpeakerChanged', { id: 'me' }, ctx), { kind: 'dominant', id: 'me', isMe: true });
  assert.deepEqual(mapJitsiEvent('dominantSpeakerChanged', { id: 'outro' }, ctx), { kind: 'dominant', id: 'outro', isMe: false });
});

test('mapJitsiEvent: mudo/câmera/tela do próprio usuário', () => {
  assert.deepEqual(mapJitsiEvent('audioMuteStatusChanged', { muted: true }), { kind: 'self-mute', muted: true });
  assert.deepEqual(mapJitsiEvent('audioMuteStatusChanged', { muted: false }), { kind: 'self-mute', muted: false });
  // câmera: muted=false => câmera LIGADA.
  assert.deepEqual(mapJitsiEvent('videoMuteStatusChanged', { muted: false }), { kind: 'self-camera', on: true });
  assert.deepEqual(mapJitsiEvent('videoMuteStatusChanged', { muted: true }), { kind: 'self-camera', on: false });
  assert.deepEqual(mapJitsiEvent('screenSharingStatusChanged', { on: true }), { kind: 'self-screen', on: true });
});

test('mapJitsiEvent: participante entrou/saiu', () => {
  assert.deepEqual(mapJitsiEvent('participantJoined', { id: 'x', displayName: 'Rique' }), { kind: 'participant', id: 'x', present: true, displayName: 'Rique' });
  assert.deepEqual(mapJitsiEvent('participantLeft', { id: 'x' }), { kind: 'participant', id: 'x', present: false });
});

test('mapJitsiEvent: evento desconhecido é ignorado', () => {
  assert.deepEqual(mapJitsiEvent('somethingElse', {}), { kind: 'ignore', event: 'somethingElse' });
});

// ---------- simulação de uma sessão inteira do Jitsi ----------
// "Mock" da External API: um emissor simples que chama os listeners
// registrados — reproduz o fluxo real sem carregar o iframe de verdade.
test('fluxo completo: eventos simulados do Jitsi produzem as ações certas', () => {
  const listeners = {};
  const fakeApi = {
    addListener: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
    emit: (ev, payload) => (listeners[ev] || []).forEach((fn) => fn(payload)),
  };
  // Encadeia cada evento pela função pura e coleta as ações.
  const actions = [];
  let myId = null;
  const EVENTS = ['videoConferenceJoined', 'dominantSpeakerChanged', 'audioMuteStatusChanged', 'screenSharingStatusChanged', 'readyToClose'];
  EVENTS.forEach((ev) => fakeApi.addListener(ev, (payload) => {
    const action = mapJitsiEvent(ev, payload, { myParticipantId: myId });
    if (action.kind === 'joined') myId = action.myId;
    actions.push(action);
  }));

  fakeApi.emit('videoConferenceJoined', { id: 'me' });
  fakeApi.emit('dominantSpeakerChanged', { id: 'me' });   // eu falando
  fakeApi.emit('audioMuteStatusChanged', { muted: true }); // me mutei
  fakeApi.emit('screenSharingStatusChanged', { on: true }); // comecei a transmitir
  fakeApi.emit('readyToClose', {});                         // saí

  assert.deepEqual(actions, [
    { kind: 'joined', myId: 'me' },
    { kind: 'dominant', id: 'me', isMe: true },
    { kind: 'self-mute', muted: true },
    { kind: 'self-screen', on: true },
    { kind: 'left' },
  ]);
});

// ---- servidor de mídia PRÓPRIO (projectclub) ----
test('readJoinResponse: extrai credenciais do servidor próprio (url+token obrigatórios, ICE opcional)', () => {
  const r = readJoinResponse({ provider: 'projectclub', projectclub: { url: 'wss://m/ws', token: 't', room: 'pc_x', identity: 'u1', iceServers: [{ urls: ['stun:s'] }] } });
  assert.equal(r.provider, 'projectclub');
  assert.deepEqual(r.projectclub, { url: 'wss://m/ws', token: 't', room: 'pc_x', identity: 'u1', iceServers: [{ urls: ['stun:s'] }] });
  assert.equal(r.reserveMode, false, 'servidor próprio NÃO é modo reserva');
  assert.equal(r.fallbackActive, false);
  const bad = readJoinResponse({ provider: 'projectclub', projectclub: { url: 'wss://m/ws' } });
  assert.equal(bad.projectclub, null);
});

test('isReserveMode: próprio e agora não são reserva; livekit/jitsi são', () => {
  assert.equal(isReserveMode('projectclub'), false);
  assert.equal(isReserveMode('agora'), false);
  assert.equal(isReserveMode('livekit'), true);
  assert.equal(isReserveMode('jitsi'), true);
});
