#!/usr/bin/env node
/* Pré-compressão dos assets do cliente (roda depois do `vite build`).
 *
 * Antes, o servidor comprimia CADA resposta de asset na hora (middleware
 * `compression`, gzip): com muita gente entrando, isso é CPU gasta de novo
 * e de novo no mesmo arquivo. Aqui geramos uma vez, no build, um `.br`
 * (brotli, nível máximo — ~15–20% menor que gzip) e um `.gz` (reserva pra
 * navegadores sem brotli) ao lado de cada asset de texto. O servidor
 * (server/src/app.js, servePrecompressed) entrega o arquivo já comprimido
 * direto do disco, sem gastar CPU, e com o mesmo Cache-Control imutável.
 *
 * Só comprime o que vale a pena: texto (js/css/svg/json/wasm/txt/xml) com
 * mais de 1 KB. Imagens/áudio já são comprimidos por natureza. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIST = path.resolve(__dirname, '..', 'dist');
const EXT = new Set(['.js', '.mjs', '.css', '.svg', '.json', '.wasm', '.txt', '.xml', '.map', '.html']);
const MIN_BYTES = 1024;

if (!fs.existsSync(DIST)) { console.error('[precompress] dist/ não existe — rode o vite build antes.'); process.exit(1); }

let files = 0; let before = 0; let afterBr = 0; let afterGz = 0;
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(p); continue; }
    const ext = path.extname(ent.name).toLowerCase();
    if (!EXT.has(ext) || ent.name.endsWith('.br') || ent.name.endsWith('.gz')) continue;
    // index.html é "no-cache" e muda a cada deploy — não vale a pena.
    if (ent.name === 'index.html') continue;
    const buf = fs.readFileSync(p);
    if (buf.length < MIN_BYTES) continue;
    const br = zlib.brotliCompressSync(buf, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      },
    });
    const gz = zlib.gzipSync(buf, { level: 9 });
    // Só guarda se realmente diminuiu (senão o original é melhor).
    if (br.length < buf.length * 0.95) { fs.writeFileSync(`${p}.br`, br); afterBr += br.length; } else afterBr += buf.length;
    if (gz.length < buf.length * 0.95) { fs.writeFileSync(`${p}.gz`, gz); afterGz += gz.length; } else afterGz += buf.length;
    files += 1; before += buf.length;
  }
}
walk(DIST);
const mb = (n) => (n / 1024 / 1024).toFixed(2);
console.log(`[precompress] ${files} arquivo(s): ${mb(before)} MB → brotli ${mb(afterBr)} MB (${Math.round((1 - afterBr / before) * 100)}% menor) · gzip ${mb(afterGz)} MB`);
