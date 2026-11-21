'use strict';
// Progresso das festas 2013-2017 (party cookie): mensagens, tarefas e transformações.
const test = require('node:test');
const assert = require('node:assert');
const { getPartyCookieHandlers } = require('../waddle/dist/server/socket-server/handlers/party-cookie');

function fake() {
  const sent = [];
  const penguin = { id: 7, partyCookies: {}, avatar: { transform(a) { this.id = a; } } };
  const ctx = { penguin, msg: { send: (to, cmd, ...args) => sent.push([cmd, ...args]) }, prst: () => {}, world: { getPenguinRoom: () => ({ players: [penguin] }) } };
  return { sent, penguin, ctx };
}

test('festa: pedir o cookie manda partyservice com tudo liberado + cookie', () => {
  const hs = new Map(getPartyCookieHandlers());
  const { sent, ctx } = fake();
  hs.get('halloween#partycookie')(ctx, '0');
  assert.strictEqual(sent[0][0], 'partyservice');
  const svc = JSON.parse(sent[0][1]);
  assert.strictEqual(svc.partySettings.unlockDayIndex, svc.partySettings.numOfDaysInParty);
  assert.deepStrictEqual(sent[1], ['partycookie', '{}']);
});

test('festa: tarefa e mensagem ficam salvas no cookie', () => {
  const hs = new Map(getPartyCookieHandlers());
  const { sent, ctx, penguin } = fake();
  hs.get('halloween#collectquestitem')(ctx, '3');
  hs.get('party#msgviewed')(ctx, '1');
  assert.deepStrictEqual(penguin.partyCookies.halloween.questTaskStatus, [0, 0, 0, 1, 0, 0, 0, 0]);
  assert.deepStrictEqual(penguin.partyCookies.party.msgViewedArray, [0, 1, 0, 0, 0]);
  assert.strictEqual(sent.at(-1)[0], 'partycookie');
  hs.get('halloween#collectquestitem')(ctx, '9999');
  assert.strictEqual(penguin.partyCookies.halloween.questTaskStatus.length, 8);
});

test('festa: transformação vira spts pra sala', () => {
  const hs = new Map(getPartyCookieHandlers());
  const { sent, ctx, penguin } = fake();
  hs.get('frozen#fptransform')(ctx, '12');
  assert.deepStrictEqual(sent.at(-1), ['spts', 7, 12]);
  assert.strictEqual(penguin.avatar.id, 12);
});
