// Mini-Jogos — versões e "patches" dos jogos (ver public/minigames/README.md).
//
// public/minigames/manifest.json diz a versão de cada jogo. A versão vai na
// URL do jogo (?v=...) pra furar o cache quando um jogo é atualizado, e o
// manifest é lido sem cache (no-cache) a cada sessão — dá pra publicar uma
// correção de jogo sem recompilar o app.
//
// Patches: scripts pequenos (mesma origem) injetados no jogo depois que ele
// carrega, pra corrigir/ajustar sem mexer nos arquivos originais. Vêm de
//   - manifest.json → games.<slug>.patches: ["patch.js", ...]
//   - catalog.js    → { slug, patches: ['patch.js'] }
// Caminhos relativos à pasta do jogo (/minigames/<slug>/ ou
// /minigames/flash/<slug>/). Cada patch roda na janela onde o jogo vive
// (Game.html nos jogos HTML5, player.html nos jogos em Flash) e encontra
// window.__pcPatch = { slug, version, dir } antes de rodar.

const MANIFEST_URL = '/minigames/manifest.json';
let cached = null;

export function loadMinigamesManifest({ timeoutMs = 2500 } = {}) {
  if (cached) return cached;
  const fetching = fetch(MANIFEST_URL, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => (m && typeof m === 'object' && m.games ? m : { games: {} }))
    .catch(() => ({ games: {} }));
  // Rede lenta/offline: não segura o jogo esperando o manifest.
  const timeout = new Promise((resolve) => { setTimeout(() => resolve({ games: {} }), timeoutMs); });
  cached = Promise.race([fetching, timeout]);
  // Se só deu tempo do fallback, a próxima abertura tenta de novo.
  cached.then((m) => { if (!Object.keys(m.games).length) cached = null; });
  return cached;
}

const SAFE_VERSION = /^[\w.-]{1,40}$/;
const SAFE_PATCH = /^[\w\-/.]+\.js$/;

export function gameDir(game) {
  return game.flash ? `/minigames/flash/${game.slug}/` : `/minigames/${game.slug}/`;
}

export function gameInfoFrom(manifest, game) {
  const entry = manifest?.games?.[game.slug] || {};
  const version = SAFE_VERSION.test(String(entry.version || '')) ? String(entry.version) : String(game.version || '1');
  const patches = [...(Array.isArray(game.patches) ? game.patches : []), ...(Array.isArray(entry.patches) ? entry.patches : [])]
    .filter((p, i, a) => typeof p === 'string' && SAFE_PATCH.test(p) && !p.includes('..') && !p.startsWith('/') && a.indexOf(p) === i);
  return { version, patches };
}

export function withVersion(path, version) {
  if (!version) return path;
  return `${path}${path.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
}

// Injeta os patches na janela do jogo (mesma origem). Só uma vez por janela.
export function injectPatches(win, game, info) {
  if (!win || !info?.patches?.length) return;
  try {
    if (win.__pcPatchesInjected) return;
    win.__pcPatchesInjected = true;
    const dir = gameDir(game);
    win.__pcPatch = { slug: game.slug, version: info.version, dir };
    const doc = win.document;
    info.patches.forEach((p) => {
      const s = doc.createElement('script');
      s.src = withVersion(`${dir}${p}`, info.version);
      s.async = false;
      s.dataset.pcPatch = p;
      (doc.body || doc.documentElement).appendChild(s);
    });
  } catch { /* outra origem: ignora */ }
}
