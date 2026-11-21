#!/usr/bin/env node
// Abre um backup criptografado do banco (projectclub-...sql.gz.enc).
//   BACKUP_ENCRYPTION_KEY=<chave> node scripts/backup-decrypt.js arquivo.sql.gz.enc [saida.sql.gz]
// Depois: gunzip saida.sql.gz && mysql -h HOST -u USER -p BANCO < saida.sql
const path = require('path');
const { parseEncryptionKey, decryptFile } = require('../src/services/dbBackup');

const [inPath, outArg] = process.argv.slice(2);
if (!inPath) {
  console.error('uso: BACKUP_ENCRYPTION_KEY=<chave> node scripts/backup-decrypt.js <arquivo.sql.gz.enc> [saida.sql.gz]');
  process.exit(2);
}
const key = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY);
if (!key) {
  console.error('BACKUP_ENCRYPTION_KEY ausente ou inválida (precisa de 32 bytes em hex ou base64).');
  process.exit(2);
}
const outPath = outArg || inPath.replace(/\.enc$/, '') || `${inPath}.sql.gz`;
decryptFile(path.resolve(inPath), path.resolve(outPath === inPath ? `${inPath}.sql.gz` : outPath), key)
  .then(() => console.log(`ok: ${outPath}`))
  .catch((err) => { console.error(`falhou: ${err.message} (chave errada ou arquivo alterado?)`); process.exit(1); });
