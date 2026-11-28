'use strict';
// Aba "Arquivos" do Project Club Dev: os arquivos enviados pelos usuários
// (Backblaze B2, ou a pasta de uploads quando não há B2). Só leitura.
const fs = require('fs');
const path = require('path');
const env = require('../../config/env');
const { getB2Client, isB2Configured } = require('../../config/b2');

async function list(prefix = '', token) {
  const clean = String(prefix || '').replace(/^\/+/, '').replace(/\.\.+/g, '');
  if (isB2Configured()) {
    const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
    const r = await getB2Client().send(new ListObjectsV2Command({
      Bucket: env.B2_BUCKET, Prefix: clean, Delimiter: '/', MaxKeys: 200, ContinuationToken: token || undefined,
    }));
    const base = String(env.B2_PUBLIC_URL || '').replace(/\/+$/, '');
    return {
      source: 'b2',
      prefix: clean,
      folders: (r.CommonPrefixes || []).map((p) => p.Prefix),
      files: (r.Contents || []).filter((o) => o.Key !== clean).map((o) => ({
        key: o.Key, size: o.Size, at: o.LastModified, url: base ? `${base}/${o.Key.split('/').map(encodeURIComponent).join('/')}` : null,
      })),
      next: r.IsTruncated ? r.NextContinuationToken : null,
    };
  }
  const { uploadRoot } = require('../fileStorage');
  const dir = path.join(uploadRoot, clean);
  if (!dir.startsWith(uploadRoot)) return { source: 'local', prefix: '', folders: [], files: [], next: null };
  const items = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  const folders = [];
  for (const it of items.slice(0, 500)) {
    if (it.isDirectory()) folders.push(`${clean}${it.name}/`);
    else {
      const st = await fs.promises.stat(path.join(dir, it.name)).catch(() => null);
      files.push({ key: `${clean}${it.name}`, size: st?.size || 0, at: st?.mtime || null, url: `/uploads/${clean}${encodeURIComponent(it.name)}` });
    }
  }
  return { source: 'local', prefix: clean, folders, files, next: null };
}

module.exports = { list };
