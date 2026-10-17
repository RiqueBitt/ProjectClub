// Backup automático do banco MySQL.
//
// - Diário, num horário de pouco movimento (BACKUP_HOUR, padrão 4h de
//   Brasília) + botão "Fazer backup agora" no painel da staff.
// - Método: `mysqldump` se existir no servidor (--single-transaction
//   --quick: lê em fluxo, sem travar as tabelas); se não existir ou falhar,
//   um dump feito em Node pelo próprio Prisma, tabela por tabela, em lotes
//   pequenos pela chave primária (keyset — nada de OFFSET que fica lento em
//   tabela grande) com uma pausa entre os lotes pra não pesar no banco.
//   Saída sempre em SQL (CREATE TABLE + INSERTs) comprimido com gzip, em
//   fluxo: o arquivo inteiro nunca fica na memória.
// - Destino: S3 compatível (BACKUP_S3_*; Backblaze B2, Cloudflare R2, AWS...)
//   — o disco do app some a cada deploy, então é o recomendado. Sem S3,
//   grava em BACKUP_DIR (padrão server/backups).
// - Guarda os últimos BACKUP_KEEP (padrão 7) e apaga os mais antigos.
// - Um lock no Redis (SET NX + token) garante uma execução por vez mesmo
//   com mais de uma instância; um flag local cobre o caso sem Redis.
// - Falhou: grava no ErrorLog e manda aviso (notificação + push) pra staff.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { PassThrough, Transform } = require('stream');

const FILE_PREFIX = 'projectclub-';
const FILE_SUFFIX = '.sql.gz';
const FILE_RE = /^projectclub-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.sql\.gz$/;
const LOCK_KEY = 'lock:db-backup';
const LOCK_TTL_SECONDS = 3 * 60 * 60;
const STALE_RUNNING_MS = LOCK_TTL_SECONDS * 1000;
const TIME_ZONE = 'America/Sao_Paulo';
const TICK_MS = 10 * 60 * 1000;

// ---------- Configuração ----------
function intEnv(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
function getConfig(env = process.env) {
  const s3Bucket = env.BACKUP_S3_BUCKET || '';
  const s3 = s3Bucket ? {
    bucket: s3Bucket,
    endpoint: env.BACKUP_S3_ENDPOINT || env.B2_ENDPOINT || undefined,
    region: env.BACKUP_S3_REGION || env.B2_REGION || 'us-east-1',
    accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID || env.B2_KEY_ID || '',
    secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY || env.B2_APPLICATION_KEY || '',
    prefix: String(env.BACKUP_S3_PREFIX ?? 'db-backups/').replace(/^\/+/, ''),
  } : null;
  const enabledRaw = env.BACKUP_ENABLED;
  const enabled = enabledRaw === undefined || enabledRaw === ''
    ? env.NODE_ENV === 'production'
    : !['0', 'false', 'off', 'no'].includes(String(enabledRaw).toLowerCase());
  return {
    enabled,
    hour: intEnv(env.BACKUP_HOUR, 4, 0, 23),
    keep: intEnv(env.BACKUP_KEEP, 7, 1, 60),
    dir: path.resolve(env.BACKUP_DIR || path.resolve(__dirname, '../../backups')),
    chunkRows: intEnv(env.BACKUP_CHUNK_ROWS, 1000, 50, 20000),
    pauseMs: intEnv(env.BACKUP_PAUSE_MS, 15, 0, 5000),
    useMysqldump: !['0', 'false', 'off', 'no'].includes(String(env.BACKUP_USE_MYSQLDUMP ?? '1').toLowerCase()),
    s3: s3 && s3.accessKeyId && s3.secretAccessKey ? s3 : null,
    s3Misconfigured: !!(s3 && !(s3.accessKeyId && s3.secretAccessKey)),
  };
}

// mysql://user:pass@host:3306/db?sslca=...&sslcert=...&sslkey=...
function parseDatabaseUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/^mysql/i.test(u.protocol)) return null;
    const params = Object.fromEntries(u.searchParams.entries());
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 3306,
      user: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || ''),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
      params,
    };
  } catch { return null; }
}

