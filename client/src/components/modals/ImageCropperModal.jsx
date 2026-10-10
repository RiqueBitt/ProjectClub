import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import UserAvatar from '../UserAvatar.jsx';
import { bannerImageStyle, formatBannerFraming, parseBannerFraming } from '../ProfileBanner.jsx';
import '../../styles/profile-banner.css';

// Item pedido: "quando for colocar uma foto/banner no perfil, abra um
// menu pra você selecionar a área que você quer mostrar... tipo vai
// mostrar um retângulo, quadrado, etc, aí você vai encaixar a imagem
// do jeito que quiser" — antes, o arquivo escolhido no seletor do
// sistema ia direto pro upload, sem nenhuma chance de posicionar; se
// a foto fosse mais larga/alta que a área de exibição, o
// enquadramento automático (object-fit: cover) podia cortar
// exatamente a parte que a pessoa queria mostrar, sem ela poder
// escolher.
//
// REFEITO (editor estilo Discord): a imagem inteira aparece no palco,
// escurecida fora da moldura; a moldura tem EXATAMENTE a proporção de
// onde a imagem vai aparecer (ver PROFILE_BANNER_ASPECT em
// ProfileBanner.jsx). Arrastar (mouse ou dedo), pinça, roda do mouse,
// controle de zoom e teclado (setas / + / −) ajustam o enquadramento.
// Embaixo, uma prévia ao vivo usando a MESMA regra de exibição do
// perfil de verdade (bannerImageStyle), então o resultado é o mesmo.
//
// O enquadramento é guardado como { x, y, zoom }: x/y = ponto de foco
// em % (0–100) e zoom 1–4 por cima do "cover". Dois modos:
//   - mode 'crop' (imagem estática): recorta num <canvas> e devolve um
//     arquivo novo já na proporção certa → onConfirm(file, null).
//   - mode 'frame' (GIF, ou reajustar o banner atual): NÃO recorta —
//     canvas perderia a animação. Devolve só o enquadramento
//     "x,y,zoom" → onConfirm(file|null, framing), e a exibição aplica.
//
// shape = 'circle' só muda a MÁSCARA visual durante a edição — o
// recorte em si é sempre um retângulo, quem arredonda de verdade é
// UserAvatar.jsx na exibição.
//
// BUG CORRIGIDO ("foto de perfil com fundo transparente fica com
// fundo preto"): o recorte era sempre exportado como JPEG, que não
// tem transparência — o canvas transformava toda área transparente
// em PRETO. Agora só sai JPEG se o arquivo original já era JPEG;
// qualquer outro formato sai WebP (com transparência; navegadores sem
// WebP no canvas devolvem PNG, que também mantém).

// Item pedido: "as imagens dos banners completos tão ficando com uma
// qualidade muito baixa" — recortes bem mais largos que altos
// (banners) saem com bastante largura pra continuar nítidos esticados
// numa faixa larga/tela retina; avatares ficam no tamanho de antes.
function outputWidthFor(aspectRatio, srcW) {
  if (aspectRatio > 1.5) return Math.round(Math.min(1800, Math.max(1200, srcW)));
  return Math.round(Math.min(800, Math.max(256, srcW)));
}

// ---------- Tirar fundo preto (avatar) ----------
// Item pedido: "remover o fundo preto das fotos de perfil que não têm
// fundo e deixar transparente pra mostrar a cor do perfil". Fotos que
// perderam a transparência (salvas antes da correção, ou exportadas por
// outro programa) ficam com o fundo preto "chapado". A partir das bordas,
// apaga o preto ligado ao contorno (flood fill) — o preto DENTRO do
// desenho (olhos, contorno) fica, porque não encosta na borda.
const BG_TOL = 38; // até onde conta como "preto"
const BG_SOFT = 80; // faixa de borda suavizada

