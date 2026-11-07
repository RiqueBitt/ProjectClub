import { useEffect, useState } from 'react';

// Recorta a borda TRANSPARENTE de uma imagem (PNG/WebP com "respiro"
// vazio em volta), igual ao `convert -trim`: só tira as linhas/colunas
// externas 100% transparentes, nunca pixel visível, e mantém a proporção do
// que sobrou. Usado nos baús da Economia — as imagens (links do imgur/B2
// cadastrados pela staff) vêm com muito espaço vazio em volta e o baú
// ficava pequeno no meio do quadro.
//
// Falha em silêncio (devolve a URL original) quando o servidor da imagem
// não libera CORS (canvas "contaminado"), quando a imagem não carrega ou
// quando não há borda pra tirar.
const cache = new Map(); // src -> Promise<string>
const ALPHA_MIN = 8; // alpha abaixo disso conta como transparente (antialias/ruído)
const MAX_SIDE = 1024; // imagens maiores são analisadas reduzidas

function trim(src) {
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((resolve) => {
    if (typeof document === 'undefined' || !src || /^data:image\/svg|\.svg(\?|$)/i.test(src)) { resolve(src); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h); // lança SecurityError sem CORS
        let top = h, left = w, right = -1, bottom = -1;
        for (let y = 0; y < h; y++) {
          const row = y * w * 4;
          for (let x = 0; x < w; x++) {
            if (data[row + x * 4 + 3] >= ALPHA_MIN) {
              if (x < left) left = x;
              if (x > right) right = x;
              if (y < top) top = y;
              if (y > bottom) bottom = y;
            }
          }
        }
        if (right < 0) { resolve(src); return; } // toda transparente
        // 1px de folga pra não cortar o antialias da borda.
        left = Math.max(0, left - 1); top = Math.max(0, top - 1);
        right = Math.min(w - 1, right + 1); bottom = Math.min(h - 1, bottom + 1);
        const cw = right - left + 1;
        const ch = bottom - top + 1;
        // Borda irrelevante (< 3% em cada eixo): mantém a original.
        if (cw >= w * 0.97 && ch >= h * 0.97) { resolve(src); return; }
        const out = document.createElement('canvas');
        // Recorta na resolução ORIGINAL (não na reduzida da análise).
        const sx = left / scale; const sy = top / scale;
        const sw = cw / scale; const sh = ch / scale;
        out.width = Math.round(sw); out.height = Math.round(sh);
        out.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
        resolve(out.toDataURL('image/png'));
      } catch {
        resolve(src);
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
  cache.set(src, p);
  return p;
}

// Hook: começa mostrando a URL original e troca pela versão recortada
// assim que ela fica pronta (sem piscar: o tamanho do <img> é do CSS).
export function useTrimmedImage(src) {
  const [out, setOut] = useState(src);
  useEffect(() => {
    let alive = true;
    setOut(src);
    if (src) trim(src).then((r) => { if (alive) setOut(r); });
    return () => { alive = false; };
  }, [src]);
  return out;
}

export function TrimmedImg({ src, ...rest }) {
  const trimmed = useTrimmedImage(src);
  // eslint-disable-next-line jsx-a11y/alt-text
  return <img src={trimmed} {...rest} />;
}
