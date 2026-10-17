// Exportação do recorte do editor de imagem (ImageCropperModal.jsx).
//
// Item pedido: "o banner do perfil grande está ficando com qualidade muito
// ruim". Causas que somavam:
//  - o banner saía com no máximo 1800px de largura, mas a faixa do perfil
//    completo chega a 1180px de largura na tela — em tela retina (2x) a
//    imagem era esticada;
//  - recortes pequenos (zoom alto) eram ESTICADOS no canvas até 1200px
//    antes de comprimir (mais bytes, nenhum detalhe a mais);
//  - redução grande de uma vez só no canvas (ex.: 4000 → 1800) serrilha;
//  - saía em JPEG/WebP 0.92 e o servidor ainda recomprimia por cima.
// Agora: até 2400px (2x da maior faixa), sem esticar, redução em etapas
// de no máximo metade por vez e WebP 0.95 (o servidor não recomprime
// banner que já chega pronto — ver server/src/services/imageOptimizer.js).

// Maior largura em que cada banner aparece × 2 (tela retina).
export const BANNER_MAX_WIDTH = 2400; // perfil completo: faixa de até 1180px
export const MINI_BANNER_MAX_WIDTH = 1280; // miniperfil: 320px (com folga pra zoom da tela)
export const BANNER_EXPORT_QUALITY = 0.95;

export function isBannerAspect(aspectRatio) {
  return aspectRatio > 1.5;
}

// Tamanho final do recorte. Banner: a largura real do pedaço recortado,
// limitada ao máximo (nunca estica). Avatar: igual era antes.
export function cropOutputSize(aspectRatio, sourceWidth, { maxWidth = BANNER_MAX_WIDTH } = {}) {
  const sw = Math.max(1, Number(sourceWidth) || 1);
  let width;
  if (isBannerAspect(aspectRatio)) width = Math.round(Math.min(maxWidth, sw));
  else width = Math.round(Math.min(800, Math.max(256, sw)));
  width = Math.max(1, width);
  return { width, height: Math.max(1, Math.round(width / aspectRatio)) };
}

// Formato/qualidade da exportação. Banner: WebP 0.95 (navegador sem WebP
// no canvas devolve PNG, sem perda — o servidor converte com qualidade
// alta). Avatar: JPEG só se o original era JPEG; senão WebP (transparência).
export function cropExportFormat({ banner, originalType, removedBackground }) {
  if (banner) return { type: 'image/webp', quality: BANNER_EXPORT_QUALITY };
  const wasJpeg = !removedBackground && /^image\/jpe?g$/i.test(originalType || '');
  return { type: wasJpeg ? 'image/jpeg' : 'image/webp', quality: 0.92 };
}

// Desenha o pedaço (sx, sy, sw, sh) da imagem no canvas final reduzindo em
// etapas de no máximo 50% — o drawImage de uma vez só, com redução grande,
// pula pixels e deixa a imagem serrilhada/borrada.
export function drawHighQuality(img, { sx, sy, sw, sh }, canvas) {
  const tw = canvas.width;
  const th = canvas.height;
  let src = img;
  let rx = sx; let ry = sy; let rw = sw; let rh = sh;
  while (rw / 2 >= tw && rh / 2 >= th) {
    const step = document.createElement('canvas');
    step.width = Math.max(tw, Math.round(rw / 2));
    step.height = Math.max(th, Math.round(rh / 2));
    const sctx = step.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src, rx, ry, rw, rh, 0, 0, step.width, step.height);
    src = step; rx = 0; ry = 0; rw = step.width; rh = step.height;
  }
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, rx, ry, rw, rh, 0, 0, tw, th);
}
