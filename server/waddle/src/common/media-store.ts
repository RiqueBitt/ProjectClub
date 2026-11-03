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
import fs from 'fs';
import path from 'path';
import { MEDIA_DIRECTORY } from './utils';

const MANIFEST_PATH = path.resolve(__dirname, '..', '..', 'media-manifest.json');

let manifest: Set<string> | null = null;

function loadManifest(): Set<string> {
  if (manifest !== null) return manifest;
  manifest = new Set<string>();
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    const files: string[] = Array.isArray(parsed) ? parsed : parsed.files ?? [];
    files.forEach((f) => manifest!.add(normalize(f)));
  } catch {
    // sem manifesto: só o cache local responde
  }
  return manifest;
}

export function normalize(rel: string): string {
  return rel.replaceAll('\\', '/').replace(/^\/+/, '');
}

function mediaBaseUrl(): string | null {
  const url = process.env.WADDLE_MEDIA_URL;
  if (!url) return null;
  return url.replace(/\/+$/, '');
}

function remoteUrl(rel: string): string | null {
  const base = mediaBaseUrl();
  if (base === null) return null;
  return `${base}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

function localPath(rel: string): string {
  // impede sair da pasta de mídia ("..", caminhos absolutos)
  const resolved = path.resolve(MEDIA_DIRECTORY, rel);
  if (!resolved.startsWith(path.resolve(MEDIA_DIRECTORY) + path.sep)) {
    throw new Error(`Caminho de mídia inválido: ${rel}`);
  }
  return resolved;
}

const inflight = new Map<string, Promise<Buffer>>();

async function download(rel: string, url: string): Promise<Buffer> {
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
    const buffer: Buffer = Buffer.from(new Uint8Array(await res.arrayBuffer()));
    const file = localPath(rel);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmp, new Uint8Array(buffer));
    await fs.promises.rename(tmp, file);
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

/** Existe esse arquivo na mídia (no cache ou no bucket)? */
export function mediaFileExists(rel: string): boolean {
  rel = normalize(rel);
  try {
    if (fs.existsSync(localPath(rel))) return true;
  } catch {
    return false;
  }
  return mediaBaseUrl() !== null && loadManifest().has(rel);
}

/** Lê um arquivo da mídia (cache local → bucket). Rejeita com code ENOENT se não existir. */
export async function readMediaFile(rel: string): Promise<Buffer> {
  rel = normalize(rel);
  const file = localPath(rel);
  try {
    return await fs.promises.readFile(file);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
  const url = remoteUrl(rel);
  if (url === null || !loadManifest().has(rel)) {
    throw Object.assign(new Error(`Mídia não encontrada: ${rel}`), { code: 'ENOENT' });
  }
  const pending = inflight.get(rel);
  if (pending !== undefined) return pending;
  const task = download(rel, url).finally(() => inflight.delete(rel));
  inflight.set(rel, task);
  return task;
}

/** Quantos arquivos o manifesto conhece (0 = manifesto ausente). */
export function manifestSize(): number {
  return loadManifest().size;
}