function fileNameFor(date = new Date()) {
  const iso = date.toISOString().slice(0, 19).replace(/:/g, '-');
  return `${FILE_PREFIX}${iso}Z${FILE_SUFFIX}`;
}

// Data (AAAA-MM-DD) e hora em São Paulo.
function spClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// ---------- SQL ----------
const qid = (name) => `\`${String(name).replace(/`/g, '``')}\``;
const pad = (n, w = 2) => String(n).padStart(w, '0');
function sqlDate(d) {
  if (Number.isNaN(d.getTime())) return 'NULL';
  return `'${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}'`;
}
function sqlString(s) {
  return `'${String(s).replace(/[\0\n\r\b\t\x1a'"\\]/g, (c) => ({
    '\0': '\\0', '\n': '\\n', '\r': '\\r', '\b': '\\b', '\t': '\\t', '\x1a': '\\Z', "'": "\\'", '"': '\\"', '\\': '\\\\',
  })[c])}'`;
}
function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (v instanceof Date) return sqlDate(v);
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.from(v).length ? `X'${Buffer.from(v).toString('hex')}'` : "''";
  if (typeof v === 'object' && typeof v.toFixed === 'function' && v.constructor?.name === 'Decimal') return v.toString();
  if (typeof v === 'object') return sqlString(JSON.stringify(v));
  return sqlString(v);
}

const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });

function writeChunk(stream, chunk) {
  if (stream.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (err) => { cleanup(); reject(err); };
    const cleanup = () => { stream.off('drain', onDrain); stream.off('error', onError); };
    stream.on('drain', onDrain);
    stream.on('error', onError);
  });
}

// Dump em Node: escreve SQL em `out` (já com gzip na frente). Lotes pela
// chave primária; tabela sem PK cai em LIMIT/OFFSET (raras e pequenas).
async function dumpWithNode(prisma, out, { chunkRows = 1000, pauseMs = 15, log = () => {} } = {}) {
  const tables = (await prisma.$queryRawUnsafe(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
  )).map((r) => r.name || r.TABLE_NAME);
  await writeChunk(out, `-- Project Club: backup do banco (dump em Node)\n-- Gerado em ${new Date().toISOString()}\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\nSET UNIQUE_CHECKS=0;\nSET time_zone='+00:00';\n\n`);
  let totalRows = 0;
  for (const table of tables) {
    // eslint-disable-next-line no-await-in-loop
    const created = await prisma.$queryRawUnsafe(`SHOW CREATE TABLE ${qid(table)}`);
    const ddl = created?.[0]?.['Create Table'] || Object.values(created?.[0] || {})[1];
    // eslint-disable-next-line no-await-in-loop
    await writeChunk(out, `-- Tabela ${table}\nDROP TABLE IF EXISTS ${qid(table)};\n${ddl};\n`);
    // eslint-disable-next-line no-await-in-loop
    const pkRows = await prisma.$queryRawUnsafe(
      "SELECT COLUMN_NAME AS col FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION",
      table,
    );
    const pk = pkRows.map((r) => r.col || r.COLUMN_NAME);
    let cursor = null;
    let offset = 0;
    let rowsInTable = 0;
    for (;;) {
      let rows;
      if (pk.length) {
        const order = pk.map(qid).join(', ');
        const where = cursor ? `WHERE (${order}) > (${pk.map(() => '?').join(', ')})` : '';
        // eslint-disable-next-line no-await-in-loop
        rows = await prisma.$queryRawUnsafe(`SELECT * FROM ${qid(table)} ${where} ORDER BY ${order} LIMIT ${chunkRows}`, ...(cursor || []));
      } else {
        // eslint-disable-next-line no-await-in-loop
        rows = await prisma.$queryRawUnsafe(`SELECT * FROM ${qid(table)} LIMIT ${chunkRows} OFFSET ${offset}`);
        offset += rows.length;
      }
      if (!rows.length) break;
      const cols = Object.keys(rows[0]);
      const values = rows.map((r) => `(${cols.map((c) => sqlValue(r[c])).join(',')})`).join(',\n');
      // eslint-disable-next-line no-await-in-loop
      await writeChunk(out, `INSERT INTO ${qid(table)} (${cols.map(qid).join(',')}) VALUES\n${values};\n`);
      rowsInTable += rows.length;
      if (pk.length) cursor = pk.map((c) => rows[rows.length - 1][c]);
      if (rows.length < chunkRows) break;
      // eslint-disable-next-line no-await-in-loop
      if (pauseMs) await sleep(pauseMs);
    }
    totalRows += rowsInTable;
    // eslint-disable-next-line no-await-in-loop
    await writeChunk(out, '\n');
    log(`[backup] ${table}: ${rowsInTable} linha(s)`);
  }
  await writeChunk(out, 'SET FOREIGN_KEY_CHECKS=1;\nSET UNIQUE_CHECKS=1;\n');
  return { tables: tables.length, rows: totalRows };
}

