import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ChatIcon from './ChatIcons.jsx';

// Recorte simples de imagem antes de enviar no chat: um retângulo que dá
// pra arrastar (mover) e redimensionar pelos cantos. O resultado é
// desenhado num canvas e vira um File novo com o mesmo nome/tipo.
// GIF e SVG não passam por aqui (o canvas perderia a animação/vetor).

const MIN_SIZE = 24; // px na tela
const HANDLES = ['nw', 'ne', 'sw', 'se'];
const TITLE = 'Recortar imagem';
const LABEL_CANCEL = 'Cancelar';
const LABEL_APPLY = 'Aplicar recorte';
const LABEL_RESET = 'Imagem inteira';
const HINT = 'Arraste a área ou os cantos para escolher o recorte.';

export function canCropFile(file) {
  return !!file && /^image\/(png|jpe?g|webp|bmp)$/i.test(file.type);
}

export default function ImageCropModal({ file, onCancel, onApply }) {
  const [url, setUrl] = useState(null);
  const imgRef = useRef(null);
  const [box, setBox] = useState(null); // {x,y,w,h} em px da imagem exibida
  const dragRef = useRef(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const fullBox = () => {
    const img = imgRef.current;
    if (!img) return null;
    return { x: 0, y: 0, w: img.clientWidth, h: img.clientHeight };
  };

  const onImgLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    // Começa com uma margem de 10% em volta.
    const w = img.clientWidth; const h = img.clientHeight;
    setBox({ x: w * 0.1, y: h * 0.1, w: w * 0.8, h: h * 0.8 });
  };

  const startDrag = (e, mode) => {
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    const img = imgRef.current;
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, start: box, maxW: img.clientWidth, maxH: img.clientHeight };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    // Em telas com zoom CSS os deltas do ponteiro já batem com o layout do
    // elemento (os dois são medidos na mesma escala do clientWidth).
    const rect = imgRef.current.getBoundingClientRect();
    const scale = rect.width ? d.maxW / rect.width : 1;
    const dx = (e.clientX - d.startX) * scale;
    const dy = (e.clientY - d.startY) * scale;
    let { x, y, w, h } = d.start;
    if (d.mode === 'move') {
      x = Math.min(Math.max(0, x + dx), d.maxW - w);
      y = Math.min(Math.max(0, y + dy), d.maxH - h);
    } else {
      if (d.mode.includes('w')) { const nx = Math.min(Math.max(0, x + dx), x + w - MIN_SIZE); w += x - nx; x = nx; }
      if (d.mode.includes('e')) { w = Math.min(Math.max(MIN_SIZE, w + dx), d.maxW - x); }
      if (d.mode.includes('n')) { const ny = Math.min(Math.max(0, y + dy), y + h - MIN_SIZE); h += y - ny; y = ny; }
      if (d.mode.includes('s')) { h = Math.min(Math.max(MIN_SIZE, h + dy), d.maxH - y); }
    }
    setBox({ x, y, w, h });
  };

  const endDrag = () => { dragRef.current = null; };

  const apply = async () => {
    const img = imgRef.current;
    if (!img || !box) return;
    setBusy(true);
    try {
      const sx = img.naturalWidth / img.clientWidth;
      const sy = img.naturalHeight / img.clientHeight;
      const cw = Math.max(1, Math.round(box.w * sx));
      const ch = Math.max(1, Math.round(box.h * sy));
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      canvas.getContext('2d').drawImage(img, Math.round(box.x * sx), Math.round(box.y * sy), cw, ch, 0, 0, cw, ch);
      const type = /^image\/(png|jpeg|webp)$/i.test(file.type) ? file.type : 'image/png';
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
      if (!blob) { onCancel(); return; }
      let name = file.name;
      if (type !== file.type) name = name.replace(/\.[^.]+$/, '') + '.png';
      onApply(new File([blob], name, { type }));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="chat-crop-overlay" role="dialog" aria-modal="true" aria-label={TITLE} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="chat-crop-box">
        <div className="chat-crop-head">
          <h2>{TITLE}</h2>
          <button type="button" className="chat-crop-x" onClick={onCancel} aria-label={LABEL_CANCEL} title={LABEL_CANCEL}><ChatIcon name="close" size={16} /></button>
        </div>
        <p className="chat-crop-hint">{HINT}</p>
        <div className="chat-crop-stage" onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <div className="chat-crop-imgwrap">
            {url && <img ref={imgRef} src={url} alt="" onLoad={onImgLoad} draggable={false} />}
            {box && (
              <div
                className="chat-crop-rect"
                style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                onPointerDown={(e) => startDrag(e, 'move')}
              >
                {HANDLES.map((hd) => (
                  <span key={hd} className={`chat-crop-handle h-${hd}`} onPointerDown={(e) => startDrag(e, hd)} />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="chat-crop-actions">
          <button type="button" className="chat-crop-btn ghost" onClick={() => setBox(fullBox())}>{LABEL_RESET}</button>
          <span className="chat-crop-spacer" />
          <button type="button" className="chat-crop-btn ghost" onClick={onCancel}>{LABEL_CANCEL}</button>
          <button type="button" className="chat-crop-btn primary" onClick={apply} disabled={!box || busy}>{LABEL_APPLY}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
