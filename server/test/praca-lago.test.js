// Lago (server/waddle/praca-lago/): sala própria do Project Club com a arte do
// dono — entra na camada da ilha, tem música, nome em português e o SWF é válido.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');

const src = (rel) => path.join(__dirname, '..', 'src', rel);
const stub = (rel, exports) => { require.cache[src(rel)] = { id: src(rel), filename: src(rel), loaded: true, exports }; };
const media = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-lago-'));
process.env.WADDLE_MEDIA_DIR = media;
stub('config/prisma.js', { plazaSetting: { findUnique: async () => null, upsert: async ({ create }) => create } });
stub('services/waddle/parties.js', { apply: () => {} });
const island = require(src('services/waddle/island.js'));
const LAGO = path.join(__dirname, '..', 'waddle', 'praca-lago', 'lago.swf');

function tags(swf) {
  const body = swf.subarray(0, 3).toString('latin1') === 'CWS' ? zlib.inflateSync(swf.subarray(8)) : swf.subarray(8);
  const nbits = body[0] >> 3;
  let off = Math.ceil((5 + 4 * nbits) / 8) + 4;
  const out = [];
  while (off + 2 <= body.length) {
    const h = body.readUInt16LE(off); const code = h >> 6; let len = h & 63; let hl = 2;
    if (len === 63) { len = body.readUInt32LE(off + 2); hl = 6; }
    out.push({ code, body: body.subarray(off + hl, off + hl + len) });
    if (code === 0) break;
    off += hl + len;
  }
  return out;
}

test('lago.swf é um SWF de sala válido: camadas com os nomes que o engine espera e o script da sala', () => {
  const swf = fs.readFileSync(LAGO);
  assert.equal(swf.subarray(0, 3).toString('latin1'), 'FWS');
  const t = tags(swf);
  const names = t.filter((x) => x.code === 26 && x.body[0] & 0x20).map((x) => x.body.subarray(x.body.indexOf(0, 5) + 0).toString('latin1'));
  const placed = t.filter((x) => x.code === 26).map((x) => x.body.toString('latin1'));
  for (const n of ['background_mc', 'foreground_mc', 'triggers_mc', 'block_mc']) assert.ok(placed.some((p) => p.includes(n + '\0')), n);
  assert.ok(t.some((x) => x.code === 12 && x.body.length > 50), 'DoAction compilado');
  const action = t.find((x) => x.code === 12).body.toString('latin1');
  for (const s of ['start_x', 'triggers_mc', 'forest', 'cove', 'sendJoinRoom', 'water_mc']) assert.ok(action.includes(s), s);
  assert.ok(t.some((x) => x.code === 39), 'sprites');
  assert.equal(t.at(-1).code, 0);
});

test('entra na camada da ilha (copiado pra media/pcisland), com música e nome em português', () => {
  const o = island.overlay();
  assert.equal(o.rooms.lago, 'pcisland/lago.swf');
  assert.equal(fs.statSync(path.join(media, 'pcisland', 'lago.swf')).size, fs.statSync(LAGO).size);
  assert.equal(o.music.lago, undefined, 'sem o arquivo da música no disco, fica sem música');
  fs.writeFileSync(path.join(media, 'pcisland', 'Music658.swf'), Buffer.alloc(2000, 1));
  assert.equal(island.overlay().music.lago, 658);
  assert.equal(island.roomName('lago'), 'Lago');
  assert.equal(island.STRINGS['w.map.lago'], 'Lago');
  assert.match(island.code(), /^15\d{4}$/);
});

test('patches do WF: mapa recebe ícone + script, Floresta e Enseada recebem o gatilho', () => {
  const dir = path.join(__dirname, '..', 'waddle', 'src', 'server', 'file-server');
  const map = fs.readFileSync(path.join(dir, 'praca-lago-map-tags.ts'), 'utf8');
  const blob = Buffer.from(map.match(/'([A-Za-z0-9+/=]+)'/)[1], 'base64');
  assert.ok(blob.toString('latin1').includes('pc_lago_icon\0'), 'símbolo exportado do ícone');
  assert.ok(blob.toString('latin1').includes('pc_lago_hit\0'), 'área de clique');
  assert.ok(blob.toString('latin1').includes('sendJoinRoomFromMap'));
  for (const f of ['forest', 'cove']) {
    const ts = fs.readFileSync(path.join(dir, `praca-lago-${f}-action.ts`), 'utf8');
    const b = Buffer.from(ts.match(/'([A-Za-z0-9+/=]+)'/)[1], 'base64').toString('latin1');
    assert.ok(b.includes('lago_mc') && b.includes('startRoom') && b.includes('"lago"') || b.includes('lago\0'), f);
  }
  const patches = fs.readFileSync(path.join(dir, 'swf-patches.ts'), 'utf8');
  for (const r of ['PRACA_LAGO_MAP_TAGS]', 'PRACA_LAGO_FOREST_DOACTION]', 'PRACA_LAGO_COVE_DOACTION]']) assert.ok(patches.includes(r), r);
});
