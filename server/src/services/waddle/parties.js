'use strict';
// Festas de 2013-2017 na Praça (Club Penguin).
//
// O Waddle Forever tem a linha do tempo detalhada até 2012; das festas de
// 2013 em diante ele não tem nada. As salas dessas festas vêm da Club Penguin
// Archives (release "waddle-parties", montada pelo workflow
// .github/workflows/waddle-parties.yml) e entram na ilha como uma "camada de
// festa" por cima da data atual (GameData.setPartyOverlay).
//
// Quando cada festa roda:
//  - Rodízio de anos: o calendário continua acompanhando o dia de hoje, mas
//    cada mês usa a festa de um ano diferente (2012…2016, e 2017 em jan-mar).
//    Ano 2012 = festas originais do Waddle Forever. Com uma festa nova por
//    cima, a ilha usa um dia de 2012 sem festa (as decorações não se misturam).
//  - Festas de outras marcas da Disney (Star Wars, Frozen, Marvel…) NÃO entram
//    no rodízio: só rodam quando a staff liga no painel (e param quando desliga).
//  - A staff pode ligar qualquer festa (do rodízio ou não) a qualquer momento.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const DATA = require('./parties-data.json');
const RELEASE = process.env.PLAZA_PARTIES_RELEASE ?? 'https://github.com/RiqueBitt/ProjectClub/releases/download/waddle-parties';
const ROTATION = [2012, 2013, 2014, 2015, 2016];
const ROTATION_JAN_MAR = [2012, 2013, 2014, 2015, 2016, 2017];

const mediaDir = () => process.env.WADDLE_MEDIA_DIR || path.join(process.env.WADDLE_DATA_DIR || path.join(__dirname, '..', '..', '..', 'data', 'waddle'), 'media');
const filesDir = () => path.join(mediaDir(), 'parties', 'pcparties');
const stateFile = () => path.join(process.env.WADDLE_DATA_DIR || path.join(__dirname, '..', '..', '..', 'data', 'waddle'), 'pc-party.json');

const bySlug = new Map(DATA.parties.map((p) => [p.slug, p]));
let manual = null; // slug ligado pela staff
let active = null; // { slugs: [principal, ...], source: 'staff' | 'rotation' }
let downloadState = { state: 'idle' };
let instance = null;

function readState() {
  try {
    const j = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    manual = typeof j.manual === 'string' && bySlug.has(j.manual) ? j.manual : null;
  } catch { manual = null; }
}

function writeState() {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify({ manual, at: new Date().toISOString() }));
  } catch (err) { console.warn('[festas] não deu pra gravar o estado:', err?.message || err); }
}

let fileExists = (file) => fs.existsSync(file);
const MAP_ROUTE = 'play/v2/content/global/content/map.swf';
const onDisk = (file) => { try { return fileExists(path.join(filesDir(), file)); } catch { return false; } };

/** Algum arquivo citado pelas festas (salas, mapa, músicas) ainda falta no disco? */
function anyMissing() {
  return DATA.parties.some((p) => [...Object.values(p.rooms || {}), ...(p.map ? [p.map] : []), ...Object.values(p.musicFiles || {})].some((f) => !onDisk(f)));
}

/** Os arquivos das salas desta festa estão no disco? */
function filesReady(party) {
  const files = Object.values(party.rooms || {});
  return files.length > 0 && files.every((file) => {
    try { return fileExists(path.join(filesDir(), file)); } catch { return false; }
  });
}

const mmdd = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A festa cobre esse dia do ano (MM-DD)? Aceita festas que viram o ano (dez→jan). */
function covers(party, day) {
  return party.start <= party.end ? (day >= party.start && day <= party.end) : (day >= party.start || day <= party.end);
}

/** Ano do rodízio pra este mês (muda todo mês; jan-mar inclui 2017). */
function rotationYear(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  // jan-mar: 6 anos (inclui 2017); 12 é múltiplo de 6, então ali a conta é ano + mês
  if (m < 3) return ROTATION_JAN_MAR[(y + m) % ROTATION_JAN_MAR.length];
  return ROTATION[(y * 12 + m) % ROTATION.length];
}

const days = (p) => {
  const n = (mmddStr) => { const [m, d] = mmddStr.split('-').map(Number); return (m - 1) * 31 + d; };
  const a = n(p.start); const b = n(p.end);
  return b >= a ? b - a : b + 372 - a;
};

