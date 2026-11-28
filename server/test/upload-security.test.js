// Testes de segurança do upload — auditoria "não confie no Content-Type
// que o navegador declara" (ver middleware/upload.js). Roda com o test
// runner nativo do Node (node:test, sem dependência nova): `node --test`
// dentro de server/.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectImageMime } = require('../src/utils/imageSignature');

// --- Cenário positivo: arquivos de imagem de verdade continuam
// funcionando normalmente (a correção não pode quebrar uploads legítimos). ---

test('detecta PNG de verdade pelos magic bytes', () => {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(detectImageMime(pngHeader), 'image/png');
});

test('detecta JPEG de verdade pelos magic bytes', () => {
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  assert.equal(detectImageMime(jpegHeader), 'image/jpeg');
});

test('detecta GIF de verdade pelos magic bytes', () => {
  const gifHeader = Buffer.from('GIF89a' + '\0\0\0\0', 'ascii');
  assert.equal(detectImageMime(gifHeader), 'image/gif');
});

test('detecta WEBP de verdade pelos magic bytes', () => {
  const webpHeader = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'ascii')]);
  assert.equal(detectImageMime(webpHeader), 'image/webp');
});

// --- Cenário de ataque: arquivo com conteúdo malicioso (HTML/script)
// mesmo que o cliente TENHA declarado Content-Type: image/png no upload
// — o que importa agora é o conteúdo real, não o header. ---

test('REJEITA um arquivo HTML disfarçado de imagem (ataque de MIME confusion)', () => {
  const fakeImage = Buffer.from('<html><body><script>alert(document.cookie)</script></body></html>', 'utf8');
  assert.equal(detectImageMime(fakeImage), null, 'um HTML não deve ser identificado como nenhum formato de imagem válido');
});

test('REJEITA um arquivo de texto qualquer disfarçado de imagem', () => {
  const fakeImage = Buffer.from('isso aqui nao e uma imagem de verdade', 'utf8');
  assert.equal(detectImageMime(fakeImage), null);
});

test('REJEITA um arquivo vazio', () => {
  assert.equal(detectImageMime(Buffer.alloc(0)), null);
});

test('REJEITA um PNG com os bytes de assinatura corrompidos/incompletos', () => {
  const corrupted = Buffer.from([0x89, 0x50, 0x4e, 0x00, 0x0d, 0x0a, 0x1a, 0x0a]); // 4º byte errado
  assert.equal(detectImageMime(corrupted), null);
});
