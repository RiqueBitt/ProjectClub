// Baixa um repositório/branch do GitHub e monta o ZIP que a Shard Cloud
// espera (arquivos na RAIZ do zip, com o .shardcloud). Opcionalmente usa só
// uma subpasta (ex.: deploy de `media-server/` ou `shardcloud-mcp/`).
import AdmZip from 'adm-zip';

const IGNORE = [/^\.git\//, /^node_modules\//, /\/node_modules\//, /^\.github\//, /^\.env$/, /\/\.env$/];

export async function downloadRepoZip({ owner, repo, ref = 'main', token = process.env.GITHUB_TOKEN }) {
  const base = globalThis.__GH_BASE || process.env.GITHUB_API_BASE || 'https://api.github.com';
  const url = `${base}/repos/${owner}/${repo}/zipball/${encodeURIComponent(ref)}`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'shardcloud-mcp', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, redirect: 'follow' });
  if (!res.ok) throw new Error(`GitHub ${res.status} ao baixar ${owner}/${repo}@${ref}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

// Reempacota: tira a pasta raiz "owner-repo-sha/", opcionalmente entra em
// `subdir`, ignora lixo e injeta/substitui o .shardcloud e arquivos extras.
export function repackForShard(zipBuffer, { subdir = '', shardcloud, extraFiles = {}, ignore = IGNORE } = {}) {
  const inZip = new AdmZip(zipBuffer);
  const out = new AdmZip();
  const prefix = subdir ? subdir.replace(/^\/+|\/+$/g, '') + '/' : '';
  let count = 0;
  for (const e of inZip.getEntries()) {
    if (e.isDirectory) continue;
    const parts = e.entryName.split('/');
    parts.shift(); // owner-repo-sha/
    let rel = parts.join('/');
    if (!rel) continue;
    if (prefix) { if (!rel.startsWith(prefix)) continue; rel = rel.slice(prefix.length); }
    if (!rel || ignore.some((re) => re.test(rel))) continue;
    out.addFile(rel, e.getData());
    count += 1;
  }
  if (shardcloud) out.addFile('.shardcloud', Buffer.from(typeof shardcloud === 'string' ? shardcloud : renderShardcloud(shardcloud), 'utf8'));
  for (const [name, content] of Object.entries(extraFiles)) out.addFile(name, Buffer.from(content, 'utf8'));
  return { zip: out.toBuffer(), files: count + (shardcloud ? 1 : 0) + Object.keys(extraFiles).length };
}

export function renderShardcloud(cfg) {
  const keys = ['DISPLAY_NAME', 'DESCRIPTION', 'MAIN', 'LANGUAGE', 'MEMORY', 'VERSION', 'SUBDOMAIN', 'CUSTOM_COMMAND'];
  return keys.filter((k) => cfg[k] !== undefined && cfg[k] !== null && cfg[k] !== '').map((k) => `${k}=${cfg[k]}`).join('\n') + '\n';
}
