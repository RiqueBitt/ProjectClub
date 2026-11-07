'use strict';
// Ilha 2015 — o mapa final do Club Penguin (junho de 2015, o mais bonito) como
// mapa normal da Praça, TODAS as salas principais na última versão normal
// (2015-2017) da Archives, e as salas que o mapa aponta e o Waddle Forever
// (que para em 2012) não tem: Hotel dos Puffles (saguão, spa, terraço), Parque
// dos Puffles, Puffle Wild e a Escola (no lugar da Usina de Reciclagem, mesmo
// id 122). A Praça e o Pet Shop entram na versão de 2015 pra ter as portas
// do hotel e do parque. O Shopping (id 340) continua sendo o Palco.
//
// Tudo é arquivo ORIGINAL do jogo, da Club Penguin Archives (espelho da
// Solero, de onde também vêm as festas 2013-2017). Baixa uma vez pra
// media/pcisland/ e entra na ilha como camada por baixo da festa atual
// (parties.apply), então os mapas e salas decorados de cada festa continuam
// por cima. A staff liga/desliga no painel (PlazaSetting 'island').
const fs = require('fs');
const path = require('path');
const prisma = require('../../config/prisma');

const SUBDIR = 'pcisland';
const MAP_ROUTE = 'play/v2/content/global/content/map.swf';
const HOSTS = ['https://archives.clubpenguinwiki.info/', 'https://toolbox.solero.me/cparchives/'];
const mediaDir = () => process.env.WADDLE_MEDIA_DIR || path.join(process.env.WADDLE_DATA_DIR || path.join(__dirname, '..', '..', '..', 'data', 'waddle'), 'media');
const dir = () => path.join(mediaDir(), SUBDIR);

// Arquivos (caminho na Archives; o nome local é o próprio nome do arquivo).
const FILES = {
  map: 'static/images/archives/8/8e/ContentMapJun2015.swf',
  rooms: {
    hotellobby: 'static/images/archives/6/6e/RoomsHotelLobby_2.swf',
    hotelspa: 'static/images/archives/4/4c/RoomsHotelspa-June2015.swf',
    hotelroof: 'static/images/archives/9/9f/RoomsPuffleHotelRoof_2.swf',
    park: 'static/images/archives/4/43/RoomsPark.swf',
    pufflewild: 'static/images/archives/1/1a/RoomsPufflewild.swf',
    eco: 'static/images/archives/a/aa/RoomsSchool-May2015.swf', // Escola (id 122)
    plaza: 'static/images/archives/6/62/RoomsPlaza-June2015.swf',
    pet: 'static/images/archives/4/4a/RoomsPet-May2015.swf',
    // o resto da ilha no visual 2015-2017 (última versão normal de cada sala na Archives)
    town: 'static/images/archives/6/63/RoomsTown-November2015.swf',
    coffee: 'static/images/archives/b/bf/RoomsCoffee-May2015.swf',
    book: 'static/images/archives/d/d5/RoomsBook-May2015.swf',
    dance: 'static/images/archives/6/64/RoomsDance-May2015.swf',
    lounge: 'static/images/archives/2/2b/RoomsLounge-May2015.swf',
    shop: 'static/images/archives/6/68/RoomsShop-May2015.swf',
    forts: 'static/images/archives/b/bd/RoomsForts-February2016.swf',
    village: 'static/images/archives/e/e3/RoomsVillage-January2016.swf',
    dock: 'static/images/archives/e/ee/RoomsDock-January2016.swf', // última versão normal da Doca
    lodge: 'static/images/archives/5/53/RoomsLodge-September2015.swf',
    attic: 'static/images/archives/5/5b/RoomsAttic-May2015.swf',
    mtn: 'static/images/archives/7/75/RoomsMtn-May2015.swf',
    dojo: 'static/images/archives/c/c2/RoomsDojo-May2015.swf',
    dojoext: 'static/images/archives/6/69/RoomsDojoext_6.swf',
    pizza: 'static/images/archives/e/e2/RoomsPizza-May2015.swf',
    beach: 'static/images/archives/7/7e/RoomsBeach2.swf',
    light: 'static/images/archives/b/b1/LightCurrent.swf',
    beacon: 'static/images/archives/4/47/RoomsBeacon-May2015.swf',
    forest: 'static/images/archives/d/d7/RoomsForest-June2015.swf',
    cove: 'static/images/archives/c/cb/RoomsCove-May2015.swf',
    mine: 'static/images/archives/e/ee/RoomsMine-2015.swf',
    boiler: 'static/images/archives/b/be/RoomsBoiler-May2015.swf',
    rink: 'static/images/archives/9/9f/RoomsRink-November2015.swf',
  },
  music: { // id → arquivo (o WF não tem essas)
    362: 'static/images/archives/c/cc/Music362.swf', // saguão do hotel
    361: 'static/images/archives/e/e4/Music361.swf', // spa
    360: 'static/images/archives/f/f2/Music360.swf', // terraço
    658: 'static/images/archives/8/8e/Music658.swf', // parque
    897: 'static/images/archives/8/87/Music897.swf', // Puffle Wild
    436: 'static/images/archives/3/34/Music436.swf', // escola
    950: 'static/images/archives/b/be/Music950.swf', // Centro 2015
    674: 'static/images/archives/5/55/Music674.swf', // Lounge 2015
    403: 'static/images/archives/1/16/Music403.swf', // Dojo 2015
    676: 'static/images/archives/0/0e/Music676.swf', // Pizzaria 2015
    583: 'static/images/archives/7/71/Music583.swf', // Holofote 2015
    667: 'static/images/archives/f/f6/Music667.swf', // Caldeira 2015
    588: 'static/images/archives/e/e4/Music588.swf', // Farol
  },
};
const ROOM_MUSIC = { hotellobby: 362, hotelspa: 361, hotelroof: 360, park: 658, pufflewild: 897, eco: 436, town: 950, lounge: 674, dojo: 403, pizza: 676, beacon: 583, boiler: 667, light: 588 };
// nomes em português pras quests/janela Festa (roomInfo em events.js)
const ROOM_NAMES = { hotellobby: 'Saguão do Hotel dos Puffles', hotelspa: 'Spa do Hotel dos Puffles', hotelroof: 'Terraço do Hotel dos Puffles', park: 'Parque dos Puffles', pufflewild: 'Puffle Wild', skatepark: 'Skatepark', eco: 'Escola', lake: 'Lago Escondido' };

