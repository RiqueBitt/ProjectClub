// Cenários do Project Club (server/waddle/praca-lago/ + island.js EXTRA_ROOMS):
// salas ORIGINAIS de festas servidas como salas fixas, Lago Escondido 2015 e os
// ícones clicáveis no mapa (patch do map.swf).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const src = (rel) => path.join(__dirname, '..', 'src', rel);
const stub = (rel, exports) => { require.cache[src(rel)] = { id: src(rel), filename: src(rel), loaded: true, exports }; };
const media = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-cenarios-'));
process.env.WADDLE_MEDIA_DIR = media;
stub('config/prisma.js', { plazaSetting: { findUnique: async () => null, upsert: async ({ create }) => create } });
stub('services/waddle/parties.js', { apply: () => {} });
const island = require(src('services/waddle/island.js'));
const WF = path.join(__dirname, '..', 'waddle');

test('sem os arquivos na mídia nenhum cenário entra; com eles, cada um vira sala com música e nome', () => {
  assert.deepEqual(island.overlay().rooms, {});
  fs.mkdirSync(path.join(media, 'default/archives'), { recursive: true });
  for (const r of Object.values(island.EXTRA_ROOMS)) fs.writeFileSync(path.join(media, r.file), Buffer.alloc(2000, 1));
  const o = island.overlay();
  assert.equal(o.rooms.monte1, 'default/archives/RoomsParty1-MtnExpedition.swf');
  assert.equal(o.rooms.lake, 'default/archives/RoomsLake-May2015.swf', 'Lago Escondido na versão de 2015');
  assert.equal(o.music.monte2, 294); assert.equal(o.music.lake, undefined);
  assert.equal(island.roomName('monte5'), 'Topo da Montanha');
  assert.equal(island.STRINGS['w.map.lago'], 'Lago Escondido');
  assert.equal(island.STRINGS['w.map.copas'], 'Casa na Árvore');
  assert.match(island.code(), /^15\d{2}14$/, '14 cenários entram na versão de cache');
});

test('o fork do WF conhece as salas (ROOMS, rooms.json) com os mesmos ids', () => {
  const rooms = fs.readFileSync(path.join(WF, 'src/server/game-data/rooms.ts'), 'utf8');
  const json = fs.readFileSync(path.join(WF, 'src/server/file-generators/rooms.json.ts'), 'utf8');
  for (const k of Object.keys(island.EXTRA_ROOMS)) {
    if (k === 'lake') continue;
    const m = rooms.match(new RegExp(`'${k}': \\{ id: (\\d+)`));
    assert.ok(m, `${k} em ROOMS`);
    assert.ok(json.includes(`"room_id": ${m[1]},\n      "room_key": "${k}"`), `${k} (${m[1]}) em rooms.json`);
  }
});

test('patches do WF: mapa recebe um ícone por entrada de icons.json; cadeias de expedição renomeadas', () => {
  const dir = path.join(WF, 'src', 'server', 'file-server');
  const icons = JSON.parse(fs.readFileSync(path.join(WF, 'praca-lago', 'icons.json'), 'utf8'));
  const blob = Buffer.from(fs.readFileSync(path.join(dir, 'praca-lago-map-tags.ts'), 'utf8').match(/'([A-Za-z0-9+/=]+)'/)[1], 'base64').toString('latin1');
  for (const ic of icons) {
    assert.ok(blob.includes(`pc_icon_${ic.key}\0`) && blob.includes(`pc_hit_${ic.key}\0`), ic.key);
    assert.ok(ic.room === 'lake' || island.EXTRA_ROOMS[ic.room], `${ic.key} → sala ${ic.room}`);
  }
  assert.ok(blob.includes('sendJoinRoomFromMap'));
  const patches = fs.readFileSync(path.join(dir, 'swf-patches.ts'), 'utf8');
  assert.ok(patches.includes('PRACA_LAGO_MAP_TAGS]'));
  for (const [key, from, to] of [['monte1', 'party2', 'monte2'], ['monte4', 'party6', 'monte6'], ['cavex2', 'party3', 'cavex3'], ['wilder1', 'party12', 'wilder1']]) {
    assert.ok(patches.includes(`rooms\\/${key}\\.swf`) && patches.includes(`from: '${from}\\0', to: '${to}\\0'`), `${key}: ${from} → ${to}`);
  }
  assert.ok(!patches.includes('FOREST_DOACTION'), 'entradas do Lago antigo saíram');
});
