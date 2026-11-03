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
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { MEDIA_DIRECTORY } from './utils';

const MANIFEST_PATH = path.resolve(__dirname, '..', '..', 'media-manifest.json');

let manifest: Set<string> | null = null;
let manifestFiles: string[] = [];

function loadManifest(): Set<string> {
  if (manifest !== null) return manifest;
  manifest = new Set<string>();
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    const files: string[] = Array.isArray(parsed) ? parsed : parsed.files ?? [];
    manifestFiles = files.map(normalize);
    manifestFiles.forEach((f) => manifest!.add(f));
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

// ---------------------------------------------------------------------------
// Pacotes da release do GitHub (primeira inicialização)

const DEFAULT_RELEASE = 'https://github.com/RiqueBitt/ProjectClub/releases/download/waddle-media';
const COMPLETE_MARK = '.complete.json';

export type MediaState = {
  state: 'checking' | 'ready' | 'downloading' | 'extracting' | 'error' | 'partial';
  /** 0..1 enquanto baixa */
  progress?: number;
  /** pacote atual */
  current?: string;
  missing?: number;
  error?: string;
};

let mediaState: MediaState = { state: 'checking' };
let preparing: Promise<MediaState> | null = null;

export function getMediaState(): MediaState {
  return mediaState;
}

function releaseBase(): string | null {
  const v = process.env.WADDLE_MEDIA_RELEASE;
  if (v === undefined) return DEFAULT_RELEASE;
  return v.trim() === '' ? null : v.replace(/\/+$/, '');
}

/** Quantos arquivos do manifesto não estão no disco (amostra completa). */
function countMissing(): number {
  loadManifest();
  let missing = 0;
  for (const f of manifestFiles) {
    try {
      if (!fs.existsSync(localPath(f))) missing++;
    } catch {
      missing++;
    }
  }
  return missing;
}

function topFolders(): string[] {
  loadManifest();
  return [...new Set(manifestFiles.map((f) => f.split('/')[0]))].sort();
}

async function downloadToFile(url: string, dest: string, onProgress: (p: number) => void): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || res.body === null) {
    throw new Error(`HTTP ${res.status} ao baixar ${url}`);
  }
  const total = Number(res.headers.get('content-length') || 0);
  let done = 0;
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', r));
      done += value.length;
      if (total > 0) onProgress(done / total);
    }
  } finally {
    await new Promise<void>((resolve, reject) => { out.end(); out.on('finish', () => resolve()); out.on('error', reject); });
  }
}

function extractTar(file: string, into: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['xf', file, '-C', into], { stdio: ['ignore', 'ignore', 'pipe'] });
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
export function ensureMedia(log: (msg: string) => void = () => {}): Promise<MediaState> {
  if (preparing) return preparing;
  preparing = (async () => {
    loadManifest();
    const total = manifestFiles.length;
    if (total === 0) {
      mediaState = { state: 'error', error: 'manifesto da mídia ausente' };
      return mediaState;
    }
    await fs.promises.mkdir(MEDIA_DIRECTORY, { recursive: true });
    const mark = path.join(MEDIA_DIRECTORY, COMPLETE_MARK);
    let missing = countMissing();
    if (missing === 0) {
      mediaState = { state: 'ready' };
      try { await fs.promises.writeFile(mark, JSON.stringify({ count: total, at: new Date().toISOString() })); } catch { /* ignora */ }
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
      if (!f.startsWith(`${d}/`)) return false;
      try { return !fs.existsSync(localPath(f)); } catch { return true; }
    }));
    const tmpDir = path.join(MEDIA_DIRECTORY, '.tmp');
    await fs.promises.mkdir(tmpDir, { recursive: true });
    try {
      for (const folder of folders) {
        const name = `media-${folder}.tar`;
        const url = `${base}/${name}`;
        const tmp = path.join(tmpDir, name);
        log(`baixando ${name} (${missing} arquivos faltando)`);
        mediaState = { state: 'downloading', current: folder, progress: 0, missing };
        let lastShown = 0;
        await downloadToFile(url, tmp, (p) => {
          mediaState = { state: 'downloading', current: folder, progress: p, missing };
          if (p - lastShown >= 0.25) { lastShown = p; log(`${name}: ${Math.round(p * 100)}%`); }
        });
        mediaState = { state: 'extracting', current: folder, missing };
        log(`extraindo ${name}`);
        await extractTar(tmp, MEDIA_DIRECTORY);
        await fs.promises.unlink(tmp).catch(() => undefined);
        missing = countMissing();
      }
    } catch (err: any) {
      mediaState = { state: missing === total ? 'error' : 'partial', missing, error: err?.message || String(err) };
      log(`falha ao preparar a mídia: ${mediaState.error}`);
      return mediaState;
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (missing === 0) {
      mediaState = { state: 'ready' };
      try { await fs.promises.writeFile(mark, JSON.stringify({ count: total, at: new Date().toISOString() })); } catch { /* ignora */ }
      log(`mídia completa: ${total} arquivos em ${MEDIA_DIRECTORY}`);
    } else {
      mediaState = { state: 'partial', missing };
      log(`mídia ainda incompleta: faltam ${missing} arquivos`);
    }
    return mediaState;
  })();
  return preparing;
}
