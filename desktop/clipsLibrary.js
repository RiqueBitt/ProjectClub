// Biblioteca de clipes do Game Hub: o site lista, toca e organiza os vídeos
// da pasta de clipes (Vídeos/Project Club Clipes) sem eles saírem do PC.
//
//  - list(dir)      → os vídeos da pasta (nome, tamanho, data, jogo pelo nome)
//  - resolve(dir,n) → caminho do arquivo SÓ se `n` for um nome de vídeo que
//                      está direto na pasta (sem "..", sem barra, sem atalho)
//  - handleRequest  → atende pcclip://clip/<nome> pro <video> do site, com
//                      Range (dá pra arrastar a barra do vídeo)
// Apagar manda pra Lixeira (dá pra desfazer); quem chama é o main.js.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const EXT_MIME = { '.webm': 'video/webm', '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime' };
const MAX_LIST = 300;
const SCHEME = 'pcclip';

// "Valorant 2026-11-26 21-04-11 (2).webm" → { game: 'Valorant', at: Date }
const NAME_RE = /^(.*?)\s*(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})(?: \(\d+\))?\.[a-z0-9]+$/i;
function parseName(name) {
  const m = NAME_RE.exec(name);
  if (!m) return { game: null, at: null };
  const game = m[1].trim();
  return { game: game && game.toLowerCase() !== 'clipe' ? game : null, at: new Date(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]) };
}

function isClipName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 255
    && name === path.basename(name) && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..'
    && !name.startsWith('.') && Object.prototype.hasOwnProperty.call(EXT_MIME, path.extname(name).toLowerCase());
}

async function list(dir, { fsx = fs } = {}) {
  let names = [];
  try { names = await fsx.promises.readdir(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!isClipName(name)) continue;
    try {
      const st = await fsx.promises.lstat(path.join(dir, name));
      if (!st.isFile() || st.size <= 0) continue;
      const parsed = parseName(name);
      out.push({ name, size: st.size, mtime: st.mtimeMs, game: parsed.game, recordedAt: (parsed.at || new Date(st.mtimeMs)).toISOString() });
    } catch { /* sumiu no meio: ignora */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_LIST);
}

function resolve(dir, name, { fsx = fs } = {}) {
  if (!isClipName(name)) return null;
  const file = path.join(dir, name);
  if (path.dirname(file) !== path.resolve(dir) && path.dirname(file) !== dir) return null;
  try {
    const st = fsx.lstatSync(file);
    return st.isFile() ? file : null;
  } catch { return null; }
}

const fileUrlFor = (name) => `${SCHEME}://clip/${encodeURIComponent(name)}`;

// pcclip://clip/<nome> → Response (com Range).
async function handleRequest(request, dir, { fsx = fs } = {}) {
  let name = null;
  try {
    const u = new URL(request.url);
    if (u.hostname !== 'clip') return new Response('não encontrado', { status: 404 });
    name = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  } catch { return new Response('pedido inválido', { status: 400 }); }
  const file = resolve(dir, name, { fsx });
  if (!file) return new Response('não encontrado', { status: 404 });
  const { size } = fsx.statSync(file);
  const type = EXT_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const base = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (!(start <= end) || start >= size) return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } });
    start = Math.max(0, start);
    const body = Readable.toWeb(fsx.createReadStream(file, { start, end }));
    return new Response(body, { status: 206, headers: { ...base, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` } });
  }
  return new Response(Readable.toWeb(fsx.createReadStream(file)), { status: 200, headers: { ...base, 'content-length': String(size) } });
}

module.exports = { list, resolve, handleRequest, parseName, isClipName, fileUrlFor, SCHEME, EXT_MIME };
