// Baixa os emoticons ORIGINAIS do Club Penguin da wiki
// clubpenguinemoticons.fandom.com (MediaWiki API) pra
// client/public/emoji-sets/clubpenguin/ e escreve o manifest.json que o
// servidor usa pra criar a coleção de emoji "Club Penguin"
// (server/src/services/cpEmotes.js). Rodado pelo workflow cp-emotes.yml.
//
// Sem dependências: Node 20 (fetch nativo).
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://clubpenguinemoticons.fandom.com/api.php';
const ROOT_CATEGORIES = ['Category:Emotes'];
const OUT = path.resolve('client/public/emoji-sets/clubpenguin');
const MAX = 80;
const MAX_BYTES = 600 * 1024;
const UA = 'ProjectClubEmotes/1.0 (github.com/RiqueBitt/ProjectClub)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  for (let i = 0; i < 4; i += 1) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    console.warn(`API ${res.status} (${url}), tentando de novo…`);
    await sleep(1500 * (i + 1));
  }
  throw new Error(`A API da wiki não respondeu: ${url}`);
}

// Páginas, arquivos e subcategorias de uma categoria (com continuação).
async function members(cat) {
  const out = [];
  let cont = {};
  do {
    const d = await api({ action: 'query', list: 'categorymembers', cmtitle: cat, cmlimit: '500', cmtype: 'page|subcat|file', ...cont });
    out.push(...(d.query?.categorymembers || []));
    cont = d.continue || null;
  } while (cont);
  return out;
}

// "Coffee Emote" → cp_coffee · "Happy Face" → cp_happy_face
function slug(title) {
  const base = title.replace(/^File:/i, '').replace(/\.(png|gif|jpe?g|svg|webp)$/i, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+emot(e|icon)s?$/i, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 29);
  return base ? `cp_${base}` : null;
}

async function main() {
  // 1) Percorre as categorias (até 3 níveis).
  const pages = new Map(); // título → { title, ns }
  const seenCats = new Set();
  let queue = ROOT_CATEGORIES.map((c) => ({ c, depth: 0 }));
  while (queue.length) {
    const { c, depth } = queue.shift();
    if (seenCats.has(c)) continue;
    seenCats.add(c);
    for (const m of await members(c)) {
      if (m.ns === 14 && depth < 3) queue.push({ c: m.title, depth: depth + 1 });
      else if (m.ns === 0 || m.ns === 6) pages.set(m.title, m);
    }
  }
  console.log(`Categorias: ${[...seenCats].join(', ')}`);
  console.log(`Páginas/arquivos encontrados: ${pages.size}`);

  // 2) Imagem de cada página (pageimages → original) ou o próprio arquivo.
  const items = [];
  const titles = [...pages.keys()];
  for (let i = 0; i < titles.length; i += 40) {
    const chunk = titles.slice(i, i + 40);
    const d = await api({ action: 'query', titles: chunk.join('|'), prop: 'pageimages|imageinfo|images', piprop: 'original', iiprop: 'url|size|mime', imlimit: '5' });
    for (const p of d.query?.pages || []) {
      let src = p.original?.source || (p.ns === 6 ? p.imageinfo?.[0]?.url : null);
      if (!src && p.images?.length) {
        // Página sem imagem principal: usa a primeira imagem dela.
        const f = await api({ action: 'query', titles: p.images[0].title, prop: 'imageinfo', iiprop: 'url' });
        src = f.query?.pages?.[0]?.imageinfo?.[0]?.url || null;
      }
      const name = slug(p.title);
      if (src && name) items.push({ title: p.title, name, src });
    }
  }

  // 3) Baixa (png/gif), sem repetir nome nem arquivo.
  await mkdir(OUT, { recursive: true });
  for (const f of await readdir(OUT).catch(() => [])) await rm(path.join(OUT, f), { force: true });
  const manifest = [];
  const names = new Set();
  const sources = new Set();
  for (const it of items.sort((a, b) => a.name.localeCompare(b.name))) {
    if (manifest.length >= MAX || names.has(it.name) || sources.has(it.src)) continue;
    const res = await fetch(it.src, { headers: { 'User-Agent': UA } });
    if (!res.ok) { console.warn(`Pulando ${it.title}: HTTP ${res.status}`); continue; }
    const type = res.headers.get('content-type') || '';
    const ext = type.includes('gif') ? 'gif' : type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : null;
    if (!ext) { console.warn(`Pulando ${it.title}: tipo ${type}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) { console.warn(`Pulando ${it.title}: ${buf.length} bytes`); continue; }
    const file = `${it.name}.${ext}`;
    await writeFile(path.join(OUT, file), buf);
    manifest.push({ name: it.name, file, title: it.title, source: it.src });
    names.add(it.name); sources.add(it.src);
    console.log(`✓ ${it.name} ← ${it.title}`);
  }
  if (manifest.length < 5) throw new Error(`Só ${manifest.length} emoticon(s) baixados — nada foi gravado no repositório.`);
  await writeFile(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Pronto: ${manifest.length} emoticons em ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
