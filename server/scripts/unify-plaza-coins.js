#!/usr/bin/env node
// Moeda única (uma vez só): apaga as moedas próprias do Club Penguin.
//
// Antes, cada pinguim tinha o seu saldo no JSON (WaddlePenguin.data.coins),
// separado das moedas do Project Club (User.coins). Agora o saldo do jogo É o
// da conta (ver src/services/waddle/penguinStore.js). Este script:
//   1. guarda uma cópia dos saldos antigos do jogo (B2: db-backups/, e um
//      arquivo local em tmp/) — por segurança;
//   2. troca o `coins` de cada pinguim pelo saldo do Project Club da conta
//      dona (pinguim sem conta fica com 0).
// As moedas do Project Club não mudam.
//
// Uso: node scripts/unify-plaza-coins.js [--dry-run]
// Rode com o jogo parado ou logo depois de subir (pinguins online gravam de
// novo por cima com o saldo da conta, então o resultado é o mesmo).

const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');

const DRY = process.argv.includes('--dry-run');

async function uploadBackup(name, body) {
  try {
    const { getB2Client, isB2Configured } = require('../src/config/b2');
    const env = require('../src/config/env');
    if (!isB2Configured()) return null;
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const bucket = process.env.BACKUP_S3_BUCKET || env.B2_BUCKET;
    const key = `${process.env.BACKUP_S3_PREFIX || 'db-backups/'}${name}`;
    await getB2Client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'application/json' }));
    return `${bucket}/${key}`;
  } catch (err) {
    console.warn('[moedas] não consegui mandar a cópia pro B2:', err?.message || err);
    return null;
  }
}

async function main() {
  const rows = await prisma.waddlePenguin.findMany({ select: { id: true, userId: true, name: true, data: true } });
  const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, coins: true } }) : [];
  const pcCoins = new Map(users.map((u) => [u.id, u.coins]));

  const backup = [];
  const updates = [];
  for (const r of rows) {
    let json;
    try { json = JSON.parse(r.data); } catch { continue; }
    const old = Number(json.coins) || 0;
    const next = r.userId ? (pcCoins.get(r.userId) ?? 0) : 0;
    backup.push({ id: r.id, userId: r.userId, name: r.name, coins: old });
    if (old !== next) { json.coins = next; updates.push({ id: r.id, data: JSON.stringify(json) }); }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `plaza-coins-before-unify-${stamp}.json`;
  const body = JSON.stringify({ createdAt: new Date().toISOString(), penguins: backup }, null, 1);
  try {
    const dir = path.join(__dirname, '..', '..', 'tmp');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
    console.log(`[moedas] cópia local: tmp/${name}`);
  } catch (err) { console.warn('[moedas] cópia local falhou:', err?.message || err); }
  const remote = await uploadBackup(name, body);
  if (remote) console.log(`[moedas] cópia no B2: ${remote}`);

  const total = backup.reduce((n, b) => n + b.coins, 0);
  console.log(`[moedas] ${rows.length} pinguins, ${total} moedas do Club Penguin no total; ${updates.length} vão mudar.`);
  if (DRY) { console.log('[moedas] --dry-run: nada gravado.'); return; }
  if (!remote) { console.error('[moedas] sem cópia no B2 — parei sem mexer em nada.'); process.exitCode = 1; return; }
  for (const u of updates) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.waddlePenguin.update({ where: { id: u.id }, data: { data: u.data } });
  }
  console.log('[moedas] pronto: o saldo do jogo agora é o do Project Club.');
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect?.());