// Cenários do Project Club — salas ORIGINAIS de festas do Club Penguin (2010-2011)
// que já vêm na mídia do Waddle Forever (default/archives/), servidas como salas
// fixas com ícone no mapa (server/waddle/praca-lago/icons.json → patch do map.swf).
// Dentro delas os gatilhos usam as chaves "partyN" das festas; o file-server do WF
// troca essas strings pelas chaves daqui (swf-patches.ts). Música: a da festa.
const EXTRA_ROOMS = {
  lake: { file: 'default/archives/RoomsLake-May2015.swf', name: 'Lago Escondido' }, // versão 2015 da sala original (id 814)
  monte1: { file: 'default/archives/RoomsParty1-MtnExpedition.swf', music: 294, name: 'Acampamento Base' },
  monte2: { file: 'default/archives/RoomsParty2-MtnExpedition.swf', music: 294, name: 'Caverna de Gelo' },
  monte3: { file: 'default/archives/RoomsParty3-MtnExpedition.swf', music: 295, name: 'Acampamento do Pico' },
  monte4: { file: 'default/archives/RoomsParty4-MtnExpedition.swf', music: 295, name: 'Encosta da Montanha' },
  monte5: { file: 'default/archives/RoomsParty5-MtnExpedition.swf', music: 295, name: 'Topo da Montanha' },
  monte6: { file: 'default/archives/RoomsParty6-MtnExpedition.swf', music: 256, name: 'Gruta do Tesouro' },
  cavex1: { file: 'default/archives/RoomsParty1-CaveExpedition.swf', music: 247, name: 'Escavação da Caverna' },
  cavex2: { file: 'default/archives/RoomsParty2-CaveExpedition.swf', music: 247, name: 'Lago da Caverna' },
  cavex3: { file: 'default/archives/RoomsParty3-CaveExpedition.swf', music: 247, name: 'Recife Submerso' },
  wilder1: { file: 'default/archives/RoomsParty13-WildernessExpedition.swf', music: 247, name: 'Caverna dos Puffles Marrons' },
  jam10: { file: 'default/archives/RoomsParty-MusicJam2010.swf', music: 271, name: 'Palco Music Maker' },
  copas: { file: 'default/archives/RoomsParty-IslandAdventureParty2010.swf', music: 267, name: 'Casa na Árvore' },
  pirata: { file: 'default/archives/RoomsParty2-IslandAdventureParty2010.swf', music: 289, name: 'Convés do Navio Pirata' },
};
// textos do jogo (dica dos ícones no mapa)
const STRINGS = { 'w.map.lago': 'Lago Escondido' };
for (const [k, r] of Object.entries(EXTRA_ROOMS)) STRINGS[`w.map.${k}`] = r.name;
const extraOnDisk = (rel) => { try { return fs.statSync(path.join(mediaDir(), rel)).size > 1000; } catch { return false; } };
function extraRooms() {
  const out = {};
  for (const [k, r] of Object.entries(EXTRA_ROOMS)) if (extraOnDisk(r.file)) out[k] = r;
  return out;
}

