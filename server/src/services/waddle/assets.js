'use strict';
// Arquivos da Club Penguin Archives (archives.clubpenguinwiki.info) na ilha.
//
// A Archives guarda ~58 mil arquivos do jogo original (salas de festas,
// catálogos, músicas, telas…) — é de lá que vem a mídia do Waddle Forever e
// as festas de 2013-2017 (parties.js). Aqui a staff cola o link de um
// arquivo da Archives no painel e ele entra na ilha POR CIMA da festa atual:
//   - room:  chave da sala (town, plaza…) → o SWF vira a sala
//   - route: qualquer rota do jogo (play/v2/content/global/content/map.swf,
//            play/v2/content/local/pt/catalogues/clothing.swf…)
//   - music: id de música → SWF/MP3 novo pro Jukebox e pras salas
// Tudo fica em media/pcarchives e registrado no MySQL (PlazaAsset); a camada
// é reaplicada na hora (parties.apply) sem reiniciar o jogo. A Archives só
// pede um link de volta — está na página da Praça e nos créditos do app.
const fs = require('fs');
const path = require('path');
const prisma = require('../../config/prisma');

const HOST = 'archives.clubpenguinwiki.info';
const SUBDIR = 'pcarchives';
const MAX_BYTES = 60 * 1024 * 1024;
const KINDS = ['room', 'route', 'music'];
const mediaDir = () => process.env.WADDLE_MEDIA_DIR || path.join(process.env.WADDLE_DATA_DIR || path.join(__dirname, '..', '..', '..', 'data', 'waddle'), 'media');
const dir = () => path.join(mediaDir(), SUBDIR);

let cache = []; // assets ligados, em memória (parties.apply é síncrono)

