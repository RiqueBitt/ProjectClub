// Foto de perfil em GIF: o GIF animado tem que continuar animado depois do
// processamento do upload (recorte do editor + redução pra 512px), e
// PNG/JPEG/WebP continuam no caminho de sempre. Fixture gerada na hora com
// o próprio sharp (3 quadros de cores diferentes).
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { optimizeImage, framingRect, parseFraming } = require('../src/services/imageOptimizer');

async function makeGif(width, height, colors = [[255, 0, 0], [0, 0, 255], [0, 255, 0]]) {
  const frames = await Promise.all(colors.map(([r, g, b]) => sharp({
    create: { width, height, channels: 4, background: { r, g, b, alpha: 1 } },
  }).png().toBuffer()));
  return sharp(frames, { join: { animated: true } }).gif({ delay: colors.map(() => 120), loop: 0 }).toBuffer();
}

const meta = (buf) => sharp(buf, { animated: true }).metadata();

test('GIF de avatar grande: reduz pra 512px e continua animado', async () => {
  const gif = await makeGif(900, 600);
  const out = await optimizeImage({ buffer: gif, mimeType: 'image/gif', originalName: 'eu.gif', field: 'avatar' });
  assert.equal(out.mimeType, 'image/gif');
  assert.match(out.originalName, /\.gif$/);
  const m = await meta(out.buffer);
  assert.equal(m.format, 'gif');
  assert.ok(m.pages > 1, `esperava vários quadros, veio ${m.pages}`);
  assert.equal(m.pages, 3);
  assert.ok(Math.max(m.width, m.pageHeight) <= 512);
  assert.deepEqual(m.delay, [120, 120, 120]);
});

test('GIF de avatar com recorte do editor: quadrado, todos os quadros recortados', async () => {
  const gif = await makeGif(300, 200);
  const out = await optimizeImage({ buffer: gif, mimeType: 'image/gif', originalName: 'eu.gif', field: 'avatar', crop: '50,50,1' });
  assert.equal(out.changed, true);
  const m = await meta(out.buffer);
  assert.equal(m.format, 'gif');
  assert.equal(m.pages, 3);
  assert.equal(m.width, 200);
  assert.equal(m.pageHeight, 200);
  // O 2º quadro continua azul (a animação não virou um quadro só).
  const px = await sharp(out.buffer, { page: 1 }).raw().toBuffer();
  assert.ok(px[2] > 200 && px[0] < 60, `quadro 2 devia ser azul: ${[...px.slice(0, 3)]}`);
});

test('GIF de avatar pequeno e sem recorte: sobe o original intacto', async () => {
  const gif = await makeGif(128, 128);
  const out = await optimizeImage({ buffer: gif, mimeType: 'image/gif', originalName: 'eu.gif', field: 'avatar' });
  assert.equal(out.changed, false);
  assert.strictEqual(out.buffer, gif);
});

test('enquadramento inválido é ignorado (não recorta)', async () => {
  assert.equal(parseFraming('abc'), null);
  assert.equal(parseFraming('50,50,9'), null);
  assert.deepEqual(parseFraming('10,90,2'), { x: 10, y: 90, zoom: 2 });
  const gif = await makeGif(128, 128);
  const out = await optimizeImage({ buffer: gif, mimeType: 'image/gif', originalName: 'eu.gif', field: 'avatar', crop: 'lixo' });
  assert.equal(out.changed, false);
});

test('framingRect bate com o sourceRect do editor (cliente)', () => {
  assert.deepEqual(framingRect(300, 200, 1, { x: 0, y: 50, zoom: 1 }), { left: 0, top: 0, width: 200, height: 200 });
  assert.deepEqual(framingRect(300, 200, 1, { x: 100, y: 50, zoom: 1 }), { left: 100, top: 0, width: 200, height: 200 });
  assert.deepEqual(framingRect(400, 400, 1, { x: 50, y: 50, zoom: 2 }), { left: 100, top: 100, width: 200, height: 200 });
});

test('GIF fora do avatar (anexo) mantém a regra antiga; PNG de avatar continua virando WebP/PNG', async () => {
  const gif = await makeGif(64, 64);
  const att = await optimizeImage({ buffer: gif, mimeType: 'image/gif', originalName: 'a.gif', field: 'banner' });
  assert.equal(att.changed, false); // banner em GIF: intocado, como antes
  const png = await sharp({ create: { width: 900, height: 900, channels: 4, background: { r: 10, g: 200, b: 30, alpha: 1 } } }).png().toBuffer();
  const out = await optimizeImage({ buffer: png, mimeType: 'image/png', originalName: 'a.png', field: 'avatar' });
  assert.equal(out.changed, true);
  const m = await sharp(out.buffer).metadata();
  assert.ok(['webp', 'png'].includes(m.format));
  assert.ok(m.width <= 512);
});