// Os ícones do mapa de 2015 (Parque, Puffle Wild, Skatepark, hotel…) vêm do
// map_triggers.json do jogo; o de 2012 não tem essas entradas, então o
// clique não fazia nada. O WF guarda o map_triggers de 2016 (svanilla): a
// gente serve uma cópia dele com o Skatepark (sala que não temos) apontando
// pra Cabana da Mina, que é vizinha.
const TRIGGERS_ROUTE = 'play/v2/content/global/content/map_triggers.json';
const TRIGGERS_SRC = 'default/svanilla/media/play/v2/content/global/content/map_triggers.json';
const TRIGGERS_OUT = 'map_triggers.json';
const SKATEPARK_FALLBACK = 807; // Cabana da Mina
function buildTriggers() {
  try {
    const src = path.join(mediaDir(), TRIGGERS_SRC);
    if (!fs.existsSync(src)) return false;
    const j = JSON.parse(fs.readFileSync(src, 'utf8'));
    for (const cat of j.categories || []) for (const it of cat.items || []) {
      if (Number(it.roomid) === 435 || it.label === 'skate_park') it.roomid = SKATEPARK_FALLBACK;
    }
    fs.mkdirSync(dir(), { recursive: true });
    const out = path.join(dir(), TRIGGERS_OUT);
    const text = JSON.stringify(j);
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) fs.writeFileSync(out, text);
    return true;
  } catch { return false; }
}

const SETTING_KEY = 'island';
let enabled = true; // ligado por padrão (pedido do dono: mapa de 2015 como o normal)
let state = { state: 'idle', have: 0, total: 0, error: null };

const local = (rel) => path.join(dir(), path.basename(rel));
const onDisk = (rel) => { try { return fs.statSync(local(rel)).size > 1000; } catch { return false; } };
const allFiles = () => [FILES.map, ...Object.values(FILES.rooms), ...Object.values(FILES.music)];
const ready = () => allFiles().every(onDisk);

async function loadSetting() {
  try {
    const row = await prisma.plazaSetting.findUnique({ where: { key: SETTING_KEY } });
    const v = row ? JSON.parse(row.value) : {};
    enabled = v.enabled !== false;
  } catch { enabled = true; }
  return enabled;
}

async function setEnabled(on) {
  enabled = !!on;
  await prisma.plazaSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value: JSON.stringify({ enabled }) }, update: { value: JSON.stringify({ enabled }) } }).catch(() => {});
  try { require('./parties').apply(true); } catch { /* jogo ainda não subiu */ }
  return status();
}

function status() {
  return { enabled, ready: ready(), files: state, rooms: Object.keys(FILES.rooms), map: '2015', extra: Object.keys(extraRooms()) };
}

