// Ilha 2015 (services/waddle/island.js): camada do mapa de 2015 + salas do
// hotel/parque/escola — composição com a festa e nomes em português.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const src = (rel) => path.join(__dirname, '..', 'src', rel);
const stub = (rel, exports) => { require.cache[src(rel)] = { id: src(rel), filename: src(rel), loaded: true, exports }; };

const media = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-ilha-'));
process.env.WADDLE_MEDIA_DIR = media;
const settings = new Map();
stub('config/prisma.js', { plazaSetting: { findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null), upsert: async ({ where, create }) => { settings.set(where.key, create.value); return create; } } });
let applied = 0;
stub('services/waddle/parties.js', { apply: () => { applied++; } });
const island = require(src('services/waddle/island.js'));

test('sem arquivos no disco a camada fica vazia; com os arquivos entra mapa, salas e músicas', async () => {
  assert.equal(island.overlay().any, false);
  assert.equal(island.status().ready, false);
  fs.mkdirSync(path.join(media, 'pcisland'), { recursive: true });
  const fake = (rel) => fs.writeFileSync(path.join(media, 'pcisland', path.basename(rel)), Buffer.alloc(2000, 1));
  fake(island.FILES.map);
  for (const rel of Object.values(island.FILES.rooms)) fake(rel);
  fake(island.FILES.music[362]);
  const o = island.overlay();
  assert.equal(o.any, true);
  assert.equal(o.routes[island.MAP_ROUTE], 'pcisland/ContentMapJun2015.swf');
  assert.equal(o.rooms.hotellobby, 'pcisland/RoomsHotelLobby_2.swf');
  assert.equal(o.rooms.eco, 'pcisland/RoomsSchool-May2015.swf', 'Escola no id da Usina');
  assert.equal(o.music.hotellobby, 362); assert.equal(o.musicFiles[362], 'pcisland/Music362.swf');
  assert.equal(o.music.park, undefined, 'música do parque ainda não baixou → sala sem música nova');
  assert.equal(island.status().ready, false, 'faltam músicas');
});

test('liga/desliga pelo painel e reaplica a camada; nomes em português', async () => {
  assert.equal(island.roomName('eco'), 'Escola');
  assert.equal(island.roomName('park'), 'Parque dos Puffles');
  assert.equal(island.roomName('town'), null);
  const st = await island.setEnabled(false);
  assert.equal(st.enabled, false); assert.equal(applied, 1);
  assert.equal(island.overlay().any, false);
  assert.equal(island.roomName('eco'), null, 'desligada, a sala 122 volta a ser a Usina');
  await island.setEnabled(true);
  assert.equal(island.overlay().any, true);
  assert.equal(JSON.parse(settings.get('island')).enabled, true);
});
