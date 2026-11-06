'use strict';
// Ilha 2015 — o mapa final do Club Penguin (junho de 2015, o mais bonito) como
// mapa normal da Praça, com as salas que ele aponta e o Waddle Forever (que
// para em 2012) não tem: Hotel dos Puffles (saguão, spa, terraço), Parque
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
  },
  music: { // id → arquivo (o WF não tem essas)
    362: 'static/images/archives/c/cc/Music362.swf', // saguão do hotel
    361: 'static/images/archives/e/e4/Music361.swf', // spa
    360: 'static/images/archives/f/f2/Music360.swf', // terraço
    658: 'static/images/archives/8/8e/Music658.swf', // parque
    897: 'static/images/archives/8/87/Music897.swf', // Puffle Wild
    436: 'static/images/archives/3/34/Music436.swf', // escola
  },
};
const ROOM_MUSIC = { hotellobby: 362, hotelspa: 361, hotelroof: 360, park: 658, pufflewild: 897, eco: 436 };
// nomes em português pras quests/janela Festa (roomInfo em events.js)
const ROOM_NAMES = { hotellobby: 'Saguão do Hotel dos Puffles', hotelspa: 'Spa do Hotel dos Puffles', hotelroof: 'Terraço do Hotel dos Puffles', park: 'Parque dos Puffles', pufflewild: 'Puffle Wild', skatepark: 'Skatepark', eco: 'Escola' };

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
  return { enabled, ready: ready(), files: state, rooms: Object.keys(FILES.rooms), map: '2015' };
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

/** Camada pra parties.apply (vazia se desligada ou sem arquivos). */
function overlay() {
  const out = { rooms: {}, music: {}, musicFiles: {}, routes: {}, any: false };
  if (!enabled) return out;
  if (onDisk(FILES.map)) { out.routes[MAP_ROUTE] = `${SUBDIR}/${path.basename(FILES.map)}`; out.any = true; }
  for (const [key, rel] of Object.entries(FILES.rooms)) {
    if (!onDisk(rel)) continue;
    out.rooms[key] = `${SUBDIR}/${path.basename(rel)}`; out.any = true;
    const m = ROOM_MUSIC[key];
    if (m && onDisk(FILES.music[m])) { out.music[key] = m; out.musicFiles[m] = `${SUBDIR}/${path.basename(FILES.music[m])}`; }
  }
  return out;
}

/** Nome da sala em português quando a ilha 2015 está ligada (Escola no lugar da Usina). */
function roomName(key) { return enabled ? ROOM_NAMES[key] || null : (key === 'eco' ? null : ROOM_NAMES[key] || null); }

function attach() {
  loadSetting().then(() => ensureFiles((m) => console.log(`[praça] ${m}`))).catch((err) => console.warn('[praça] ilha 2015:', err?.message || err));
  // se a Archives estava fora do ar, tenta de novo de tempos em tempos
  setInterval(() => { if (!ready()) ensureFiles(() => {}).catch(() => {}); }, 10 * 60_000).unref?.();
}

module.exports = { attach, overlay, status, setEnabled, ensureFiles, roomName, MAP_ROUTE, FILES };
