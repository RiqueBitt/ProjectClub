// Qualidade do banner do perfil ("o banner do perfil grande está ficando
// com qualidade muito ruim"): tamanho máximo, sem esticar, sem recomprimir
// o que já chega pronto do editor, qualidade/cor das recompressões e GIF
// animado continuando animado. Também confere o tamanho/formato que o
// editor do site exporta (client/src/utils/bannerExport.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const sharp = require('sharp');
const { optimizeImage, LIMITS, qualityFor } = require('../src/services/imageOptimizer');

// Foto "de verdade" (degradê + ruído), não uma cor chapada — senão o
// encoder comprime tudo pra quase nada e não dá pra comparar qualidade.
async function photo(width, height, format = 'jpeg', opts = {}) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const n = ((x * 7919 + y * 104729) % 37) - 18;
      raw[i] = Math.max(0, Math.min(255, Math.round((x / width) * 255) + n));
      raw[i + 1] = Math.max(0, Math.min(255, Math.round((y / height) * 255) - n));
      raw[i + 2] = Math.max(0, Math.min(255, 128 + n * 3));
    }
  }
  let p = sharp(raw, { raw: { width, height, channels: 3 } });
  if (opts.exif) p = p.withExif({ IFD0: { Make: 'Celular' } });
  return format === 'webp' ? p.webp({ quality: 95 }).toBuffer() : p.jpeg({ quality: 95 }).toBuffer();
}

async function makeGif(width, height) {
  const frames = await Promise.all([[255, 0, 0], [0, 0, 255], [0, 200, 0]].map(([r, g, b]) => sharp({
    create: { width, height, channels: 4, background: { r, g, b, alpha: 1 } },
  }).png().toBuffer()));
  return sharp(frames, { join: { animated: true } }).gif({ delay: [100, 100, 100], loop: 0 }).toBuffer();
}

test('configuração: banner até 2400px, WebP/JPEG 92, cor 4:4:4, sem recomprimir o que já está pronto', () => {
  assert.equal(LIMITS.banner.width, 2400);
  const q = qualityFor('banner');
  assert.ok(q.webp >= 88 && q.webp <= 92, `webp ${q.webp}`);
  assert.ok(q.jpeg >= 90, `jpeg ${q.jpeg}`);
  assert.equal(q.chromaSubsampling, '4:4:4');
  assert.equal(q.smartSubsample, true);
  assert.equal(q.keepIfClean, true);
  // Outros campos continuam como antes.
  assert.equal(qualityFor('attachments').webp, 90);
});

test('banner enorme: reduz pra 2400 de largura (proporção mantida), em alta qualidade', async () => {
  const input = await photo(3600, 1200);
  const out = await optimizeImage({ buffer: input, mimeType: 'image/jpeg', originalName: 'b.jpg', field: 'banner' });
  assert.equal(out.changed, true);
  const m = await sharp(out.buffer).metadata();
  assert.equal(m.width, 2400);
  assert.equal(m.height, 800);
  assert.ok(['webp', 'jpeg'].includes(m.format));
  if (m.format === 'jpeg') assert.equal(m.chromaSubsampling, '4:4:4');
  // Fidelidade: comparado com a redução "perfeita" (sem compressão), o erro médio é pequeno.
  const ref = await sharp(input).resize({ width: 2400, kernel: 'lanczos3' }).raw().toBuffer();
  const got = await sharp(out.buffer).removeAlpha().raw().toBuffer();
  let diff = 0;
  for (let i = 0; i < ref.length; i += 1) diff += Math.abs(ref[i] - got[i]);
  const mae = diff / ref.length;
  assert.ok(mae < 6, `erro médio por canal alto demais: ${mae.toFixed(2)}`);
});

test('banner pequeno: nunca estica', async () => {
  const input = await photo(900, 300, 'jpeg', { exif: true });
  const out = await optimizeImage({ buffer: input, mimeType: 'image/jpeg', originalName: 'b.jpg', field: 'banner' });
  const m = await sharp(out.buffer).metadata();
  assert.equal(m.width, 900);
  assert.equal(m.height, 300);
  assert.equal(m.exif, undefined, 'metadado (EXIF) removido');
});

test('banner já pronto do editor (WebP/JPEG sem metadado, no tamanho): fica intacto, sem segunda compressão', async () => {
  for (const fmt of ['webp', 'jpeg']) {
    const input = await photo(2400, 800, fmt);
    const out = await optimizeImage({ buffer: input, mimeType: `image/${fmt}`, originalName: `b.${fmt}`, field: 'banner' });
    assert.equal(out.changed, false, fmt);
    assert.equal(out.buffer, input, fmt);
  }
});

test('banner em GIF animado: continua animado (e reduz se for largo demais)', async () => {
  const small = await makeGif(600, 200);
  const keep = await optimizeImage({ buffer: small, mimeType: 'image/gif', originalName: 'b.gif', field: 'banner' });
  assert.equal(keep.changed, false);
  const big = await makeGif(3000, 1000);
  const out = await optimizeImage({ buffer: big, mimeType: 'image/gif', originalName: 'b.gif', field: 'banner' });
  const m = await sharp(out.buffer, { animated: true }).metadata();
  assert.equal(m.pages, 3);
  assert.equal(m.width, 2400);
  assert.ok(['gif', 'webp'].includes(m.format));
});

test('editor do site: banner exporta na largura real até 2400 (nunca estica), WebP 0.95', async () => {
  const be = await import(pathToFileURL(path.resolve(__dirname, '../../client/src/utils/bannerExport.js')).href);
  assert.deepEqual(be.cropOutputSize(3, 4000), { width: 2400, height: 800 });
  assert.deepEqual(be.cropOutputSize(3, 1500), { width: 1500, height: 500 });
  assert.deepEqual(be.cropOutputSize(3, 600), { width: 600, height: 200 }, 'recorte pequeno não é esticado');
  assert.deepEqual(be.cropOutputSize(16 / 5, 4000, { maxWidth: be.MINI_BANNER_MAX_WIDTH }), { width: 1280, height: 400 });
  // Avatar continua igual.
  assert.deepEqual(be.cropOutputSize(1, 2000), { width: 800, height: 800 });
  assert.deepEqual(be.cropOutputSize(1, 100), { width: 256, height: 256 });
  assert.deepEqual(be.cropExportFormat({ banner: true, originalType: 'image/jpeg' }), { type: 'image/webp', quality: 0.95 });
  assert.equal(be.cropExportFormat({ banner: false, originalType: 'image/jpeg' }).type, 'image/jpeg');
  assert.equal(be.cropExportFormat({ banner: false, originalType: 'image/png' }).type, 'image/webp');
  assert.ok(be.BANNER_MAX_WIDTH <= LIMITS.banner.width, 'o servidor não reduz de novo o que o editor manda');
});
