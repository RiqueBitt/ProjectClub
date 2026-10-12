// Cache das releases dos apps do Project Club (aba Apps do app para computador).
//
// O app para computador consultava a API do GitHub direto do PC de cada
// pessoa. Sem login, o GitHub libera só 60 consultas por hora por IP e depois
// responde HTTP 403, e a instalação/atualização dos apps parava. Agora o
// servidor consulta o GitHub (no máximo uma vez a cada 10 minutos por app),
// guarda o resultado e o app pergunta para o servidor.

const OWNER = 'RiqueBitt';
const ALLOWED_REPOS = new Set([
  'ProjectClub', 'ProjectMC', 'PhotoProject', 'HyProject', 'CutProject',
  'WaveProject', 'TexelProject', 'ForgeProject', 'CanvasProject',
]);
const TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // repo -> { at, data }
const inflight = new Map(); // repo -> Promise

function isAllowedRepo(repo) {
  return ALLOWED_REPOS.has(repo);
}

// Só o que o app precisa: tag, data e os arquivos (nome, link e tamanho).
function slim(releases) {
  return (Array.isArray(releases) ? releases : [])
    .filter((r) => !r.draft)
    .map((r) => ({
      tag_name: r.tag_name,
      name: r.name,
      published_at: r.published_at,
      prerelease: !!r.prerelease,
      body: (r.body || '').slice(0, 4000),
      assets: (r.assets || []).map((a) => ({ name: a.name, size: a.size, browser_download_url: a.browser_download_url })),
    }));
}

async function fetchFromGitHub(repo) {
  const headers = { 'User-Agent': 'ProjectClub-Server', Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `https://api.github.com/repos/${OWNER}/${repo}/releases?per_page=100`;
  let res = await fetch(url, { headers });
  if (res.status === 401 && headers.Authorization) {
    // Token inválido/expirado: tenta sem ele (repositórios públicos).
    delete headers.Authorization;
    res = await fetch(url, { headers });
  }
  if (!res.ok) throw new Error(`GitHub respondeu HTTP ${res.status} para ${repo}`);
  return slim(await res.json());
}

async function getReleases(repo) {
  const hit = cache.get(repo);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  if (inflight.has(repo)) return inflight.get(repo);
  const p = fetchFromGitHub(repo)
    .then((data) => { cache.set(repo, { at: Date.now(), data }); return data; })
    .catch((err) => {
      // Se o GitHub falhar (ex.: limite atingido), usa a última cópia boa.
      if (hit) { console.warn(`[apps] ${err.message}; usando a cópia em cache.`); return hit.data; }
      throw err;
    })
    .finally(() => inflight.delete(repo));
  inflight.set(repo, p);
  return p;
}

module.exports = { getReleases, isAllowedRepo };
