// Atualizações do app Android (Capacitor) — ver docs/android-updates.md.
//
// O app Android NÃO embala o site: ele abre https://projectclub.shardweb.app
// direto (server.url em client/capacitor.config.json). Então todo deploy do
// site já chega no celular sozinho, sem .apk novo. Um .apk novo só é
// necessário quando a parte NATIVA muda (plugins do Capacitor, código Java,
// AndroidManifest, ícone etc.).
//
// Cada release do GitHub com o .apk traz também "android-native.json"
// (gerado pelo workflow build-apps.yml), com a impressão digital da parte
// nativa e a menor versão nativa que ainda serve:
//   { "version": "v1.4.0", "nativeHash": "<sha256>", "minNativeVersion": "v1.2.0" }
// Se a parte nativa não mudou entre releases, minNativeVersion continua o
// da release anterior e o app NÃO pede pra baixar outro .apk.

const fs = require('fs');
const path = require('path');

const REPO = 'ProjectClub';
const APK_ASSET = 'ProjectClub.apk';
const NATIVE_MANIFEST_ASSET = 'android-native.json';
const APK_FALLBACK_URL = `https://github.com/RiqueBitt/${REPO}/releases/latest/download/${APK_ASSET}`;
const SEMVER_TAG = /^v?\d+\.\d+\.\d+$/;

// "v1.2.3" / "1.2.3" → [1,2,3]; qualquer outra coisa → null.
function parseVersion(v) {
  const m = String(v || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/i);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// -1 / 0 / 1, ou null quando alguma das duas não é uma versão válida.
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    if (x[i] > y[i]) return 1;
    if (x[i] < y[i]) return -1;
  }
  return 0;
}

// Decisão pura (testada em server/test/mobile-update.test.js).
//   native  — versão nativa instalada (versionName do .apk)
//   current — versão do conteúdo (site) que está rodando no app
//   manifest — { latestNativeVersion, minNativeVersion, apkUrl, notes, webVersion }
function decideUpdate({ native, current, manifest }) {
  const m = manifest || {};
  const webVersion = m.webVersion || null;
  const latestNativeVersion = m.latestNativeVersion || null;
  const minNativeVersion = m.minNativeVersion || null;

  const belowMin = compareVersions(native, minNativeVersion);
  const belowLatest = compareVersions(native, latestNativeVersion);
  // Só exige .apk novo quando a instalada é MAIS VELHA que a mínima. Versão
  // desconhecida/inválida nunca dispara (melhor não incomodar à toa).
  const nativeUpdateRequired = belowMin === -1;
  const nativeUpdateAvailable = belowLatest === -1;

  // Conteúdo: o site é servido ao vivo, então "atualizar" é só recarregar
  // a página. Só sinaliza quando as duas versões são conhecidas e diferentes.
  const webUpdate = !!(current && webVersion && String(current) !== String(webVersion));

  return {
    webVersion,
    webUpdate,
    nativeVersion: native || null,
    latestNativeVersion,
    minNativeVersion,
    nativeUpdateRequired,
    nativeUpdateAvailable,
    apkUrl: nativeUpdateRequired || nativeUpdateAvailable ? (m.apkUrl || APK_FALLBACK_URL) : null,
    notes: nativeUpdateRequired ? (m.notes || '') : '',
  };
}

// Escolhe a release mais nova que de fato tem o .apk (se o build do Android
// falhar numa release, a de PC sai mesmo assim — essa não conta pro celular).
function pickAndroidRelease(releases) {
  return (Array.isArray(releases) ? releases : []).find((r) => (
    !r.prerelease && SEMVER_TAG.test(r.tag_name || '') && (r.assets || []).some((a) => a.name === APK_ASSET)
  )) || null;
}

// Monta o manifesto a partir das releases (já cacheadas pelo appReleases) +
// o android-native.json da release escolhida.
async function buildManifest({ releases, fetchJson, webVersion }) {
  const rel = pickAndroidRelease(releases);
  if (!rel) return { latestNativeVersion: null, minNativeVersion: null, apkUrl: APK_FALLBACK_URL, notes: '', webVersion };
  const apk = rel.assets.find((a) => a.name === APK_ASSET);
  const nativeAsset = (rel.assets || []).find((a) => a.name === NATIVE_MANIFEST_ASSET);
  let minNativeVersion = rel.tag_name; // releases antigas (sem o arquivo): comportamento antigo
  if (nativeAsset) {
    try {
      const data = await fetchJson(nativeAsset.browser_download_url);
      if (data && parseVersion(data.minNativeVersion)) minNativeVersion = data.minNativeVersion;
    } catch { /* sem o arquivo: fica no comportamento antigo (exige a última) */ }
  }
  return {
    latestNativeVersion: rel.tag_name,
    minNativeVersion,
    apkUrl: apk?.browser_download_url || APK_FALLBACK_URL,
    notes: (rel.body || '').trim().slice(0, 2000),
    webVersion,
  };
}

// Versão do conteúdo publicado: client/dist/version.json (gerado pelo
// vite.config.js a cada build). Relido só quando o arquivo muda.
const VERSION_FILE = path.resolve(__dirname, '../../../client/dist/version.json');
let versionCache = { mtimeMs: -1, value: null };
function readWebVersion(file = VERSION_FILE) {
  try {
    const st = fs.statSync(file);
    if (st.mtimeMs !== versionCache.mtimeMs) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      versionCache = { mtimeMs: st.mtimeMs, value: typeof data.web === 'string' ? data.web : null };
    }
    return versionCache.value;
  } catch {
    return null;
  }
}

// O android-native.json de uma tag quase nunca muda (só se alguém editar a
// release à mão pra "desexigir" um .apk): guarda 30 min na memória.
const NATIVE_JSON_TTL_MS = 30 * 60 * 1000;
const nativeJsonCache = new Map(); // url -> { at, data }
async function fetchJsonCached(url) {
  const hit = nativeJsonCache.get(url);
  if (hit && Date.now() - hit.at < NATIVE_JSON_TTL_MS) return hit.data;
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'ProjectClub-Server' } });
  if (!r.ok) {
    if (hit) return hit.data;
    throw new Error(`HTTP ${r.status}`);
  }
  const data = await r.json();
  nativeJsonCache.delete(url);
  nativeJsonCache.set(url, { at: Date.now(), data });
  if (nativeJsonCache.size > 50) nativeJsonCache.delete(nativeJsonCache.keys().next().value);
  return data;
}

async function getManifest({ getReleases, fetchJson = fetchJsonCached, webVersion = readWebVersion() } = {}) {
  const releases = await (getReleases || require('./appReleases').getReleases)(REPO);
  return buildManifest({ releases, fetchJson, webVersion });
}

module.exports = {
  parseVersion,
  compareVersions,
  decideUpdate,
  pickAndroidRelease,
  buildManifest,
  readWebVersion,
  getManifest,
  APK_FALLBACK_URL,
};
