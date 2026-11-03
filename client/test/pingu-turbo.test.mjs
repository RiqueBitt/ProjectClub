// Pingu Turbo: ajudantes das mensagens do Pingu (cursor ao vivo, imagem).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPinguAuthor, isPinguStreaming, pinguImageAttachments, downloadName, groupCommands } from '../src/utils/pinguMessage.js';

const img = { id: 'a', url: '/media/pingu-1.png', filename: 'pingu-1.png', mimeType: 'image/png' };

test('pingu: autor, streaming e imagens só das mensagens dele', () => {
  const m = { author: { username: 'Pingu' }, attachments: [img, { id: 'b', mimeType: 'text/plain' }], pinguStreaming: true };
  assert.equal(isPinguAuthor(m), true);
  assert.equal(isPinguStreaming(m), true);
  assert.equal(isPinguStreaming({ ...m, pinguStreaming: undefined }), false);
  assert.deepEqual(pinguImageAttachments(m), [img]);
  assert.deepEqual(pinguImageAttachments({ author: { username: 'ana' }, attachments: [img] }), []);
  assert.deepEqual(pinguImageAttachments(null), []);
});

test('pingu: nome do download e comandos agrupados', () => {
  assert.equal(downloadName(img), 'pingu-1.png');
  assert.equal(downloadName({ url: '/media/a b?x=1' }), 'a_b');
  const g = groupCommands([{ group: 'Imagens', cmd: 'a' }, { group: 'Úteis', cmd: 'b' }, { group: 'Imagens', cmd: 'c' }, { cmd: '' }]);
  assert.deepEqual(g.map((x) => [x.name, x.items.length]), [['Imagens', 2], ['Úteis', 1]]);
});