function analyzeImage(img) {
  const max = 1024;
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  let data;
  try { data = ctx.getImageData(0, 0, w, h); } catch { return null; } // imagem de outro site: não dá pra ler
  const px = data.data;
  let transparent = 0;
  for (let i = 3; i < px.length; i += 4 * 7) if (px[i] < 250) transparent += 1;
  let border = 0; let dark = 0;
  const isDark = (i) => Math.max(px[i], px[i + 1], px[i + 2]) <= BG_TOL && px[i + 3] > 200;
  for (let x = 0; x < w; x += 1) { for (const y of [0, h - 1]) { border += 1; if (isDark((y * w + x) * 4)) dark += 1; } }
  for (let y = 0; y < h; y += 1) { for (const x of [0, w - 1]) { border += 1; if (isDark((y * w + x) * 4)) dark += 1; } }
  return { canvas, ctx, data, w, h, hasAlpha: transparent > 0, darkBorder: border ? dark / border : 0 };
}

function removeBlackBackground(info) {
  const { w, h } = info;
  const src = info.data.data;
  const out = new Uint8ClampedArray(src);
  const seen = new Uint8Array(w * h);
  const stack = [];
  const lum = (p) => Math.max(out[p * 4], out[p * 4 + 1], out[p * 4 + 2]);
  const push = (p) => { if (!seen[p] && lum(p) <= BG_TOL) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x += 1) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y += 1) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    out[p * 4 + 3] = 0;
    const x = p % w; const y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  // Borda suave: pixel escuro colado no que foi apagado fica semitransparente.
  for (let p = 0; p < w * h; p += 1) {
    if (seen[p]) continue;
    const l = lum(p);
    if (l > BG_SOFT) continue;
    const x = p % w; const y = (p - x) / w;
    const near = (x > 0 && seen[p - 1]) || (x < w - 1 && seen[p + 1]) || (y > 0 && seen[p - w]) || (y < h - 1 && seen[p + w]);
    if (near) out[p * 4 + 3] = Math.round(out[p * 4 + 3] * clamp((l - BG_TOL) / (BG_SOFT - BG_TOL), 0, 1));
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), 'image/png'));
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Ícones locais (traço, mesmo estilo de PageIcons.jsx).
const ICONS = {
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  reset: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
};
function Ico({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

// Área da imagem original (px reais) que cabe na moldura com esse
// enquadramento — mesma conta do object-fit: cover + object-position +
// scale() usado na exibição (ver bannerImageStyle).
function sourceRect(nw, nh, aspect, { x, y, zoom }) {
  let srcW; let srcH;
  if (nw / nh >= aspect) { srcH = nh / zoom; srcW = srcH * aspect; } else { srcW = nw / zoom; srcH = srcW / aspect; }
  return { sx: (nw - srcW) * (x / 100), sy: (nh - srcH) * (y / 100), sw: srcW, sh: srcH };
}

export default function ImageCropperModal({
  file, src, aspectRatio = 1, shape = 'rect', title = 'Ajustar imagem',
  mode = 'crop', initialFraming, preview, previewUser, onConfirm, onClose,
}) {
  const [url, setUrl] = useState(null);
  const [natural, setNatural] = useState(null); // { w, h }
  const [loadError, setLoadError] = useState(false);
  const [framing, setFraming] = useState(() => parseBannerFraming(initialFraming));
  const [stageW, setStageW] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Tirar fundo preto (só avatar): null = ainda não analisou.
  const [bgInfo, setBgInfo] = useState(null);
  const [removeBg, setRemoveBg] = useState(false);
  const [cleanUrl, setCleanUrl] = useState(null);
  const [bgBusy, setBgBusy] = useState(false);
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const framingRef = useRef(framing);
  framingRef.current = framing;
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const isGif = !!file && (file.type === 'image/gif' || /\.gif$/i.test(file.name || ''));
  const circle = shape === 'circle';

  useEffect(() => {
    setNatural(null); setLoadError(false);
    setBgInfo(null); setRemoveBg(false); setCleanUrl(null);
    if (file) {
      const u = URL.createObjectURL(file);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    setUrl(src || null);
    return undefined;
  }, [file, src]);

  const avatarMode = preview === 'avatar' && mode !== 'frame' && !(!!file && (file.type === 'image/gif' || /\.gif$/i.test(file.name || '')));
  const sourceImgRef = useRef(null);
  useEffect(() => {
    if (!avatarMode || !url) return undefined;
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!alive) return;
      const info = analyzeImage(img);
      sourceImgRef.current = info;
      setBgInfo(info ? { canEdit: true, hasAlpha: info.hasAlpha, suggest: !info.hasAlpha && info.darkBorder >= 0.55 } : { canEdit: false });
      if (info && !info.hasAlpha && info.darkBorder >= 0.55) setRemoveBg(true);
    };
    img.onerror = () => { if (alive) setBgInfo({ canEdit: false }); };
    img.src = url;
    return () => { alive = false; };
  }, [avatarMode, url]);

  useEffect(() => {
    if (!removeBg || !sourceImgRef.current) { setCleanUrl(null); return undefined; }
    let alive = true;
    let made = null;
    setBgBusy(true);
    removeBlackBackground(sourceImgRef.current).then((u) => {
      made = u;
      if (alive) setCleanUrl(u); else if (u) URL.revokeObjectURL(u);
    }).finally(() => { if (alive) setBgBusy(false); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [removeBg, bgInfo]);

  // Imagem mostrada/recortada: a versão sem fundo, quando ligada.
  const shownUrl = (removeBg && cleanUrl) || url;

  // Largura real do palco (acompanha o tamanho do modal/tela).
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = () => setStageW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Moldura + palco: banner = moldura larga com sobra em cima/embaixo
  // pra ver o resto da imagem; avatar = moldura quadrada/redonda.
  const geo = useMemo(() => {
    if (!stageW) return null;
    let fw; let fh; let stageH;
    if (aspectRatio <= 1.2) {
      stageH = Math.min(stageW, 320);
      fh = stageH - 56; fw = fh * aspectRatio;
      if (fw > stageW - 40) { fw = stageW - 40; fh = fw / aspectRatio; }
    } else {
      const padX = clamp(stageW * 0.06, 14, 36);
      fw = stageW - padX * 2; fh = fw / aspectRatio;
      stageH = fh + clamp(fh * 0.4, 36, 72) * 2;
    }
    return { fw, fh, stageH, left: (stageW - fw) / 2, top: (stageH - fh) / 2 };
  }, [stageW, aspectRatio]);

  const disp = useMemo(() => {
    if (!geo || !natural) return null;
    const cover = Math.max(geo.fw / natural.w, geo.fh / natural.h);
    const dw = natural.w * cover * framing.zoom;
    const dh = natural.h * cover * framing.zoom;
    return {
      dw, dh,
      left: geo.left - (dw - geo.fw) * (framing.x / 100),
      top: geo.top - (dh - geo.fh) * (framing.y / 100),
    };
  }, [geo, natural, framing]);

  // Arrastar move a IMAGEM (igual Discord): arrastar pra direita
  // mostra mais do lado esquerdo dela.
  const panBy = (dx, dy, start) => {
    if (!geo || !natural) return;
    const cover = Math.max(geo.fw / natural.w, geo.fh / natural.h);
    const rangeX = natural.w * cover * start.zoom - geo.fw;
    const rangeY = natural.h * cover * start.zoom - geo.fh;
    setFraming({
      zoom: start.zoom,
      x: rangeX > 0.5 ? clamp(start.x - (dx / rangeX) * 100, 0, 100) : start.x,
      y: rangeY > 0.5 ? clamp(start.y - (dy / rangeY) * 100, 0, 100) : start.y,
    });
  };
  const setZoom = (z) => setFraming((f) => ({ ...f, zoom: clamp(Number(z) || 1, MIN_ZOOM, MAX_ZOOM) }));

  const pointerDist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  const beginGesture = () => {
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) gesture.current = { type: 'pinch', dist0: pointerDist(), zoom0: framingRef.current.zoom };
    else if (pts.length === 1) gesture.current = { type: 'pan', sx: pts[0].x, sy: pts[0].y, start: framingRef.current };
    else gesture.current = null;
  };
  const onPointerDown = (e) => {
    if (!natural || busy) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    beginGesture();
    setDragging(true);
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.type === 'pan') panBy(e.clientX - g.sx, e.clientY - g.sy, g.start);
    else setZoom(g.zoom0 * (pointerDist() / g.dist0));
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    beginGesture();
    if (!pointers.current.size) setDragging(false);
  };

  // Roda do mouse = zoom (listener nativo pra poder impedir a rolagem).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!natural) return;
      e.preventDefault();
      setFraming((f) => ({ ...f, zoom: clamp(f.zoom * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [natural]);

  // Teclado: setas movem, Shift+seta move mais, + / − zoom, 0 redefine.
  const onKeyDown = (e) => {
    if (!natural) return;
    const step = e.shiftKey ? 10 : 2;
    const f = framingRef.current;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      const [mx, my] = moves[e.key];
      setFraming({ ...f, x: clamp(f.x + mx, 0, 100), y: clamp(f.y + my, 0, 100) });
    } else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(f.zoom + 0.1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(f.zoom - 0.1); }
    else if (e.key === '0') { e.preventDefault(); reset(); }
  };

  const reset = () => setFraming({ x: 50, y: 50, zoom: 1 });

  const cropToFile = () => new Promise((resolve, reject) => {
    const img = imgRef.current;
    if (!img || !natural) { reject(new Error('A imagem ainda não carregou.')); return; }
    const { sx, sy, sw, sh } = sourceRect(natural.w, natural.h, aspectRatio, framingRef.current);
    const outW = outputWidthFor(aspectRatio, sw);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = Math.round(outW / aspectRatio);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    // JPEG só se o original já era JPEG (não tinha transparência) e o
    // fundo não foi tirado.
    const wasJpeg = !(removeBg && cleanUrl) && file && /^image\/jpe?g$/i.test(file.type);
    const type = wasJpeg ? 'image/jpeg' : 'image/webp';
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('Não foi possível processar a imagem.')); return; }
      const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
      const base = (file?.name || 'imagem').replace(/\.[^.]+$/, '');
      resolve(new File([blob], `${base}.${ext}`, { type: blob.type }));
    }, type, 0.92);
  });

  const apply = async () => {
    if (!natural || busy) return;
    setBusy(true); setError('');
    try {
      if (mode === 'frame') await onConfirm(file || null, formatBannerFraming(framingRef.current));
      else await onConfirm(await cropToFile(), null);
    } catch (err) {
      if (mounted.current) setError(err?.response?.data?.error || err?.message || 'Não foi possível aplicar.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const zoomPct = Math.round(((framing.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100);
  const isBannerPreview = preview === 'banner' || preview === 'mini';
  // Cor do perfil: pode ser degradê — serve de fundo direto, mas pra
  // misturar (color-mix) só uma cor sólida.
  const pc = previewUser?.profileColor || '';
  const pcSolid = /^#[0-9a-f]{3,8}$/i.test(pc) ? pc : 'var(--brand)';

  return (
    <Modal title={title} onClose={busy ? () => {} : onClose} width={aspectRatio > 1.2 ? '620px' : '480px'} className="ifx-modal">
      <div className={`ifx ${circle ? 'ifx-circle' : ''}`}>
        <div
          ref={stageRef}
          className={`ifx-stage ${dragging ? 'is-dragging' : ''}`}
          style={{ height: geo ? geo.stageH : 220 }}
          tabIndex={0}
          role="group"
          aria-label="Área de enquadramento. Arraste ou use as setas para posicionar; + e − para zoom."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {url && (
            <img
              ref={imgRef}
              src={shownUrl}
              crossOrigin={file ? undefined : 'anonymous'}
              alt=""
              draggable={false}
              className="ifx-img"
              onLoad={(e) => { const t = e.currentTarget; setNatural((n) => (n && n.w === t.naturalWidth && n.h === t.naturalHeight ? n : { w: t.naturalWidth, h: t.naturalHeight })); }}
              onError={() => setLoadError(true)}
              style={disp ? { width: disp.dw, height: disp.dh, left: disp.left, top: disp.top } : { opacity: 0 }}
            />
          )}
          {geo && (
            <div
              className="ifx-frame"
              style={{ left: geo.left, top: geo.top, width: geo.fw, height: geo.fh }}
              aria-hidden="true"
            >
              <span className="ifx-grid" />
            </div>
          )}
          {!natural && !loadError && <div className="ifx-loading"><span className="ifx-spinner" /></div>}
          {loadError && <div className="ifx-loading ifx-load-error">Não foi possível abrir essa imagem.</div>}
          {natural && !dragging && (
            <div className="ifx-hint" aria-hidden="true"><Ico name="move" size={13} /> Arraste para posicionar</div>
          )}
        </div>

        <div className="ifx-controls">
          <button type="button" className="ifx-icon-btn" onClick={() => setZoom(framing.zoom - 0.25)} disabled={!natural || framing.zoom <= MIN_ZOOM} aria-label="Diminuir zoom" title="Diminuir zoom">
            <Ico name="minus" />
          </button>
          <input
            type="range" className="ifx-range" min={MIN_ZOOM} max={MAX_ZOOM} step="0.01"
            value={framing.zoom}
            onChange={(e) => setZoom(e.target.value)}
            disabled={!natural}
            aria-label="Zoom"
            style={{ '--ifx-fill': `${zoomPct}%` }}
          />
          <button type="button" className="ifx-icon-btn" onClick={() => setZoom(framing.zoom + 0.25)} disabled={!natural || framing.zoom >= MAX_ZOOM} aria-label="Aumentar zoom" title="Aumentar zoom">
            <Ico name="plus" />
          </button>
          <span className="ifx-zoom-val">{framing.zoom.toFixed(1)}×</span>
          <button type="button" className="ifx-reset" onClick={reset} disabled={!natural} title="Redefinir (0)">
            <Ico name="reset" size={14} /> Redefinir
          </button>
        </div>

        {(isGif || mode === 'frame') && (
          <p className="ifx-note">
            <Ico name="film" size={14} />
            {isGif ? 'GIF animado: a animação continua — só o enquadramento é salvo.' : 'Ajuste o enquadramento sem precisar enviar a imagem de novo.'}
          </p>
        )}

        {avatarMode && bgInfo?.canEdit && !bgInfo.hasAlpha && (
          <label className={`ifx-bgtoggle ${removeBg ? 'on' : ''}`}>
            <input type="checkbox" checked={removeBg} disabled={bgBusy} onChange={(e) => setRemoveBg(e.target.checked)} />
            <span className="ifx-bgtoggle-track" aria-hidden="true"><span /></span>
            <span className="ifx-bgtoggle-text">
              <b>Tirar fundo preto</b>
              <small>{bgInfo.hasAlpha
                ? 'Sua imagem já tem fundo transparente — ele vai mostrar a cor do perfil.'
                : bgInfo.suggest ? 'Detectamos um fundo preto: ele vira transparente e mostra a cor do seu perfil.' : 'Apaga o preto que encosta na borda da imagem.'}</small>
            </span>
            {bgBusy && <span className="ifx-spinner small" />}
          </label>
        )}

        {error && <p className="ifx-error" role="alert">{error}</p>}

        <div className="ifx-footer">
        {preview && natural && (
          <div className="ifx-preview">
            <div className="ifx-preview-label">{preview === 'mini' ? 'Prévia no miniperfil' : preview === 'banner' ? 'Prévia no perfil' : 'Prévia'}</div>
            {isBannerPreview ? (
              <div className={`ifx-prev-card ${preview === 'mini' ? 'is-mini' : ''}`} style={{ '--ifx-pc': pc || 'var(--brand)', '--ifx-tint': pcSolid }}>
                <div className="ifx-prev-banner" style={{ aspectRatio: String(aspectRatio) }}>
                  <img src={url} alt="" draggable={false} style={bannerImageStyle(framing)} />
                </div>
                <div className="ifx-prev-id">
                  <div className="ifx-prev-avatar"><UserAvatar user={previewUser} size={preview === 'mini' ? 48 : 56} /></div>
                  <div className="ifx-prev-names">
                    <b className="truncate">{previewUser?.displayName || 'Você'}</b>
                    {previewUser?.username && <span className="truncate">@{previewUser.username}</span>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="ifx-prev-avatars" style={{ '--ifx-pc': pc || '#F2894D' }}>
                {[88, 48, 32].map((s) => (
                  <span key={s} className="ifx-prev-av" style={{ width: s, height: s }}>
                    <img src={shownUrl} alt="" draggable={false} style={bannerImageStyle(framing)} />
                  </span>
                ))}
                <span className="ifx-prev-av-note">Áreas transparentes mostram a cor do seu perfil.</span>
              </div>
            )}
          </div>
        )}

        <div className="ifx-actions">
          <button type="button" className="ifx-btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="ifx-btn primary" onClick={apply} disabled={!natural || busy}>
            {busy ? <><span className="ifx-spinner small" /> Aplicando…</> : 'Aplicar'}
          </button>
        </div>
        </div>
      </div>
    </Modal>
  );
}
