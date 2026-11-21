'use strict';
// SoundStudio: salvar, compartilhar (fila da Danceteria) e curtir músicas.
const test = require('node:test');
const assert = require('node:assert');
const m = require('../waddle/dist/server/socket-server/handlers/music');

test('soundstudio: salva, compartilha, curte 1x por dia e sai da fila ao desconectar', () => {
  const sent = [];
  const mk = (id, name) => ({ id, name, musicTracks: [] });
  const a = mk(1, 'Ana'); const b = mk(2, 'Bia');
  const world = { getById: (id) => [a, b].find((p) => p.id === id), getRoom: () => ({ players: [a, b] }) };
  const msg = { send: (to, cmd, ...args) => sent.push([Array.isArray(to) ? 'sala' : to.name, cmd, ...args]) };
  const ctx = (p) => ({ penguin: p, world, msg, prst: () => {} });
  m.handleSaveMusicTrack(ctx(a), 'Minha|faixa', '1|0,FFFF|BB8', 'h');
  assert.deepStrictEqual(a.musicTracks[0].name, 'Minha faixa');
  m.handleSaveMusicTrack(ctx(a), 'sem fim', '1|0,2|5', 'h'); // sem FFFF: ignora
  assert.strictEqual(a.musicTracks.length, 1);
  m.handleShareMusicTrack(ctx(a), '1', '1');
  assert.ok(sent.some(([to, cmd, n, idx]) => to === 'Ana' && cmd === 'broadcastingmusictracks' && n === 1 && idx === 1));
  m.handleLikeTrack(ctx(b), '1', '1');
  m.handleLikeTrack(ctx(b), '1', '1');
  assert.strictEqual(a.musicTracks[0].likes, 1);
  m.handleLikeTrack(ctx(a), '1', '1'); // a própria: não conta
  assert.strictEqual(a.musicTracks[0].likes, 1);
  m.musicOnDisconnect(a);
  assert.deepStrictEqual(sent.at(-1).slice(1), ['broadcastingmusictracks', 0, -1, '']);
});