/**
 * Qual festa nova deve estar na ilha agora (ou null = ilha original do WF).
 * Festas do mesmo ano que coincidem (ex.: Halloween + aniversário) entram
 * juntas: a mais longa é a principal e as salas da menor vão por cima.
 */
function wanted(now = new Date()) {
  if (manual) return { slugs: [manual], source: 'staff' };
  const year = rotationYear(now);
  if (year === 2012) return null;
  const day = mmdd(now);
  const hits = DATA.parties.filter((p) => p.year === year && !p.licensed && covers(p, day) && filesReady(p));
  if (!hits.length) return null;
  hits.sort((a, b) => days(b) - days(a));
  return { slugs: hits.map((p) => p.slug), source: 'rotation' };
}

const key = (w) => (w ? `${w.source}:${w.slugs.join('+')}` : '');

/** Junta as festas (a primeira é a principal). */
function merged(slugs) {
  const parties = slugs.map((s) => bySlug.get(s));
  const main = parties[0];
  const out = { name: main.name, label: main.label, rooms: {}, music: {}, musicFiles: {}, routes: {} };
  for (const p of parties) {
    Object.assign(out.rooms, overlayRooms(p));
    Object.assign(out.music, overlayMusic(p));
    Object.assign(out.musicFiles, overlayMusicFiles(p));
  }
  // mapa da ilha decorado: o da festa principal (ou de outra que tenha)
  const withMap = parties.find((p) => p.map && onDisk(p.map));
  if (withMap) out.routes[MAP_ROUTE] = `parties/pcparties/${withMap.map}`;
  return out;
}

function overlayRooms(party) {
  const out = {};
  for (const [room, file] of Object.entries(party.rooms)) out[room] = `parties/pcparties/${file}`;
  return out;
}

/** Músicas novas desta festa (id → arquivo), só as que estão no disco. */
function overlayMusicFiles(party) {
  const out = {};
  for (const [id, file] of Object.entries(party.musicFiles || {})) {
    try { if (fs.existsSync(path.join(filesDir(), file))) out[id] = `parties/pcparties/${file}`; } catch { /* ok */ }
  }
  return out;
}

/** Sala → música, só com músicas que o jogo consegue tocar (do WF ou baixadas). */
function overlayMusic(party) {
  const files = overlayMusicFiles(party);
  const out = {};
  for (const [room, id] of Object.entries(party.music || {})) {
    if (party.haveMusic?.includes(Number(id)) || files[id]) out[room] = Number(id);
  }
  return out;
}

/** Aplica a festa certa na ilha. Devolve true se a festa mudou. */
function apply(force = false) {
  const w = instance;
  if (!w) return false;
  let next = wanted();
  // force: arquivos novos chegaram (ex.: o mapa) — reaplica mesmo sem trocar de festa
  if (!force && key(next) === key(active)) return false;
  const prev = active;
  if (next && !next.slugs.every((s) => filesReady(bySlug.get(s)))) {
    console.warn(`[festas] ${next.slugs.join(', ')}: arquivos ainda não estão no disco`);
    next = null;
  }
  active = next;
  if (next) {
    const m = merged(next.slugs);
    w.gameData.setPartyOverlay(m.name, m.rooms, m.music, m.musicFiles, m.routes);
    console.log(`[festas] na ilha: ${next.slugs.map((s) => bySlug.get(s).name).join(' + ')} (${next.source === 'staff' ? 'ligada pela staff' : 'rodízio'})`);
  } else {
    w.gameData.setPartyOverlay(null);
    if (prev) console.log('[festas] camada de festa desligada');
  }
  try { w.settings.resyncCalendar?.(); } catch { /* ok */ }
  return key(prev) !== key(active);
}

/**
 * Com uma festa nova por cima, a data do jogo vai pro dia mais próximo de
 * 2012 (pra trás) sem festa do WF, pra não misturar duas decorações.
 */