let mysqldumpChecked = null;
function hasMysqldump() {
  if (mysqldumpChecked !== null) return mysqldumpChecked;
  try {
    const r = spawnSync('mysqldump', ['--version'], { stdio: 'ignore', timeout: 5000 });
    mysqldumpChecked = r.status === 0;
  } catch { mysqldumpChecked = false; }
  return mysqldumpChecked;
}

function mysqldumpArgs(db, { prismaDir = path.resolve(__dirname, '../../prisma') } = {}) {
  const args = [
    '--single-transaction', '--quick', '--skip-lock-tables', '--no-tablespaces',
    '--default-character-set=utf8mb4', '--hex-blob',
    `--host=${db.host}`, `--port=${db.port}`, `--user=${db.user}`,
  ];
  const resolveCert = (p) => (path.isAbsolute(p) ? p : path.resolve(prismaDir, p));
  if (db.params.sslca) args.push(`--ssl-ca=${resolveCert(db.params.sslca)}`);
  if (db.params.sslcert) args.push(`--ssl-cert=${resolveCert(db.params.sslcert)}`);
  if (db.params.sslkey) args.push(`--ssl-key=${resolveCert(db.params.sslkey)}`);
  args.push(db.database);
  return args;
}

function dumpWithMysqldump(db, out) {
  return new Promise((resolve, reject) => {
    // Senha pela variável MYSQL_PWD: não aparece na lista de processos.
    const child = spawn('mysqldump', mysqldumpArgs(db), { env: { ...process.env, MYSQL_PWD: db.password }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += d.toString(); });
    child.stdout.pipe(out, { end: false });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ tables: null, rows: null });
      else reject(new Error(`mysqldump saiu com código ${code}: ${stderr.trim().slice(0, 500)}`));
    });
  });
}

// ---------- Destinos ----------
let s3ClientCache = null;
function getS3Client(s3) {
  const key = `${s3.endpoint}|${s3.region}|${s3.accessKeyId}`;
  if (s3ClientCache?.key === key) return s3ClientCache.client;
  const { S3Client } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    endpoint: s3.endpoint, region: s3.region, forcePathStyle: true,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  s3ClientCache = { key, client };
  return client;
}

// Conta os bytes que passam (tamanho final do .gz).
function byteCounter() {
  const t = new Transform({ transform(chunk, _enc, cb) { t.bytes += chunk.length; cb(null, chunk); } });
  t.bytes = 0;
  return t;
}

function openLocalDestination(dir, fileName) {
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, fileName);
  const tmpPath = `${finalPath}.partial`;
  const file = fs.createWriteStream(tmpPath, { mode: 0o600 });
  const finished = new Promise((resolve, reject) => { file.on('finish', resolve); file.on('error', reject); });
  return {
    sink: file,
    async done() { await finished; fs.renameSync(tmpPath, finalPath); return { location: finalPath }; },
    async abort() { try { file.destroy(); } catch { /* ok */ } try { fs.unlinkSync(tmpPath); } catch { /* ok */ } },
  };
}

