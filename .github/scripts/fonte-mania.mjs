// Baixa as fontes da coleção "Fonte Mania" da Loja (DaFont e Fontesk) para
// client/public/fonts/pixels-galore/ (pasta com o nome antigo da coleção) e
// escreve o manifest.json que o servidor lê (server/src/services/pixelsGalore.js).
// Roda no GitHub Actions (workflow pixel-fonts.yml). Fonte que não der pra
// baixar fica de fora (aviso no log) sem derrubar as outras.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = 'client/public/fonts/pixels-galore';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

// key = nome do arquivo e do item na Loja (não mudar depois de publicado).
const FONTS = [
  { key: 'minecraft', family: 'Minecraft', dafont: 'minecraft' },
  { key: 'kiwi-soda', family: 'Kiwi Soda', dafont: 'kiwisoda' },
  { key: 'satyr-sp', family: 'Satyr SP', fontesk: 'satyr-sp-2-font' },
  { key: 'matcha-cih', family: 'Matcha Cih', fontesk: 'matcha-cih-font' },
  { key: 'balium', family: 'Balium', fontesk: 'balium-font' },
  { key: 'cartas-de-abril', family: 'Cartas De Abril', fontesk: 'cartas-de-abril-font' },
  { key: 'eastern-rhodopes', family: 'Eastern Rhodopes', fontesk: 'eastern-rhodopes-font' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fontes-'));

async function get(url, referer) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: '*/*', ...(referer ? { Referer: referer } : {}) } });
  if (!res.ok) throw new Error(`${res.status} em ${url}`);
  return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '', url: res.url };
}

const isZip = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;
const isFont = (b) => b.length > 4 && (b.readUInt32BE(0) === 0x00010000 || b.toString('latin1', 0, 4) === 'OTTO' || b.toString('latin1', 0, 4) === 'true');

// Escolhe o arquivo de fonte do pacote: Regular/Book primeiro, .ttf antes de .otf.
function pickFromZip(buf, key) {
  const dir = path.join(tmp, key);
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(tmp, `${key}.zip`);
  fs.writeFileSync(zip, buf);
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
  const all = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/__MACOSX/i.test(e.name)) walk(p); } else if (/\.(ttf|otf)$/i.test(e.name)) all.push(p);
  });
  walk(dir);
  if (!all.length) return null;
  const score = (p) => {
    const n = path.basename(p).toLowerCase();
    return (/regular|book|normal/.test(n) ? 0 : 10) + (/italic|oblique/.test(n) ? 5 : 0) + (/bold|black|light|thin/.test(n) ? 3 : 0) + (n.endsWith('.ttf') ? 0 : 1) + n.length / 1000;
  };
  all.sort((a, b) => score(a) - score(b));
  // licença/leia-me do pacote, se vier
  const lic = [];
  const walk2 = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk2(p); else if (/\.(txt|md|pdf)$/i.test(e.name) && (/licen|read|leia|eula|ofl/i.test(e.name) || /\.txt$/i.test(e.name))) lic.push(p);
  });
  walk2(dir);
  return { file: all[0], license: lic[0] || null };
}

async function fromBuffer(got, key) {
  if (isZip(got.buf)) return pickFromZip(got.buf, key);
  if (isFont(got.buf)) {
    const ext = /\.otf(\?|$)/i.test(got.url) || got.buf.toString('latin1', 0, 4) === 'OTTO' ? 'otf' : 'ttf';
    const p = path.join(tmp, `${key}.${ext}`);
    fs.writeFileSync(p, got.buf);
    return { file: p, license: null };
  }
  return null;
}

async function dafont(f) {
  return fromBuffer(await get(`https://dl.dafont.com/dl/?f=${f.dafont}`), f.key);
}

