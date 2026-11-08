// Clipes: buffer circular de WebM — cabeçalho guardado uma vez, Clusters
// inteiros, corte começando num quadro-chave e tempo recomeçando em 0.
// WebM sintético montado aqui mesmo (mesmo formato do MediaRecorder:
// Segment e Clusters com tamanho desconhecido).
const test = require('node:test');
const assert = require('node:assert/strict');
const { WebmClipBuffer, readSize } = require('../clipBuffer');

const UNKNOWN = Buffer.from([0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
function idBytes(id) {
  const out = [];
  let v = id;
  while (v > 0) { out.unshift(v & 0xFF); v = Math.floor(v / 256); }
  return Buffer.from(out);
}
function sizeBytes(n) {
  if (n < 0x7F) return Buffer.from([0x80 | n]);
  if (n < 0x3FFF) return Buffer.from([0x40 | (n >> 8), n & 0xFF]);
  return Buffer.from([0x20 | (n >> 16), (n >> 8) & 0xFF, n & 0xFF]);
}
const el = (id, payload) => Buffer.concat([idBytes(id), sizeBytes(payload.length), payload]);
const uint = (v, len) => { const b = Buffer.alloc(len); b.writeUIntBE(v, 0, len); return b; };

function header({ withAudio = true } = {}) {
  const ebml = el(0x1A45DFA3, el(0x4282, Buffer.from('webm')));
  const info = el(0x1549A966, el(0x2AD7B1, uint(1000000, 3)));
  const video = el(0xAE, Buffer.concat([el(0xD7, uint(1, 1)), el(0x83, uint(1, 1))]));
  const audio = el(0xAE, Buffer.concat([el(0xD7, uint(2, 1)), el(0x83, uint(2, 1))]));
  const tracks = el(0x1654AE6B, withAudio ? Buffer.concat([audio, video]) : video);
  return Buffer.concat([ebml, Buffer.concat([idBytes(0x18538067), UNKNOWN]), info, tracks]);
}
function block(track, rel, key, payload = 'x') {
  const b = Buffer.alloc(4);
  b[0] = 0x80 | track;
  b.writeInt16BE(rel, 1);
  b[3] = key ? 0x80 : 0x00;
  return el(0xA3, Buffer.concat([b, Buffer.from(payload)]));
}
// Cluster de 1 s: áudio primeiro (audio sempre "chave"), depois vídeo.
function cluster(tc, key) {
  return Buffer.concat([
    idBytes(0x1F43B675), UNKNOWN,
    el(0xE7, uint(tc, 4)),
    block(2, 0, true, 'aud'),
    block(1, 0, key, `v${tc}`),
    block(1, 500, false, 'p'),
    block(1, 966, false, 'p'),
  ]);
}
function stream(seconds, keyEvery = 2, start = 0) {
  const parts = [header()];
  for (let s = 0; s < seconds; s += 1) parts.push(cluster(start + s * 1000, s % keyEvery === 0));
  return Buffer.concat(parts);
}
// Entrega em pedaços de tamanho estranho (como o MediaRecorder faz).
function feed(buf, data, step = 7) {
  for (let i = 0; i < data.length; i += step) buf.push(data.subarray(i, i + step));
}
// Relê um arquivo exportado e devolve os Clusters encontrados.
function reparse(file) {
  const b = new WebmClipBuffer({ keepMs: 10 ** 9 });
  b.push(file);
  b.push(cluster(10 ** 8, true)); // força o fim do último cluster
  return b.clusters.slice(0, -1);
}

test('tamanho desconhecido do EBML é reconhecido', () => {
  assert.deepEqual(readSize(UNKNOWN, 0), { size: null, len: 8 });
  assert.deepEqual(readSize(Buffer.from([0x85]), 0), { size: 5, len: 1 });
});

test('guarda o cabeçalho uma vez e os Clusters inteiros, em qualquer divisão de pedaços', () => {
  for (const step of [1, 7, 64, 100000]) {
    const b = new WebmClipBuffer({ keepMs: 30000 });
    feed(b, stream(10), step);
    assert.ok(b.headerReady, `passo ${step}`);
    assert.ok(b.header.equals(header()));
    assert.equal(b.clusters.length, 9, 'o último ainda está aberto');
    assert.equal(b.clusters[0].hasKey, true);
    assert.equal(b.clusters[1].hasKey, false, 'áudio no começo não engana: vale o 1º bloco de vídeo');
  }
});

test('descarta o que passou da janela, mas mantém um quadro-chave no começo', () => {
  const b = new WebmClipBuffer({ keepMs: 30000, marginMs: 0 });
  feed(b, stream(120, 4), 4096);
  const first = b.clusters[0];
  assert.equal(first.hasKey, true);
  // Último fim ≈ 119.966 s → janela começa em ≈ 89.9 s → chave em 88 s.
  assert.equal(first.timecode, 88000);
  assert.ok(b.bufferedMs() >= 30000 && b.bufferedMs() < 34000, String(b.bufferedMs()));
});

test('exporta os últimos 30 s começando num quadro-chave e com o tempo em 0', () => {
  const b = new WebmClipBuffer({ keepMs: 30000 });
  feed(b, stream(60, 2), 333);
  const clip = b.exportClip(30000);
  assert.ok(clip);
  assert.ok(clip.buffer.subarray(0, b.header.length).equals(b.header), 'começa com o cabeçalho');
  const cl = reparse(clip.buffer);
  assert.equal(cl[0].timecode, 0, 'tempo recomeça do zero');
  assert.equal(cl[0].hasKey, true, 'primeiro quadro é chave');
  // Inclui o cluster em andamento (59 s) → 30 clusters a partir do 29/30 s.
  assert.ok(clip.durationMs >= 30000 && clip.durationMs <= 32000, String(clip.durationMs));
  assert.deepEqual(cl.map((c) => c.timecode).slice(0, 3), [0, 1000, 2000]);
});

test('menos de 30 s gravados: exporta o que tem desde o primeiro quadro-chave', () => {
  const b = new WebmClipBuffer();
  feed(b, stream(5, 2), 50);
  const clip = b.exportClip(30000);
  assert.ok(clip);
  assert.equal(reparse(clip.buffer)[0].timecode, 0);
  assert.ok(clip.durationMs < 6000);
});

test('sem cabeçalho ou sem nenhum quadro-chave: não exporta nada', () => {
  const b = new WebmClipBuffer();
  assert.equal(b.exportClip(), null);
  b.push(header());
  b.push(cluster(0, false));
  b.push(cluster(1000, false));
  assert.equal(b.exportClip(), null);
});

test('lixo no fluxo zera o buffer sem lançar; reset recomeça limpo', () => {
  const b = new WebmClipBuffer();
  b.push(Buffer.from([0x00, 0x00, 0x00, 0x00]));
  assert.ok(b.error);
  assert.equal(b.headerReady, false);
  feed(b, stream(3), 10);
  assert.ok(b.headerReady);
  b.reset();
  assert.equal(b.clusters.length, 0);
  assert.equal(b.exportClip(), null);
});

test('teto de memória corta do começo', () => {
  const b = new WebmClipBuffer({ keepMs: 10 ** 9, maxBytes: 400 });
  feed(b, stream(40, 1), 1000);
  assert.ok(b.bytes <= 400 || b.clusters.length === 1);
  assert.ok(b.exportClip(), 'ainda exporta (todo cluster aqui é chave)');
});