async function fetchOne(rel) {
  let last = null;
  for (const host of HOSTS) {
    try {
      const res = await fetch(host + rel, { redirect: 'follow', headers: { 'user-agent': 'ProjectClub-Praca/1.0 (+https://github.com/RiqueBitt/ProjectClub)' } });
      if (!res.ok) { last = new Error(`${res.status} em ${host}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const head = buf.subarray(0, 3).toString('latin1');
      if (!['FWS', 'CWS', 'ZWS'].includes(head)) { last = new Error(`não é SWF (${host})`); continue; }
      fs.mkdirSync(dir(), { recursive: true });
      const tmp = `${local(rel)}.part`;
      fs.writeFileSync(tmp, buf); fs.renameSync(tmp, local(rel));
      return true;
    } catch (err) { last = err; }
  }
  throw last || new Error('sem host');
}

/** Baixa o que falta (uma vez; chamado no boot e pelo painel). */
async function ensureFiles(log = () => {}) {
  if (state.state === 'downloading') return state;
  const missing = allFiles().filter((f) => !onDisk(f));
  state = { state: missing.length ? 'downloading' : 'ready', have: allFiles().length - missing.length, total: allFiles().length, error: null };
  if (!missing.length) return state;
  log(`ilha 2015: baixando ${missing.length} arquivo(s) da Club Penguin Archives…`);
  for (const rel of missing) {
    try { await fetchOne(rel); state.have++; } catch (err) { state.error = `${path.basename(rel)}: ${err.message}`; log(`ilha 2015: falhou ${path.basename(rel)} — ${err.message}`); }
  }
  state.state = ready() ? 'ready' : 'partial';
  if (state.state === 'ready') log('ilha 2015: arquivos prontos');
  try { require('./parties').apply(true); } catch { /* ok */ }
  return state;
}

/** Código da camada pra contentVersion: muda quando a lista de arquivos muda (fura o cache de 30 dias). */
function code() {
  // os cenários extras entram na conta pra trocar a versão (cache) quando a lista muda
  return `15${String(Object.keys(FILES.rooms).length + Object.keys(FILES.music).length).padStart(2, '0')}${String(Object.keys(extraRooms()).length).padStart(2, '0')}`;
}

/** Camada pra parties.apply (vazia se desligada ou sem arquivos). */
function overlay() {
  const out = { rooms: {}, music: {}, musicFiles: {}, routes: {}, any: false };
  for (const [k, r] of Object.entries(extraRooms())) {
    out.rooms[k] = r.file; out.any = true;
    if (r.music) out.music[k] = r.music; // músicas de 2010-2011: o WF já tem o arquivo
  }
  if (!enabled) return out;
  if (onDisk(FILES.map)) {
    out.routes[MAP_ROUTE] = `${SUBDIR}/${path.basename(FILES.map)}`; out.any = true;
    if (buildTriggers()) out.routes[TRIGGERS_ROUTE] = `${SUBDIR}/${TRIGGERS_OUT}`;
  }
  for (const [key, rel] of Object.entries(FILES.rooms)) {
    if (!onDisk(rel)) continue;
    out.rooms[key] = `${SUBDIR}/${path.basename(rel)}`; out.any = true;
    const m = ROOM_MUSIC[key];
    if (m && onDisk(FILES.music[m])) { out.music[key] = m; out.musicFiles[m] = `${SUBDIR}/${path.basename(FILES.music[m])}`; }
  }
  return out;
}

/** Nome da sala em português quando a ilha 2015 está ligada (Escola no lugar da Usina). */
function roomName(key) {
  if (EXTRA_ROOMS[key] && key !== 'lake') return EXTRA_ROOMS[key].name;
  return enabled ? ROOM_NAMES[key] || null : (key === 'eco' ? null : ROOM_NAMES[key] || null);
}

function attach() {
  loadSetting().then(() => ensureFiles((m) => console.log(`[praça] ${m}`))).catch((err) => console.warn('[praça] ilha 2015:', err?.message || err));
  // se a Archives estava fora do ar, tenta de novo de tempos em tempos
  setInterval(() => { if (!ready()) ensureFiles(() => {}).catch(() => {}); }, 10 * 60_000).unref?.();
}

module.exports = { attach, overlay, status, setEnabled, ensureFiles, roomName, code, MAP_ROUTE, FILES, STRINGS, EXTRA_ROOMS };