function openS3Destination(s3, fileName, { client = getS3Client(s3) } = {}) {
  const { Upload } = require('@aws-sdk/lib-storage');
  const body = new PassThrough();
  const key = `${s3.prefix}${fileName}`;
  const upload = new Upload({
    client, queueSize: 2, partSize: 8 * 1024 * 1024, leavePartsOnError: false,
    params: { Bucket: s3.bucket, Key: key, Body: body, ContentType: 'application/gzip' },
  });
  const finished = upload.done();
  finished.catch(() => {}); // tratado em done()
  return {
    sink: body,
    async done() { await finished; return { location: `s3://${s3.bucket}/${key}` }; },
    async abort() { try { await upload.abort(); } catch { /* ok */ } try { body.destroy(); } catch { /* ok */ } },
  };
}

// ---------- Rotação ----------
function pickToDelete(names, keep) {
  const sorted = names.filter((n) => FILE_RE.test(n)).sort().reverse(); // nome tem a data → ordem = cronológica
  return sorted.slice(keep);
}

function rotateLocal(dir, keep, { fsImpl = fs } = {}) {
  let names = [];
  try { names = fsImpl.readdirSync(dir); } catch { return []; }
  const del = pickToDelete(names, keep);
  for (const n of del) { try { fsImpl.unlinkSync(path.join(dir, n)); } catch { /* ok */ } }
  // .partial esquecido de uma execução que morreu no meio.
  for (const n of names) {
    if (!n.endsWith('.partial')) continue;
    try {
      const st = fsImpl.statSync(path.join(dir, n));
      if (Date.now() - st.mtimeMs > STALE_RUNNING_MS) fsImpl.unlinkSync(path.join(dir, n));
    } catch { /* ok */ }
  }
  return del;
}

async function rotateS3(s3, keep, { client = getS3Client(s3) } = {}) {
  const { ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const names = [];
  let token;
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await client.send(new ListObjectsV2Command({ Bucket: s3.bucket, Prefix: s3.prefix, ContinuationToken: token }));
    for (const o of page.Contents || []) names.push(o.Key.slice(s3.prefix.length));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  const del = pickToDelete(names, keep);
  for (const n of del) {
    // eslint-disable-next-line no-await-in-loop
    await client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: `${s3.prefix}${n}` })).catch(() => null);
  }
  return del;
}

// ---------- Lock ----------
const RELEASE_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
let localRunning = false;

function getRedis() {
  try {
    const { redis } = require('../config/redis');
    return redis && redis.status === 'ready' ? redis : null;
  } catch { return null; }
}

async function acquireLock(redis, token, ttl = LOCK_TTL_SECONDS) {
  if (localRunning) return false;
  if (redis) {
    try {
      const ok = await redis.set(LOCK_KEY, token, 'EX', ttl, 'NX');
      if (ok !== 'OK') return false;
    } catch { /* Redis instável: segue só com o flag local (hoje é uma instância) */ }
  }
  localRunning = true;
  return true;
}

async function releaseLock(redis, token) {
  localRunning = false;
  if (!redis) return;
  try { await redis.eval(RELEASE_LUA, 1, LOCK_KEY, token); } catch { /* expira sozinho */ }
}

// ---------- Execução ----------
function getPrismaDefault() { return require('../config/prisma'); }

async function alertStaff(io, prisma, title, body) {
  try {
    const staff = await prisma.user.findMany({ where: { platformRole: { in: ['ADMIN', 'MODERATOR'] } }, select: { id: true } });
    const { createNotice } = require('./notices');
    for (const s of staff) {
      // eslint-disable-next-line no-await-in-loop
      await createNotice(io, s.id, { kind: 'BACKUP', title, body, link: '/admin?tab=painelSaude' });
    }
  } catch { /* aviso é best-effort */ }
}

async function runOnce(method, { prisma, cfg, fileName, openDestination, db, log }) {
  const dest = openDestination(fileName);
  const gzip = zlib.createGzip({ level: 6 });
  const counter = byteCounter();
  gzip.pipe(counter).pipe(dest.sink);
  try {
    const stats = method === 'mysqldump'
      ? await dumpWithMysqldump(db, gzip)
      : await dumpWithNode(prisma, gzip, { chunkRows: cfg.chunkRows, pauseMs: cfg.pauseMs, log });
    gzip.end();
    const { location } = await dest.done();
    return { ...stats, location, sizeBytes: counter.bytes };
  } catch (err) {
    try { gzip.destroy(); } catch { /* ok */ }
    await dest.abort();
    throw err;
  }
}

