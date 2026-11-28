// Compressão de fotos no aparelho antes do upload (anexos do chat).
//
// Foto grande (mais de ~2 MB ou lado maior que 2560px) é redimensionada pra
// no máximo 2560px e recodificada em WebP (ou JPEG, onde o navegador não
// gera WebP) com qualidade ~0,85 — fica bem menor, sobe muito mais rápido no
// 4G e quase não muda pra quem vê. Ficam de fora: GIF, WebP animado, tipos
// que não são foto e quando a pessoa marca "Enviar original" na bandeja.
// Se o resultado não ficar menor, manda o original.

export const COMPRESS_MIN_BYTES = 2 * 1024 * 1024;
export const COMPRESS_MAX_SIDE = 2560;
export const COMPRESS_QUALITY = 0.85;
const COMPRESSIBLE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

// O tipo dá pra comprimir? (GIF e o que não é foto: não.)
export function isCompressibleType(type) {
  return COMPRESSIBLE.has(String(type || '').toLowerCase());
}

// WebP animado tem o bloco "ANIM" no cabeçalho RIFF/WEBP (VP8X com o bit de
// animação). `bytes`: os primeiros bytes do arquivo (Uint8Array).
export function isAnimatedWebP(bytes) {
  if (!bytes || bytes.length < 21) return false;
  const str = (from, len) => String.fromCharCode(...bytes.subarray(from, from + len));
  if (str(0, 4) !== 'RIFF' || str(8, 4) !== 'WEBP') return false;
  // Só o formato estendido (VP8X) pode ter animação; o bit 1 do byte de
  // flags (logo depois do tamanho do bloco) diz se tem.
  return str(12, 4) === 'VP8X' && (bytes[20] & 0x02) !== 0;
}

// Decide o que fazer com uma foto: null = manda como está; senão o tamanho
// final e o formato. Puro (testável): só olha tipo, tamanho e dimensões.
export function planImageResize({ type, size, width, height }, { canWebp = true, maxSide = COMPRESS_MAX_SIDE, minBytes = COMPRESS_MIN_BYTES } = {}) {
  if (!isCompressibleType(type) || !width || !height) return null;
  const longest = Math.max(width, height);
  if (size <= minBytes && longest <= maxSide) return null;
  const scale = longest > maxSide ? maxSide / longest : 1;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const src = String(type).toLowerCase();
  let mime;
  if (canWebp) mime = 'image/webp';
  else if (src === 'image/png') mime = scale < 1 ? 'image/png' : null; // sem WebP, PNG só encolhe (não perde transparência)
  else mime = 'image/jpeg';
  if (!mime) return null;
  return { width: w, height: h, mime, quality: mime === 'image/png' ? undefined : COMPRESS_QUALITY };
}

export function renameForMime(name, mime) {
  const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[mime] || 'bin';
  const base = String(name || 'imagem').replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'imagem';
  return `${base}.${ext}`;
}

let webpSupport = null;
function canEncodeWebp() {
  if (webpSupport !== null) return webpSupport;
  try {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    webpSupport = c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch { webpSupport = false; }
  return webpSupport;
}

async function encode(bitmap, plan) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const oc = new OffscreenCanvas(plan.width, plan.height);
      const ctx = oc.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);
      return await oc.convertToBlob({ type: plan.mime, quality: plan.quality });
    } catch { /* cai pro canvas comum */ }
  }
  const c = document.createElement('canvas');
  c.width = plan.width; c.height = plan.height;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);
  return new Promise((resolve) => { c.toBlob((b) => resolve(b), plan.mime, plan.quality); });
}

// Comprime um File de foto. Devolve { file, saved } — `file` é o novo
// (menor) ou null quando não vale a pena / não deu (aí manda o original).
export async function compressImageFile(file) {
  try {
    if (!file || !isCompressibleType(file.type) || typeof createImageBitmap === 'undefined') return { file: null, saved: 0 };
    if (file.type === 'image/webp') {
      const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
      if (isAnimatedWebP(head)) return { file: null, saved: 0 };
    }
    // Respeita a rotação do EXIF (foto de celular "deitada").
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
    try {
      const plan = planImageResize({ type: file.type, size: file.size, width: bitmap.width, height: bitmap.height }, { canWebp: canEncodeWebp() });
      if (!plan) return { file: null, saved: 0 };
      const blob = await encode(bitmap, plan);
      if (!blob || blob.size >= file.size) return { file: null, saved: 0 };
      const out = new File([blob], renameForMime(file.name, plan.mime), { type: plan.mime, lastModified: Date.now() });
      return { file: out, saved: file.size - out.size };
    } finally {
      bitmap.close?.();
    }
  } catch {
    return { file: null, saved: 0 };
  }
}
