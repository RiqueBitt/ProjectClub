// Otimização de imagem no upload (item pedido: "o mais leve possível SEM
// perder qualidade"). Roda dentro do ManagedStorage (middleware/upload.js),
// antes de subir pro B2/disco, então TODA rota de upload passa por aqui
// sem mudar nada nos controllers.
//
// O que faz (só com imagens estáticas PNG/JPEG/WebP, nunca com vídeo/áudio):
// - gira conforme a orientação da câmera (EXIF) e REMOVE os metadados
//   (EXIF/GPS/modelo do celular) — privacidade + bytes;
// - limita o tamanho por tipo de upload (avatar 512, banner 1920 de
//   largura, chat/fotos 2560 no maior lado), sem nunca aumentar;
// - converte pra WebP: JPEG em qualidade 90 (visualmente igual), PNG em
//   modo "quase sem perda" (near-lossless, mantém transparência) ou sem
//   perda nenhuma — o que ficar menor;
// - se o resultado ficar MAIOR que o original (e não havia metadado nem
//   giro/redimensionamento a fazer), mantém o original intacto.
// GIF animado continua GIF (animação, e partes do app reconhecem GIF pela
// extensão — ex.: avatar animado). Nos anexos do chat e no álbum de fotos
// o GIF vira WebP animado só se ficar bem menor (≥20%).
// Se o `sharp` não estiver instalado/carregar (ex.: plataforma sem binário
// pronto), nada muda: o arquivo original sobe como antes.
let sharp = null;
try {
  // eslint-disable-next-line global-require
  sharp = require('sharp');
  // Servidor com pouca memória (Square Cloud 1 GB): sem cache de operações
  // e uma thread de libvips por imagem.
  sharp.cache(false);
  sharp.concurrency(1);
} catch {
  sharp = null;
}

// Tamanho máximo por campo do formulário de upload (nome do campo do multer).
// `side`: maior lado; `width`: só a largura (banners).
const LIMITS = {
  avatar: { side: 512 },
  pendant: { side: 512 },
  emoji: { side: 256 },
  sticker: { side: 512 },
  icon: { side: 512 },
  banner: { width: 1920 },
  idCard: { width: 1920 },
  attachments: { side: 2560 },
  photo: { side: 2560 },
};
const DEFAULT_LIMIT = { side: 2560 };
// Campos onde GIF animado pode virar WebP animado (o app não depende da
// extensão .gif nesses lugares — usa o mimeType salvo do anexo).
const GIF_TO_WEBP_FIELDS = new Set(['attachments', 'photo']);
// Imagens enormes (bomba de descompressão) nem são tocadas.
const MAX_INPUT_PIXELS = 80_000_000;
const TIMEOUT_SECONDS = 20;

function limitFor(field) {
  return LIMITS[field] || DEFAULT_LIMIT;
}

function resizeOptions(meta, limit) {
  const w = meta.width || 0;
  const h = (meta.pageHeight || meta.height) || 0;
  if (limit.width) return w > limit.width ? { width: limit.width, withoutEnlargement: true } : null;
  if (Math.max(w, h) > limit.side) return { width: limit.side, height: limit.side, fit: 'inside', withoutEnlargement: true };
  return null;
}

// PNG animado (APNG): o libvips só lê o 1º quadro — converter mataria a
// animação (decorações/efeitos de perfil podem ser APNG). Fica intacto.
function isApng(buffer) {
  // Chunk "acTL" aparece antes do primeiro IDAT num APNG.
  const idat = buffer.indexOf('IDAT', 8, 'latin1');
  const actl = buffer.indexOf('acTL', 8, 'latin1');
  return actl !== -1 && (idat === -1 || actl < idat);
}

function replaceExt(name, ext) {
  const base = String(name || 'imagem').replace(/\.[^./\\]{1,8}$/, '');
  return `${base}${ext}`;
}