/** Link do painel → URL que entrega o arquivo. Aceita página File:, nome do arquivo ou link direto da Archives. */
function resolveUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) throw new Error('Cole o link do arquivo na Club Penguin Archives.');
  let name = null;
  const m = s.match(/\/wiki\/(?:File|Arquivo):([^?#]+)/i);
  if (m) name = decodeURIComponent(m[1]);
  else if (!/^https?:\/\//i.test(s) && !s.includes('/')) name = s;
  if (name) return { url: `https://${HOST}/wiki/Special:FilePath/${encodeURIComponent(name.replace(/ /g, '_'))}`, name: name.replace(/_/g, ' ') };
  let u;
  try { u = new URL(s); } catch { throw new Error('Link inválido.'); }
  if (u.hostname !== HOST && !u.hostname.endsWith(`.${HOST}`)) throw new Error('Só arquivos da Club Penguin Archives (archives.clubpenguinwiki.info).');
  return { url: u.toString(), name: decodeURIComponent(path.basename(u.pathname)) };
}

function sniff(buf, ext) {
  const head = buf.subarray(0, 4).toString('latin1');
  if (ext === '.swf') return ['FWS', 'CWS', 'ZWS'].includes(head.slice(0, 3));
  if (ext === '.mp3') return head.startsWith('ID3') || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
  if (ext === '.png') return buf[0] === 0x89 && head.slice(1, 4) === 'PNG';
  if (ext === '.jpg' || ext === '.jpeg') return buf[0] === 0xff && buf[1] === 0xd8;
  if (ext === '.xml' || ext === '.json' || ext === '.txt') return true;
  return false;
}

const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9._/-]/g, '_').replace(/\.\.+/g, '.').replace(/^\/+/, '').slice(0, 160);

function cleanTarget(kind, target) {
  const t = String(target || '').trim();
  if (kind === 'room') { const k = t.toLowerCase().replace(/[^a-z0-9_]/g, ''); if (!k) throw new Error('Informe a chave da sala (ex.: town, plaza, dance).'); return k; }
  if (kind === 'music') { const id = Number(t); if (!Number.isInteger(id) || id <= 0) throw new Error('Informe o id da música (número).'); return String(id); }
  const r = t.replace(/^\/+/, '');
  if (!/^play\/v2\/content\/[a-zA-Z0-9_./-]+$/.test(r) || r.includes('..')) throw new Error('A rota precisa começar com play/v2/content/ (ex.: play/v2/content/global/content/map.swf).');
  return r;
}

/** Baixa o arquivo da Archives e registra o asset. */
async function add({ url: raw, kind, target, label, enabled = true }) {
  if (!KINDS.includes(kind)) throw new Error('Tipo inválido (room, route ou music).');
  const tgt = cleanTarget(kind, target);
  const { url, name } = resolveUrl(raw);
  const ext = path.extname(name).toLowerCase() || '.swf';
  if (!['.swf', '.mp3', '.png', '.jpg', '.jpeg', '.xml', '.json', '.txt'].includes(ext)) throw new Error(`Extensão ${ext || '?'} não é aceita.`);
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'ProjectClub-Praca/1.0 (+https://github.com/RiqueBitt/ProjectClub)' } }).catch((e) => { throw new Error(`Não deu pra baixar: ${e.message}`); });
  if (!res.ok) throw new Error(`A Archives respondeu ${res.status} pra esse arquivo.`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('Arquivo grande demais (máx. 60 MB).');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('Arquivo grande demais (máx. 60 MB).');
  if (buf.length < 16 || !sniff(buf, ext)) throw new Error('O conteúdo baixado não parece um arquivo do jogo (o link precisa ser do arquivo, não da página).');
  const rel = path.posix.join(kind, safe(tgt.replace(/\//g, '__')), `${Date.now()}-${safe(name)}`);
  const abs = path.join(dir(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  const row = await prisma.plazaAsset.create({ data: { kind, target: tgt, file: rel, label: String(label || name).slice(0, 120), source: String(raw).slice(0, 500), enabled: !!enabled } });
  await reload();
  return row;
}

async function update(id, { enabled, label, target }) {
  const row = await prisma.plazaAsset.findUnique({ where: { id: String(id) } });
  if (!row) throw new Error('Arquivo não encontrado.');
  const data = {};
  if (typeof enabled === 'boolean') data.enabled = enabled;
  if (label !== undefined) data.label = String(label).slice(0, 120);
  if (target !== undefined) data.target = cleanTarget(row.kind, target);
  const out = await prisma.plazaAsset.update({ where: { id: row.id }, data });
  await reload();
  return out;
}

async function remove(id) {
  const row = await prisma.plazaAsset.findUnique({ where: { id: String(id) } });
  if (!row) return;
  await prisma.plazaAsset.delete({ where: { id: row.id } });
  try { fs.unlinkSync(path.join(dir(), row.file)); } catch { /* já foi */ }
  await reload();
}

async function list() {
  const rows = await prisma.plazaAsset.findMany({ orderBy: { createdAt: 'desc' }, take: 300 });
  return rows.map((r) => ({ ...r, onDisk: fs.existsSync(path.join(dir(), r.file)) }));
}

/** Recarrega a lista em memória e reaplica a camada na ilha. */
async function reload() {
  try {
    const rows = await prisma.plazaAsset.findMany({ where: { enabled: true } });
    cache = rows.filter((r) => fs.existsSync(path.join(dir(), r.file)));
  } catch { cache = []; }
  try { require('./parties').apply(true); } catch { /* jogo ainda não subiu */ }
  return cache.length;
}

/** Camada pra parties.apply: { rooms, routes, musicFiles, any }. */
function overlay() {
  const out = { rooms: {}, routes: {}, musicFiles: {}, any: false };
  for (const a of cache) {
    const file = `${SUBDIR}/${a.file}`;
    if (a.kind === 'room') out.rooms[a.target] = file;
    else if (a.kind === 'music') out.musicFiles[a.target] = file;
    else out.routes[a.target] = file;
    out.any = true;
  }
  return out;
}

module.exports = { KINDS, HOST, resolveUrl, add, update, remove, list, reload, overlay, _cleanTarget: cleanTarget };
