"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalize = normalize;
exports.mediaFileExists = mediaFileExists;
exports.readMediaFile = readMediaFile;
exports.manifestSize = manifestSize;
exports.getMediaState = getMediaState;
exports.ensureMedia = ensureMedia;
/**
 * Mídia do jogo (os ~26 mil SWFs do Waddle Forever) no Project Club.
 *
 * Os arquivos ficam no disco do servidor (MEDIA_DIRECTORY). Na primeira
 * inicialização, se a pasta não estiver completa, o servidor baixa os pacotes
 * .tar da release "waddle-media" do repositório no GitHub (um por pasta:
 * media-default.tar, media-clothing.tar…), extrai e confere pelo manifesto.
 * Depois disso nada mais é baixado: o jogo roda 100% do disco, sem bucket.
 *
 * Variáveis:
 *   WADDLE_MEDIA_DIR      pasta da mídia (padrão server/data/waddle/media). Se
 *                         for apontada pra uma cópia completa, nada é baixado.
 *   WADDLE_MEDIA_RELEASE  base dos pacotes (padrão: a release waddle-media de
 *                         RiqueBitt/ProjectClub). Vazio = não baixa nada.
 *   WADDLE_MEDIA_URL      (opcional, modo antigo) base pública com os arquivos
 *                         soltos, ex. uma pasta num bucket; usado só como
 *                         reserva, arquivo por arquivo, quando definido.
 *
 * O manifesto (server/waddle/media-manifest.json) lista todo arquivo que
 * existe na mídia, pra responder "existe?" sem tocar no disco/rede.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const utils_1 = require("./utils");
const MANIFEST_PATH = path_1.default.resolve(__dirname, '..', '..', 'media-manifest.json');
let manifest = null;
let manifestFiles = [];
function loadManifest() {
    if (manifest !== null)
        return manifest;
    manifest = new Set();
    try {
        const parsed = JSON.parse(fs_1.default.readFileSync(MANIFEST_PATH, 'utf-8'));
        const files = Array.isArray(parsed) ? parsed : parsed.files ?? [];
        manifestFiles = files.map(normalize);
        manifestFiles.forEach((f) => manifest.add(f));
    }
    catch {
        // sem manifesto: só o cache local responde
    }
    return manifest;
}
function normalize(rel) {
    return rel.replaceAll('\\', '/').replace(/^\/+/, '');
}
function mediaBaseUrl() {
    const url = process.env.WADDLE_MEDIA_URL;
    if (!url)
        return null;
    return url.replace(/\/+$/, '');
}
function remoteUrl(rel) {
    const base = mediaBaseUrl();
    if (base === null)
        return null;
    return `${base}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}
function localPath(rel) {
    // impede sair da pasta de mídia ("..", caminhos absolutos)
    const resolved = path_1.default.resolve(utils_1.MEDIA_DIRECTORY, rel);
    if (!resolved.startsWith(path_1.default.resolve(utils_1.MEDIA_DIRECTORY) + path_1.default.sep)) {
        throw new Error(`Caminho de mídia inválido: ${rel}`);
    }
    return resolved;
}
const inflight = new Map();
async function download(rel, url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.status === 404) {
            throw Object.assign(new Error(`Mídia não encontrada no bucket: ${rel}`), { code: 'ENOENT' });
        }
        if (!res.ok) {
            // 403 = limite diário de download da conta B2 ("Caps & Alerts"), 5xx = bucket fora.
            // Não é "não existe": o site NÃO pode responder com a página do React no lugar.
            const detail = (await res.text().catch(() => '')).slice(0, 200);
            throw Object.assign(new Error(`Bucket da mídia respondeu ${res.status} para ${rel}: ${detail}`), { code: 'EMEDIA', status: res.status });
        }
        const buffer = Buffer.from(new Uint8Array(await res.arrayBuffer()));
        const file = localPath(rel);
        await fs_1.default.promises.mkdir(path_1.default.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await fs_1.default.promises.writeFile(tmp, new Uint8Array(buffer));
        await fs_1.default.promises.rename(tmp, file);
        return buffer;
    }
    finally {
        clearTimeout(timer);
    }
}
/** Existe esse arquivo na mídia (no cache ou no bucket)? */
function mediaFileExists(rel) {
    rel = normalize(rel);
    try {
        if (fs_1.default.existsSync(localPath(rel)))
            return true;
    }
    catch {
        return false;
    }
    return mediaBaseUrl() !== null && loadManifest().has(rel);
}
/** Lê um arquivo da mídia (cache local → bucket). Rejeita com code ENOENT se não existir. */
async function readMediaFile(rel) {
    rel = normalize(rel);
    const file = localPath(rel);
    try {
        return await fs_1.default.promises.readFile(file);
    }
    catch (err) {
        if (err?.code !== 'ENOENT')
            throw err;
    }
    const url = remoteUrl(rel);
    if (url === null || !loadManifest().has(rel)) {
        throw Object.assign(new Error(`Mídia não encontrada: ${rel}`), { code: 'ENOENT' });
    }
    const pending = inflight.get(rel);
    if (pending !== undefined)
        return pending;
    const task = download(rel, url).finally(() => inflight.delete(rel));
    inflight.set(rel, task);
    return task;
}
/** Quantos arquivos o manifesto conhece (0 = manifesto ausente). */
function manifestSize() {
    return loadManifest().size;
}
// ---------------------------------------------------------------------------
// Pacotes da release do GitHub (primeira inicialização)
const DEFAULT_RELEASE = 'https://github.com/RiqueBitt/ProjectClub/releases/download/waddle-media';
const COMPLETE_MARK = '.complete.json';
let mediaState = { state: 'checking' };
let preparing = null;
function getMediaState() {
    return mediaState;
}
function releaseBase() {
    const v = process.env.WADDLE_MEDIA_RELEASE;
    if (v === undefined)
        return DEFAULT_RELEASE;
    return v.trim() === '' ? null : v.replace(/\/+$/, '');
}
/** Quantos arquivos do manifesto não estão no disco (amostra completa). */
function countMissing() {
    loadManifest();
    let missing = 0;
    for (const f of manifestFiles) {
        try {
            if (!fs_1.default.existsSync(localPath(f)))
                missing++;
        }
        catch {
            missing++;
        }
    }
    return missing;
}
function topFolders() {
    loadManifest();
    return [...new Set(manifestFiles.map((f) => f.split('/')[0]))].sort();
}
async function downloadToFile(url, dest, onProgress) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || res.body === null) {
        throw new Error(`HTTP ${res.status} ao baixar ${url}`);
    }
    const total = Number(res.headers.get('content-length') || 0);
    let done = 0;
    await fs_1.default.promises.mkdir(path_1.default.dirname(dest), { recursive: true });
    const out = fs_1.default.createWriteStream(dest);
    const reader = res.body.getReader();
    try {
        for (;;) {
            const { value, done: finished } = await reader.read();
            if (finished)
                break;
            if (!out.write(value))
                await new Promise((r) => out.once('drain', r));
            done += value.length;
            if (total > 0)
                onProgress(done / total);
        }
    }
    finally {
        await new Promise((resolve, reject) => { out.end(); out.on('finish', () => resolve()); out.on('error', reject); });
    }
}
function extractTar(file, into) {
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)('tar', ['xf', file, '-C', into], { stdio: ['ignore', 'ignore', 'pipe'] });
        let err = '';
        child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar saiu com ${code}: ${err.slice(0, 300)}`))));
    });
}
/**
 * Garante a mídia no disco. Se já estiver completa (marca + contagem), volta
 * na hora; senão baixa da release os pacotes das pastas que faltam. Nunca
 * rejeita: devolve o estado (ready | partial | error) pra quem chamou decidir.
 */
function ensureMedia(log = () => { }) {
    if (preparing)
        return preparing;
    preparing = (async () => {
        loadManifest();
        const total = manifestFiles.length;
        if (total === 0) {
            mediaState = { state: 'error', error: 'manifesto da mídia ausente' };
            return mediaState;
        }
        await fs_1.default.promises.mkdir(utils_1.MEDIA_DIRECTORY, { recursive: true });
        const mark = path_1.default.join(utils_1.MEDIA_DIRECTORY, COMPLETE_MARK);
        let missing = countMissing();
        if (missing === 0) {
            mediaState = { state: 'ready' };
            try {
                await fs_1.default.promises.writeFile(mark, JSON.stringify({ count: total, at: new Date().toISOString() }));
            }
            catch { /* ignora */ }
            return mediaState;
        }
        const base = releaseBase();
        if (base === null) {
            mediaState = { state: 'partial', missing };
            log(`mídia incompleta (${missing} arquivos faltando) e WADDLE_MEDIA_RELEASE vazio: não vou baixar nada`);
            return mediaState;
        }
        // baixa só as pastas com arquivo faltando
        const folders = topFolders().filter((d) => manifestFiles.some((f) => {
            if (!f.startsWith(`${d}/`))
                return false;
            try {
                return !fs_1.default.existsSync(localPath(f));
            }
            catch {
                return true;
            }
        }));
        const tmpDir = path_1.default.join(utils_1.MEDIA_DIRECTORY, '.tmp');
        await fs_1.default.promises.mkdir(tmpDir, { recursive: true });
        try {
            for (const folder of folders) {
                const name = `media-${folder}.tar`;
                const url = `${base}/${name}`;
                const tmp = path_1.default.join(tmpDir, name);
                log(`baixando ${name} (${missing} arquivos faltando)`);
                mediaState = { state: 'downloading', current: folder, progress: 0, missing };
                let lastShown = 0;
                await downloadToFile(url, tmp, (p) => {
                    mediaState = { state: 'downloading', current: folder, progress: p, missing };
                    if (p - lastShown >= 0.25) {
                        lastShown = p;
                        log(`${name}: ${Math.round(p * 100)}%`);
                    }
                });
                mediaState = { state: 'extracting', current: folder, missing };
                log(`extraindo ${name}`);
                await extractTar(tmp, utils_1.MEDIA_DIRECTORY);
                await fs_1.default.promises.unlink(tmp).catch(() => undefined);
                missing = countMissing();
            }
        }
        catch (err) {
            mediaState = { state: missing === total ? 'error' : 'partial', missing, error: err?.message || String(err) };
            log(`falha ao preparar a mídia: ${mediaState.error}`);
            return mediaState;
        }
        finally {
            await fs_1.default.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
        }
        if (missing === 0) {
            mediaState = { state: 'ready' };
            try {
                await fs_1.default.promises.writeFile(mark, JSON.stringify({ count: total, at: new Date().toISOString() }));
            }
            catch { /* ignora */ }
            log(`mídia completa: ${total} arquivos em ${utils_1.MEDIA_DIRECTORY}`);
        }
        else {
            mediaState = { state: 'partial', missing };
            log(`mídia ainda incompleta: faltam ${missing} arquivos`);
        }
        return mediaState;
    })();
    return preparing;
}