// Devolve { buffer, mimeType, originalName, changed, stats } — sempre um
// resultado válido (no pior caso, o original).
async function optimizeImage({ buffer, mimeType, originalName, field }) {
  const keep = { buffer, mimeType, originalName, changed: false };
  if (!sharp || !buffer || !/^image\/(png|jpeg|webp|gif)$/i.test(mimeType || '')) return keep;
  if (mimeType === 'image/png' && isApng(buffer)) return keep;
  try {
    const base = () => sharp(buffer, { animated: true, limitInputPixels: MAX_INPUT_PIXELS, failOn: 'none' }).timeout({ seconds: TIMEOUT_SECONDS });
    const meta = await base().metadata();
    const animated = (meta.pages || 1) > 1;
    const limit = limitFor(field);
    const resize = resizeOptions(meta, limit);
    const hasMeta = !!(meta.exif || meta.iptc || meta.xmp);
    const needsRotate = !!(meta.orientation && meta.orientation !== 1);

    // ---- GIF ----
    if (mimeType === 'image/gif') {
      if (!animated || !GIF_TO_WEBP_FIELDS.has(field)) return keep;
      let p = base();
      if (resize) p = p.resize(resize);
      const out = await p.webp({ quality: 90, effort: 4, loop: meta.loop ?? 0 }).toBuffer();
      if (out.length <= buffer.length * 0.8) {
        return { buffer: out, mimeType: 'image/webp', originalName: replaceExt(originalName, '.webp'), changed: true };
      }
      return keep;
    }

    // ---- WebP animado: não mexe (já é o formato leve) ----
    if (animated) return keep;

    // ---- WebP estático: só se precisa reduzir/girar/limpar metadado ----
    const mustProcess = !!resize || needsRotate || hasMeta;
    if (mimeType === 'image/webp' && !mustProcess) return keep;

    const pipeline = () => {
      let p = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'none' }).timeout({ seconds: TIMEOUT_SECONDS }).rotate();
      if (resize) p = p.resize(resize);
      return p; // sem .withMetadata(): o sharp já descarta EXIF/GPS/XMP por padrão
    };

    const candidates = [];
    if (mimeType === 'image/png') {
      // Sem perda visível. Prints/ícones (poucas cores) ficam menores em
      // WebP lossless; fotos salvas como PNG, em near-lossless (mantém
      // alfa). Tenta lossless primeiro; se já reduziu bem (≤ 60%), nem
      // tenta o outro (economiza CPU do servidor).
      const lossless = await pipeline().webp({ lossless: true, effort: 4 }).toBuffer();
      candidates.push({ buf: lossless, mime: 'image/webp', ext: '.webp' });
      if (lossless.length > buffer.length * 0.6) {
        candidates.push({ buf: await pipeline().webp({ nearLossless: true, quality: 90, effort: 4 }).toBuffer(), mime: 'image/webp', ext: '.webp' });
      }
      // Precisa mexer (reduzir/girar) e WebP não ajudou: PNG recomprimido.
      if (mustProcess && Math.min(...candidates.map((c) => c.buf.length)) > buffer.length) {
        candidates.push({ buf: await pipeline().png({ compressionLevel: 9 }).toBuffer(), mime: 'image/png', ext: '.png' });
      }
    } else if (mimeType === 'image/jpeg') {
      candidates.push({ buf: await pipeline().webp({ quality: 90, effort: 4 }).toBuffer(), mime: 'image/webp', ext: '.webp' });
      if (mustProcess) candidates.push({ buf: await pipeline().jpeg({ quality: 90, mozjpeg: true }).toBuffer(), mime: 'image/jpeg', ext: '.jpg' });
    } else if (mimeType === 'image/webp') {
      candidates.push({ buf: await pipeline().webp({ quality: 90, effort: 4 }).toBuffer(), mime: 'image/webp', ext: '.webp' });
    }
    if (!candidates.length) return keep;
    candidates.sort((a, b) => a.buf.length - b.buf.length);
    const best = candidates[0];
    // Nada obrigatório a fazer (sem giro/redução/metadado) e não ficou
    // menor: o original é melhor.
    if (!mustProcess && best.buf.length >= buffer.length) return keep;
    // Só limpar metadado mas o novo arquivo ficaria bem maior (ex.: JPEG
    // já muito comprimido): vale a privacidade, mas não 50% a mais.
    if (!resize && !needsRotate && best.buf.length > buffer.length * 1.5) return keep;
    const sameType = best.mime === mimeType;
    return {
      buffer: best.buf,
      mimeType: best.mime,
      originalName: sameType ? originalName : replaceExt(originalName, best.ext),
      changed: true,
    };
  } catch (err) {
    console.warn('[imageOptimizer] mantendo original:', err.message);
    return keep;
  }
}

module.exports = { optimizeImage, isAvailable: () => !!sharp, LIMITS };