// Faz o backup. Nunca roda dois ao mesmo tempo (lock). Devolve o registro.
async function runBackup({
  trigger = 'MANUAL', userId = null, io = null,
  prisma = getPrismaDefault(), redis = getRedis(), env = process.env, now = new Date(),
  log = (m) => console.log(m), openDestination: openDest = null, methods = null,
} = {}) {
  const cfg = getConfig(env);
  const token = crypto.randomUUID();
  if (!(await acquireLock(redis, token))) {
    const e = new Error('Já tem um backup rodando agora.');
    e.status = 409;
    throw e;
  }
  let record = null;
  try {
    const fileName = fileNameFor(now);
    record = await prisma.dbBackup.create({
      data: { status: 'RUNNING', trigger, startedBy: userId, fileName, location: cfg.s3 ? `s3://${cfg.s3.bucket}/${cfg.s3.prefix}` : cfg.dir },
    });
    const db = parseDatabaseUrl(env.DATABASE_URL);
    const openDestination = openDest || ((name) => (cfg.s3 ? openS3Destination(cfg.s3, name) : openLocalDestination(cfg.dir, name)));
    const order = methods || [
      ...(cfg.useMysqldump && db && hasMysqldump() ? ['mysqldump'] : []),
      'node',
    ];
    let result = null;
    let usedMethod = null;
    const errors = [];
    for (const method of order) {
      try {
        log(`[backup] começando (${method}) → ${cfg.s3 ? 'S3' : cfg.dir}`);
        // eslint-disable-next-line no-await-in-loop
        result = await runOnce(method, { prisma, cfg, fileName, openDestination, db, log });
        usedMethod = method;
        break;
      } catch (err) {
        errors.push(`${method}: ${err?.message || err}`);
        log(`[backup] ${method} falhou: ${err?.message || err}`);
      }
    }
    if (!result) throw new Error(errors.join(' | ') || 'backup falhou');

    let rotated = [];
    try {
      rotated = cfg.s3 ? await rotateS3(cfg.s3, cfg.keep) : rotateLocal(cfg.dir, cfg.keep);
    } catch (err) { log(`[backup] rotação falhou: ${err?.message || err}`); }

    record = await prisma.dbBackup.update({
      where: { id: record.id },
      data: {
        status: 'OK', method: usedMethod, location: result.location, finishedAt: new Date(),
        sizeBytes: BigInt(result.sizeBytes || 0),
        tables: result.tables ?? null, rows: result.rows != null ? BigInt(result.rows) : null,
      },
    });
    log(`[backup] ok: ${result.location} (${Math.round((result.sizeBytes || 0) / 1024)} KB, ${rotated.length} antigo(s) apagado(s))`);
    return shapeBackup(record);
  } catch (err) {
    const message = err?.message || String(err);
    if (record) {
      record = await prisma.dbBackup.update({ where: { id: record.id }, data: { status: 'FAILED', error: message.slice(0, 4000), finishedAt: new Date() } }).catch(() => record);
    }
    try {
      require('./errorLog').persistError({ source: 'server', message: `Backup do banco falhou: ${message}`, stack: err?.stack });
    } catch { /* ok */ }
    await alertStaff(io, prisma, 'Backup do banco falhou', message.slice(0, 300));
    if (err.status) throw err;
    const e = new Error(`Backup falhou: ${message}`);
    e.status = 500;
    e.record = record ? shapeBackup(record) : null;
    throw e;
  } finally {
    await releaseLock(redis, token);
  }
}

function shapeBackup(r) {
  if (!r) return null;
  return {
    id: r.id, status: r.status, trigger: r.trigger, method: r.method, location: r.location, fileName: r.fileName,
    sizeBytes: r.sizeBytes != null ? Number(r.sizeBytes) : null,
    tables: r.tables ?? null, rows: r.rows != null ? Number(r.rows) : null,
    error: r.error || null, startedAt: r.startedAt, finishedAt: r.finishedAt,
    durationMs: r.finishedAt && r.startedAt ? new Date(r.finishedAt) - new Date(r.startedAt) : null,
  };
}