function calendarAdjust(version) {
  if (!active || !instance) return version;
  const gd = instance.gameData;
  if (typeof gd.getPartyAt !== 'function' || !gd.getPartyAt(version)) return version;
  const d = new Date(`${version}T12:00:00Z`);
  for (let i = 1; i <= 200; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const v = d.toISOString().slice(0, 10);
    if (v.slice(0, 4) !== version.slice(0, 4)) break;
    if (!gd.getPartyAt(v)) return v;
  }
  return version;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'ignore' });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} saiu com ${code}`))));
  });
}

const extractTar = (file, dest) => run('tar', ['xf', file, '-C', dest]);

/** Baixa e extrai as festas (uma vez; depois fica no disco). */
async function ensureFiles() {
  const index = path.join(filesDir(), 'index.json');
  const missing = DATA.parties.filter((p) => !filesReady(p)).length;
  // pacote novo (ex.: mapas incluídos depois): baixa de novo se faltar algo
  if (!anyMissing()) { downloadState = { state: 'ready' }; return; }
  if (!RELEASE) { downloadState = { state: 'missing', missing }; return; }
  downloadState = { state: 'downloading', missing };
  const tmp = path.join(mediaDir(), '.tmp-parties.tar');
  try {
    fs.mkdirSync(mediaDir(), { recursive: true });
    // ~650 MB direto pro disco. curl aguenta melhor download longo com o
    // servidor carregado (o fetch do Node estourava o tempo no meio); sem
    // curl, usa o fetch mesmo.
    try {
      await run('curl', ['-fsSL', '--retry', '3', '--retry-delay', '5', '-o', tmp, `${RELEASE}/media-parties.tar`]);
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
      const res = await fetch(`${RELEASE}/media-parties.tar`, { redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    }
    await extractTar(tmp, mediaDir());
    downloadState = { state: fs.existsSync(index) ? 'ready' : 'partial' };
    console.log(`[festas] arquivos das festas 2013-2017 prontos (${DATA.parties.filter(filesReady).length}/${DATA.parties.length} festas)`);
  } catch (err) {
    downloadState = { state: 'error', error: err?.message || String(err) };
    console.warn('[festas] não deu pra baixar as festas:', downloadState.error);
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}

/** Liga o agendador no jogo (chamado uma vez, ao subir o Club Penguin). */
function attach(w) {
  instance = w;
  readState();
  w.settings.calendarAdjust = calendarAdjust;
  apply();
  const download = () => ensureFiles().then(() => apply(true)).catch(() => {});
  download();
  setInterval(() => { try { apply(); } catch (err) { console.warn('[festas]', err?.message || err); } }, 60_000).unref?.();
  // deu erro (rede, servidor ocupado)? tenta baixar de novo a cada 10 min
  setInterval(() => { if (downloadState.state === 'error' || downloadState.state === 'partial') download(); }, 10 * 60_000).unref?.();
}

/** Derruba todo mundo da ilha: o jogo reconecta sozinho já com a festa nova. */
function reloadEveryone(w) {
  try {
    const ids = (w.world.getAllPlayersInfo() || []).map((p) => Number(p.id ?? p.penguinId)).filter(Number.isFinite);
    for (const id of ids) { try { w.world.kick(id); } catch { /* saiu */ } }
    return ids.length;
  } catch { return 0; }
}

/** Painel da staff: liga uma festa (slug) ou volta pro calendário (null). */
function setManual(slug, { reload = true } = {}) {
  if (slug !== null && !bySlug.has(slug)) throw Object.assign(new Error('Festa não encontrada.'), { status: 404 });
  if (slug !== null && !filesReady(bySlug.get(slug))) throw Object.assign(new Error('Os arquivos desta festa ainda não foram baixados no servidor.'), { status: 409 });
  manual = slug;
  writeState();
  const changed = apply();
  const kicked = changed && reload && instance ? reloadEveryone(instance) : 0;
  return { ...status(), kicked };
}

function status() {
  return {
    active: active ? { ...publicParty(bySlug.get(active.slugs[0])), slugs: active.slugs, source: active.source } : null,
    manual,
    rotationYear: rotationYear(),
    files: downloadState,
  };
}

function publicParty(p) {
  return { slug: p.slug, name: p.name, label: p.label, year: p.year, start: p.start, end: p.end, licensed: !!p.licensed, rooms: Object.keys(p.rooms).length, ready: filesReady(p) };
}

function list() {
  return { ...status(), parties: DATA.parties.map(publicParty) };
}

/** Nome em português de uma festa nova (pra barra do jogo), ou null. */
function labelOf(name) {
  const p = DATA.parties.find((x) => x.name === name);
  return p ? p.label : null;
}

/** Testes: troca a checagem de arquivo no disco. */
function _setFileCheck(fn) { fileExists = fn; }

module.exports = { attach, list, status, setManual, labelOf, rotationYear, wanted, covers, merged, _data: DATA, _setFileCheck };
