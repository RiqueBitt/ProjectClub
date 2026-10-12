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

// ---- Avatar em GIF (animado) ----
// BUG CORRIGIDO ("foto de perfil em GIF não funciona"): o GIF de avatar
// subia cru — sem recorte (o recortador do navegador desenha num <canvas>,
// que só pega 1 quadro, então o GIF pulava o editor e ficava retangular/
// descentralizado), sem limite de tamanho (GIF de 2000px e 20 MB) e, quando
// passava de 8 MB, nem aparecia nas telas que buscam a imagem pelo proxy
// (/api/proxy/image recusa > 8 MB). Agora o recorte escolhido no editor
// chega como "x,y,zoom" (mesma regra do enquadramento de banner) e é
// aplicado aqui em TODOS os quadros com o sharp ({ animated: true }); o
// resultado é reduzido pra no máximo 512px e sai GIF de novo — a animação,
// os tempos de cada quadro e o loop continuam.
const AVATAR_GIF_MAX_BYTES = 8 * 1024 * 1024; // GIF enviado pra avatar (antes de processar)

function parseFraming(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const parts = String(raw).split(',').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, zoom] = parts;
  if (x < 0 || x > 100 || y < 0 || y > 100 || zoom < 1 || zoom > 4) return null;
  return { x, y, zoom };
}

// Mesma conta do sourceRect do ImageCropperModal.jsx (cliente): retângulo
// de origem na proporção `aspect`, com zoom por cima do "cover" e o ponto
// de foco x/y em % — o que a pessoa viu no editor é o que sai aqui.
function framingRect(nw, nh, aspect, { x, y, zoom }) {
  let srcW; let srcH;
  if (nw / nh >= aspect) { srcH = nh / zoom; srcW = srcH * aspect; } else { srcW = nw / zoom; srcH = srcW / aspect; }
  const width = Math.max(1, Math.min(nw, Math.round(srcW)));
  const height = Math.max(1, Math.min(nh, Math.round(srcH)));
  const left = Math.max(0, Math.min(nw - width, Math.round((nw - srcW) * (x / 100))));
  const top = Math.max(0, Math.min(nh - height, Math.round((nh - srcH) * (y / 100))));
  return { left, top, width, height };
}

async function processGifAvatar({ buffer, originalName, meta, base, crop, keep }) {
  const w = meta.width || 0;
  const h = (meta.pageHeight || meta.height) || 0;
  if (!w || !h) return keep;
  const framing = parseFraming(crop);
  let p = base();
  let cw = w; let ch = h;
  if (framing) {
    const r = framingRect(w, h, 1, framing);
    // Recorte que não muda nada (imagem já quadrada, sem zoom) é pulado.
    if (r.width !== w || r.height !== h || r.left || r.top) {
      p = p.extract(r);
      cw = r.width; ch = r.height;
    }
  }
  const cropped = cw !== w || ch !== h;
  const resize = Math.max(cw, ch) > LIMITS.avatar.side;
  if (!cropped && !resize) return keep;
  if (resize) p = p.resize({ width: LIMITS.avatar.side, height: LIMITS.avatar.side, fit: 'inside', withoutEnlargement: true });
  const out = await p.gif({ loop: meta.loop ?? 0, effort: 7 }).toBuffer();
  // Só reduziu (sem recorte) e o GIF reencodado ficou maior: o original é melhor.
  if (!cropped && out.length >= buffer.length) return keep;
  return { buffer: out, mimeType: 'image/gif', originalName: replaceExt(originalName, '.gif'), changed: true };
}

function replaceExt(name, ext) {
  const base = String(name || 'imagem').replace(/\.[^./\\]{1,8}$/, '');
  return `${base}${ext}`;
}

// Devolve { buffer, mimeType, originalName, changed, stats } — sempre um
// resultado válido (no pior caso, o original).
async function optimizeImage({ buffer, mimeType, originalName, field, crop }) {
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
      // Avatar: recorta (enquadramento do editor) e reduz TODOS os quadros, continua GIF.
      if (field === 'avatar') return await processGifAvatar({ buffer, originalName, meta, base, crop, keep });
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

module.exports = { optimizeImage, isAvailable: () => !!sharp, LIMITS, AVATAR_GIF_MAX_BYTES, framingRect, parseFraming };