async function getStatus({ prisma = getPrismaDefault(), env = process.env, now = Date.now() } = {}) {
  const cfg = getConfig(env);
  if (!prisma.dbBackup) return { config: publicConfig(cfg), recent: [], lastOk: null, running: false };
  // Registro "RUNNING" de um processo que morreu no meio vira falha.
  await prisma.dbBackup.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: new Date(now - STALE_RUNNING_MS) } },
    data: { status: 'FAILED', error: 'Interrompido (o servidor reiniciou no meio do backup).', finishedAt: new Date(now) },
  }).catch(() => null);
  const [recent, lastOk] = await Promise.all([
    prisma.dbBackup.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
    prisma.dbBackup.findFirst({ where: { status: 'OK' }, orderBy: { startedAt: 'desc' } }),
  ]);
  return {
    config: publicConfig(cfg),
    running: recent.some((r) => r.status === 'RUNNING'),
    lastOk: shapeBackup(lastOk),
    recent: recent.map(shapeBackup),
  };
}

function publicConfig(cfg) {
  return {
    enabled: cfg.enabled, hour: cfg.hour, keep: cfg.keep,
    destination: cfg.s3 ? 's3' : 'disk',
    target: cfg.s3 ? `${cfg.s3.bucket}/${cfg.s3.prefix}` : cfg.dir,
    s3Misconfigured: cfg.s3Misconfigured,
    mysqldump: cfg.useMysqldump && hasMysqldump(),
  };
}

// ---------- Agendador diário ----------
let timer = null;
const memDays = new Set();
async function claimDay(day, redis) {
  if (memDays.has(day)) return false;
  if (redis) {
    try {
      const ok = await redis.set(`backup:day:${day}`, '1', 'EX', 26 * 3600, 'NX');
      if (ok !== 'OK') { memDays.add(day); return false; }
    } catch { /* sem Redis: vale a memória + banco */ }
  }
  memDays.add(day);
  return true;
}

async function tick(io, { prisma = getPrismaDefault(), env = process.env, now = new Date() } = {}) {
  const cfg = getConfig(env);
  if (!cfg.enabled || !prisma.dbBackup) return { skipped: 'disabled' };
  const { day, hour } = spClock(now);
  if (hour !== cfg.hour) return { skipped: 'hour' };
  // Já teve backup OK hoje (ex.: alguém apertou o botão, ou reinício)?
  const since = new Date(now.getTime() - 20 * 3600 * 1000);
  const done = await prisma.dbBackup.findFirst({ where: { status: 'OK', startedAt: { gte: since } }, select: { id: true } }).catch(() => null);
  if (done) return { skipped: 'done' };
  if (!(await claimDay(day, getRedis()))) return { skipped: 'claimed' };
  return runBackup({ trigger: 'SCHEDULE', io, prisma, env, now })
    .catch((err) => { console.error('[backup] agendado falhou:', err?.message || err); return { failed: true }; });
}

function startBackupScheduler(io) {
  if (timer) return timer;
  const cfg = getConfig();
  if (!cfg.enabled) { console.log('[backup] automático desligado (BACKUP_ENABLED)'); return null; }
  if (cfg.s3Misconfigured) console.warn('[backup] BACKUP_S3_BUCKET definido sem credenciais — gravando em disco.');
  if (!cfg.s3) console.warn(`[backup] sem S3 configurado: os backups vão para ${cfg.dir} (o disco some a cada deploy).`);
  const run = () => tick(io).catch((e) => console.error('[backup]', e?.message || e));
  setTimeout(run, 60 * 1000).unref?.();
  timer = setInterval(run, TICK_MS);
  timer.unref?.();
  return timer;
}

function _resetForTests() { localRunning = false; memDays.clear(); mysqldumpChecked = null; }

module.exports = {
  getConfig, parseDatabaseUrl, fileNameFor, spClock, sqlValue, sqlString, qid,
  dumpWithNode, mysqldumpArgs, hasMysqldump, pickToDelete, rotateLocal, rotateS3,
  acquireLock, releaseLock, runBackup, getStatus, shapeBackup, tick, startBackupScheduler,
  openLocalDestination, LOCK_KEY, FILE_RE,
  _resetForTests,
};
