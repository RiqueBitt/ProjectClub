// Backup criptografado (BACKUP_ENCRYPTION_KEY): vai ao S3 só criptografado,
// abre de volta igualzinho com a chave certa e falha com a errada.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const backup = require('../src/services/dbBackup');

const KEY_HEX = crypto.randomBytes(32).toString('hex');
const S3 = { BACKUP_S3_BUCKET: 'b', B2_KEY_ID: 'k', B2_APPLICATION_KEY: 's', B2_ENDPOINT: 'https://x' };

test('chave: aceita 32 bytes em hex ou base64, recusa o resto', () => {
  assert.equal(backup.parseEncryptionKey(KEY_HEX).length, 32);
  assert.equal(backup.parseEncryptionKey(crypto.randomBytes(32).toString('base64')).length, 32);
  assert.equal(backup.parseEncryptionKey('curta'), null);
  assert.equal(backup.parseEncryptionKey(''), null);
});

test('S3 sem chave não recebe backup aberto (vai para o disco)', () => {
  const c = backup.getConfig({ ...S3 });
  assert.equal(c.s3, null);
  assert.equal(c.s3NeedsKey, true);
  const ok = backup.getConfig({ ...S3, BACKUP_ENCRYPTION_KEY: KEY_HEX });
  assert.ok(ok.s3);
  assert.equal(ok.s3NeedsKey, false);
  const priv = backup.getConfig({ ...S3, BACKUP_S3_PRIVATE: '1' });
  assert.ok(priv.s3);
});

test('nome do arquivo: .enc quando criptografado e a rotação reconhece os dois', () => {
  const d = new Date(Date.UTC(2026, 10, 2, 7, 0, 0));
  const enc = backup.fileNameFor(d, { encrypted: true });
  assert.match(enc, /\.sql\.gz\.enc$/);
  assert.ok(backup.FILE_RE.test(enc));
  assert.ok(backup.FILE_RE.test(backup.fileNameFor(d)));
});

test('criptografa em fluxo e abre igual com a chave certa', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbk-'));
  const key = backup.parseEncryptionKey(KEY_HEX);
  const sql = `-- teste\n${'INSERT INTO t VALUES (1,\'olá\');\n'.repeat(5000)}`;
  const enc = path.join(dir, 'a.sql.gz.enc');
  await pipeline(Readable.from([Buffer.from(sql)]), zlib.createGzip(), backup.encryptStream(key), fs.createWriteStream(enc));
  const raw = fs.readFileSync(enc);
  assert.ok(raw.subarray(0, 6).equals(Buffer.from('PCBK1\n')));
  assert.equal(raw.includes(Buffer.from('INSERT')), false);
  const out = path.join(dir, 'a.sql.gz');
  await backup.decryptFile(enc, out, key);
  assert.equal(zlib.gunzipSync(fs.readFileSync(out)).toString(), sql);

  await assert.rejects(backup.decryptFile(enc, path.join(dir, 'b.sql.gz'), crypto.randomBytes(32)));
  raw[raw.length - 40] ^= 1; // um bit alterado
  fs.writeFileSync(enc, raw);
  await assert.rejects(backup.decryptFile(enc, path.join(dir, 'c.sql.gz'), key));
});

test('backup completo com chave grava o .enc e abre de volta', async () => {
  backup._resetForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbk-run-'));
  const rows = [];
  const prisma = {
    dbBackup: {
      create: async ({ data }) => { const r = { id: 'b1', startedAt: new Date(), ...data }; rows.push(r); return r; },
      update: async ({ data }) => Object.assign(rows[0], data),
    },
    async $queryRawUnsafe(sql) {
      if (sql.includes('information_schema.TABLES')) return [{ name: 'User' }];
      if (sql.startsWith('SHOW CREATE')) return [{ Table: 'User', 'Create Table': 'CREATE TABLE `User` (`id` int)' }];
      if (sql.includes('KEY_COLUMN_USAGE')) return [{ col: 'id' }];
      if (sql.includes('WHERE')) return [];
      return [{ id: 1, name: 'Ana' }, { id: 2, name: 'Bia' }];
    },
  };
  const env = { BACKUP_DIR: dir, BACKUP_ENCRYPTION_KEY: KEY_HEX, BACKUP_PAUSE_MS: '0' };
  const r = await backup.runBackup({ prisma, redis: null, env, log: () => {}, methods: ['node'] });
  assert.equal(r.status, 'OK');
  assert.match(r.fileName, /\.sql\.gz\.enc$/);
  const enc = path.join(dir, r.fileName);
  assert.equal(fs.readFileSync(enc).includes(Buffer.from('Ana')), false);
  const out = path.join(dir, 'aberto.sql.gz');
  await backup.decryptFile(enc, out, backup.parseEncryptionKey(KEY_HEX));
  const sql = zlib.gunzipSync(fs.readFileSync(out)).toString();
  assert.match(sql, /INSERT INTO `User`/);
  assert.match(sql, /'Bia'/);
});
