#!/usr/bin/env node
/* Mídia da Praça (Club Penguin / Waddle Forever) — manifesto e upload pro B2.
 *
 * Os ~26 mil SWFs do jogo (1,7 GB) NÃO ficam no Git: ficam no bucket
 * Backblaze B2 do Project Club, na pasta "waddle/", e o servidor baixa
 * cada arquivo uma vez pro cache em disco (server/data/waddle/media).
 *
 * Uso (na raiz do repositório):
 *
 *   # 1) gera server/waddle/media-manifest.json a partir de uma cópia da
 *   #    pasta "media" do Waddle Forever (clone do repositório deles)
 *   node scripts/waddle-media.js manifest /caminho/Waddle-Forever/media
 *
 *   # 2) sobe tudo pro bucket (lê B2_* do server/.env; pula o que já está lá)
 *   node scripts/waddle-media.js upload /caminho/Waddle-Forever/media
 *
 *   # 3) (opcional) confere quantos arquivos do manifesto já estão no bucket
 *   node scripts/waddle-media.js check
 *
 * Depois, no .env de produção: WADDLE_MEDIA_URL=<B2_PUBLIC_URL>/waddle
 * (se não definir, o servidor usa B2_PUBLIC_URL + "/waddle" sozinho).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'server', 'waddle', 'media-manifest.json');
const PREFIX = 'waddle/';
const CONCURRENCY = 24;

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function readManifest() {
  const parsed = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
  return Array.isArray(parsed) ? parsed : parsed.files;
}

const MIME = { swf: 'application/x-shockwave-flash', mp3: 'audio/mpeg', html: 'text/html', css: 'text/css', js: 'text/javascript', xml: 'text/xml', json: 'application/json', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', ico: 'image/x-icon', wav: 'audio/wav' };
const mimeOf = (f) => MIME[f.split('.').pop().toLowerCase()] || 'application/octet-stream';

async function cmdManifest(mediaDir) {
  if (!mediaDir || !fs.existsSync(path.join(mediaDir, 'default'))) throw new Error('Passe a pasta "media" do Waddle Forever (precisa ter default/ e clothing/).');
  const files = walk(mediaDir).sort();
  let bytes = 0;
  for (const f of files) bytes += fs.statSync(path.join(mediaDir, f)).size;
  fs.writeFileSync(MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), count: files.length, bytes, files }));
  console.log(`manifesto: ${files.length} arquivos, ${(bytes / 1e9).toFixed(2)} GB → ${path.relative(ROOT, MANIFEST)}`);
}

function b2() {
  require('dotenv').config({ path: path.join(ROOT, 'server', '.env') });
  const env = require(path.join(ROOT, 'server', 'src', 'config', 'env'));
  if (!env.B2_ENDPOINT || !env.B2_BUCKET || !env.B2_KEY_ID) throw new Error('Configure B2_ENDPOINT, B2_BUCKET, B2_KEY_ID e B2_APPLICATION_KEY em server/.env');
  const { getB2Client } = require(path.join(ROOT, 'server', 'src', 'config', 'b2'));
  return { client: getB2Client(), bucket: env.B2_BUCKET, publicUrl: env.B2_PUBLIC_URL };
}

async function listExisting(client, bucket) {
  const { ListObjectsV2Command } = require(path.join(ROOT, 'server', 'node_modules', '@aws-sdk', 'client-s3'));
  const keys = new Set();
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX, ContinuationToken: token }));
    (res.Contents || []).forEach((o) => keys.add(o.Key.slice(PREFIX.length)));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function cmdUpload(mediaDir) {
  if (!fs.existsSync(MANIFEST)) await cmdManifest(mediaDir);
  const files = readManifest();
  const { client, bucket, publicUrl } = b2();
  const { PutObjectCommand } = require(path.join(ROOT, 'server', 'node_modules', '@aws-sdk', 'client-s3'));
  console.log('listando o que já está no bucket…');
  const existing = await listExisting(client, bucket);
  const todo = files.filter((f) => !existing.has(f));
  console.log(`${existing.size} já no bucket, ${todo.length} pra subir`);
  let done = 0; let failed = 0;
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      const body = fs.readFileSync(path.join(mediaDir, f));
      for (let attempt = 1; ; attempt++) {
        try {
          await client.send(new PutObjectCommand({ Bucket: bucket, Key: PREFIX + f, Body: body, ContentType: mimeOf(f), CacheControl: 'public, max-age=31536000, immutable' }));
          break;
        } catch (err) {
          if (attempt >= 4) { failed++; console.error(`FALHOU ${f}: ${err.message}`); break; }
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
      done++;
      if (done % 200 === 0 || done === todo.length) process.stdout.write(`\r${done}/${todo.length} enviados${failed ? ` (${failed} falhas)` : ''}   `);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\npronto. WADDLE_MEDIA_URL=${publicUrl ? `${publicUrl.replace(/\/+$/, '')}/waddle` : '<B2_PUBLIC_URL>/waddle'}`);
  if (failed) process.exitCode = 1;
}

async function cmdCheck() {
  const files = readManifest();
  const { client, bucket } = b2();
  const existing = await listExisting(client, bucket);
  const missing = files.filter((f) => !existing.has(f));
  console.log(`${files.length - missing.length}/${files.length} no bucket; faltam ${missing.length}`);
  missing.slice(0, 20).forEach((f) => console.log('  -', f));
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'manifest') await cmdManifest(arg);
  else if (cmd === 'upload') await cmdUpload(arg);
  else if (cmd === 'check') await cmdCheck();
  else { console.log('uso: node scripts/waddle-media.js manifest|upload <pasta media> | check'); process.exitCode = 1; }
})().catch((err) => { console.error(err.message || err); process.exit(1); });
