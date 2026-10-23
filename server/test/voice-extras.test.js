// Extras de chamada de voz: reações (validação) e a máquina de estados
// do consentimento de gravação (N). Tudo puro, sem banco/rede.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidReaction, QUICK_REACTIONS,
  createRecordingRequest, applyConsent, dropParticipant, allAccepted, pendingUserIds,
} = require('../src/services/voiceExtras');

test('reação: só aceita os emojis da lista fixa', () => {
  for (const ok of QUICK_REACTIONS) assert.equal(isValidReaction(ok), true, ok);
  for (const bad of ['', 'x', '🤡', '<img>', null, 5, undefined, '👍👍']) {
    assert.equal(isValidReaction(bad), false, String(bad));
  }
});

test('gravação: quem pede já aparece como "aceito"; os outros ficam pendentes', () => {
  const r = createRecordingRequest({ requesterId: 'u1', requesterName: 'Rique', participantIds: ['u1', 'u2', 'u3'] });
  assert.equal(r.status, 'pending');
  assert.equal(r.consents.u1, 'accepted');
  assert.equal(r.consents.u2, 'pending');
  assert.equal(r.consents.u3, 'pending');
  assert.deepEqual(pendingUserIds(r).sort(), ['u2', 'u3']);
  assert.equal(allAccepted(r), false);
});

test('gravação: só começa quando TODO MUNDO aceita', () => {
  let r = createRecordingRequest({ requesterId: 'u1', participantIds: ['u1', 'u2', 'u3'] });
  r = applyConsent(r, 'u2', true);
  assert.equal(r.status, 'pending');
  r = applyConsent(r, 'u3', true);
  assert.equal(r.status, 'recording');
  assert.equal(allAccepted(r), true);
});

test('gravação: qualquer recusa cancela o pedido inteiro', () => {
  let r = createRecordingRequest({ requesterId: 'u1', participantIds: ['u1', 'u2', 'u3'] });
  r = applyConsent(r, 'u2', false);
  assert.equal(r.status, 'denied');
  // Depois de negado, mais respostas não "ressuscitam" a gravação.
  r = applyConsent(r, 'u3', true);
  assert.equal(r.status, 'denied');
});

test('gravação: resposta de quem não está na sala é ignorada', () => {
  let r = createRecordingRequest({ requesterId: 'u1', participantIds: ['u1', 'u2'] });
  r = applyConsent(r, 'intruso', true);
  assert.equal(r.consents.intruso, undefined);
  assert.equal(r.status, 'pending');
});

test('gravação: sala de uma pessoa só já pode gravar (só ela)', () => {
  const r = createRecordingRequest({ requesterId: 'u1', participantIds: ['u1'] });
  assert.equal(allAccepted(r), true);
});

test('gravação: quem sai durante o pedido perde o voto; se os demais já aceitaram, começa', () => {
  let r = createRecordingRequest({ requesterId: 'u1', participantIds: ['u1', 'u2', 'u3'] });
  r = applyConsent(r, 'u2', true);
  // u3 ainda não respondeu, mas saiu da chamada:
  r = dropParticipant(r, 'u3');
  assert.equal(r.consents.u3, undefined);
  assert.equal(r.status, 'recording');
});

test('gravação: se todos saem, o pedido é cancelado', () => {
  let r = createRecordingRequest({ requesterId: 'u1', participantIds: ['u1', 'u2'] });
  r = dropParticipant(r, 'u1');
  r = dropParticipant(r, 'u2');
  assert.equal(r.status, 'cancelled');
});

test('gravação: não muta o objeto anterior (imutável)', () => {
  const r0 = createRecordingRequest({ requesterId: 'u1', participantIds: ['u1', 'u2'] });
  const r1 = applyConsent(r0, 'u2', true);
  assert.notEqual(r0, r1);
  assert.equal(r0.consents.u2, 'pending');
  assert.equal(r1.consents.u2, 'accepted');
});
