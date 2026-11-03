"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalize = normalize;
exports.mediaFileExists = mediaFileExists;
exports.readMediaFile = readMediaFile;
exports.manifestSize = manifestSize;
/**
 * Mídia do jogo (os ~26 mil SWFs do Waddle Forever) no Project Club.
 *
 * A pasta local (MEDIA_DIRECTORY) funciona como CACHE em disco. O que não
 * estiver nela é baixado uma única vez do bucket público (o mesmo Backblaze
 * B2 que o Project Club já usa pra anexos) e gravado no cache; a partir daí
 * é servido do disco. Assim o repositório fica leve e o servidor da Shard
 * Cloud não depende de nada do GitHub pra rodar.
 *
 * Variáveis:
 *   WADDLE_MEDIA_DIR   pasta do cache (padrão server/data/waddle/media). Se
 *                      for apontada pra uma cópia completa da mídia, nada
 *                      é baixado.
 *   WADDLE_MEDIA_URL   base pública onde a mídia foi publicada, ex.:
 *                      https://f005.backblazeb2.com/file/projectclub-teste/waddle
 *                      (ver scripts/waddle-upload-media.js). Sem ela, só o
 *                      cache local é usado.
 *
 * O manifesto (server/waddle/media-manifest.json) lista todo arquivo que
 * existe na mídia, pra responder "existe?" sem bater no bucket.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const utils_1 = require("./utils");
const MANIFEST_PATH = path_1.default.resolve(__dirname, '..', '..', 'media-manifest.json');
let manifest = null;
function loadManifest() {
    if (manifest !== null)
        return manifest;
    manifest = new Set();
    try {
        const parsed = JSON.parse(fs_1.default.readFileSync(MANIFEST_PATH, 'utf-8'));
        const files = Array.isArray(parsed) ? parsed : parsed.files ?? [];
        files.forEach((f) => manifest.add(normalize(f)));
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
        if (!res.ok) {
            throw Object.assign(new Error(`Mídia não encontrada no bucket (${res.status}): ${rel}`), { code: 'ENOENT' });
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
