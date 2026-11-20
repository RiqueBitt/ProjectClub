'use strict';
// Pátio do Dojo de 2015: o servidor insere no 1º quadro do dojoext.swf o
// DoAction que religa a interface (sem os 4 baralhos a sala travava o pinguim).
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { patchSwf, isPatchedRoute } = require('../waddle/dist/server/file-server/swf-patches.js');
const { PRACA_DOJOEXT_DOACTION } = require('../waddle/dist/server/file-server/praca-dojoext-action.js');

// SWF mínimo: RECT de 5 bits zerados + frameRate + frameCount, 1 DoAction vazio, ShowFrame, End
function tinySwf(compressed) {
  const body = Buffer.concat([
    Buffer.from([0x00]), // RECT (nbits = 0)
    Buffer.from([0x00, 0x18, 0x01, 0x00]), // frameRate 24, 1 quadro
    Buffer.from([0x01, 0x03, 0x00]), // DoAction (12) com 1 byte: ActionEnd
    Buffer.from([0x40, 0x00]), // ShowFrame
    Buffer.from([0x00, 0x00]), // End
  ]);
  const header = Buffer.from(compressed ? 'CWS' : 'FWS', 'latin1');
  const rest = Buffer.alloc(5); rest[0] = 8; rest.writeUInt32LE(body.length + 8, 1);
  return Buffer.concat([header, rest, compressed ? zlib.deflateSync(body) : body]);
}

test('dojoext.swf é uma rota consertada (sempre revalida)', () => {
  assert.ok(isPatchedRoute('play/v2/content/global/rooms/dojoext.swf'));
  assert.ok(!isPatchedRoute('play/v2/content/global/rooms/dojo.swf'));
});

test('o DoAction entra antes do 1º ShowFrame, depois do script da sala', () => {
  const out = patchSwf('play/v2/content/global/rooms/dojoext.swf', tinySwf(true));
  const body = zlib.inflateSync(out.subarray(8));
  const at = body.indexOf(PRACA_DOJOEXT_DOACTION);
  assert.ok(at > 0, 'patch presente');
  assert.ok(at > body.indexOf(Buffer.from([0x01, 0x03, 0x00])), 'depois do DoAction original');
  assert.ok(at < body.indexOf(Buffer.from([0x40, 0x00]), at), 'antes do ShowFrame');
  assert.strictEqual(out.readUInt32LE(4), body.length + 8);
});