// Fontesk: o botão DOWNLOAD aponta pra /download/<id do post>/; o id sai do
// shortlink (?p=123) ou da classe "postid-123". Se não der, tenta os links
// externos da página (Google Drive, Dropbox, GitHub, arquivos .zip/.ttf/.otf).
async function fontesk(f) {
  const page = `https://fontesk.com/${f.fontesk}/`;
  const html = (await get(page)).buf.toString('utf8');
  const ids = new Set();
  for (const m of html.matchAll(/[?&]p=(\d+)/g)) ids.add(m[1]);
  for (const m of html.matchAll(/postid-(\d+)/g)) ids.add(m[1]);
  for (const m of html.matchAll(/fontesk\.com\/download\/(\d+)\//g)) if (m[1] !== '156998') ids.add(m[1]);
  ids.delete('156998'); // "Unlimited Fonts" (propaganda), não é a fonte
  const candidates = [...ids].map((id) => `https://fontesk.com/download/${id}/`);
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const u = m[1].replace(/&amp;/g, '&');
    if (/\.(zip|ttf|otf)(\?|$)/i.test(u) || /drive\.google\.com|dropbox\.com|github\.com\/.+\/(raw|releases)/i.test(u)) candidates.push(u);
  }
  for (let u of candidates) {
    try {
      if (/dropbox\.com/.test(u)) u = u.replace(/([?&])dl=0/, '$1dl=1') + (/[?&]dl=1/.test(u) ? '' : (u.includes('?') ? '&dl=1' : '?dl=1'));
      const m = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
      if (m) u = `https://drive.google.com/uc?export=download&id=${m[1]}`;
      // eslint-disable-next-line no-await-in-loop
      const got = await get(u, page);
      // eslint-disable-next-line no-await-in-loop
      const r = await fromBuffer(got, f.key);
      if (r) { console.log(`  ${f.key}: baixada de ${u}`); return r; }
      // Página intermediária (ex.: /download/<id>/ com outro link dentro)
      const inner = got.buf.toString('utf8').match(/href="([^"]+\.(?:zip|ttf|otf)[^"]*)"/i);
      if (inner) {
        // eslint-disable-next-line no-await-in-loop
        const r2 = await fromBuffer(await get(new URL(inner[1].replace(/&amp;/g, '&'), got.url).href, u), f.key);
        if (r2) { console.log(`  ${f.key}: baixada de ${inner[1]}`); return r2; }
      }
    } catch (err) { console.log(`  ${f.key}: ${u} falhou (${err.message})`); }
  }
  return null;
}

fs.mkdirSync(OUT, { recursive: true });
const manifest = [];
const missing = [];
for (const f of FONTS) {
  try {
    console.log(`Fonte ${f.family}…`);
    // eslint-disable-next-line no-await-in-loop
    const r = f.dafont ? await dafont(f) : await fontesk(f);
    if (!r) throw new Error('nenhum arquivo de fonte encontrado');
    const ext = path.extname(r.file).slice(1).toLowerCase();
    fs.copyFileSync(r.file, path.join(OUT, `${f.key}.${ext}`));
    // Licença do pacote com a extensão de verdade (.txt, .md ou .pdf).
    if (r.license) fs.copyFileSync(r.license, path.join(OUT, `${f.key}-LICENCA${path.extname(r.license).toLowerCase()}`));
    manifest.push({ key: f.key, family: f.family, file: `${f.key}.${ext}` });
  } catch (err) {
    // Mantém a versão já baixada antes, se existir.
    const old = fs.readdirSync(OUT).find((n) => n.startsWith(`${f.key}.`) && /\.(ttf|otf)$/.test(n));
    if (old) { manifest.push({ key: f.key, family: f.family, file: old }); console.log(`  ${f.key}: falhou (${err.message}); mantive o arquivo antigo`); } else {
      missing.push(f.family); console.log(`  ${f.key}: FICOU DE FORA (${err.message})`);
    }
  }
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`\n${manifest.length} fonte(s) no manifest.${missing.length ? ` Sem download: ${missing.join(', ')}` : ''}`);
if (missing.length) fs.writeFileSync(process.env.GITHUB_STEP_SUMMARY || '/dev/null', `Fontes sem download: ${missing.join(', ')}\n`, { flag: 'a' });
