import { useCallback, useEffect, useRef } from 'react';

const MIN_WIDTH = 120;
const MIN_HEIGHT = 100;
const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

// Item pedido: "GIFa Move" — caixa que a staff arrasta livremente e
// redimensiona por alças nas bordas/cantos, representando o menu de
// GIFs sobre uma prévia da tela real. Funciona em pixels, sempre
// relativo ao container pai (que precisa ter position: relative) —
// o CALLER decide o que esses pixels significam (a prévia desktop e a
// prévia mobile passam containers de tamanhos DIFERENTES, então o
// mesmo componente serve pros dois, sem duplicar a lógica de
// arrastar/redimensionar).
export default function DraggableResizableBox({ value, onChange, containerRef, label }) {
  const dragRef = useRef(null); // { mode: 'move'|'resize', handle, startX, startY, startBox }

  const onPointerDown = useCallback((e, mode, handle) => {
    e.preventDefault();
    e.stopPropagation();
    const point = e.touches ? e.touches[0] : e;
    dragRef.current = { mode, handle, startX: point.clientX, startY: point.clientY, startBox: { ...value } };
  }, [value]);

  useEffect(() => {
    const onMove = (e) => {
      const drag = dragRef.current;
      if (!drag) return;
      const point = e.touches ? e.touches[0] : e;
      const dx = point.clientX - drag.startX;
      const dy = point.clientY - drag.startY;
      const containerRect = containerRef.current?.getBoundingClientRect();
      const maxLeft = containerRect ? containerRect.width : Infinity;
      const maxTop = containerRect ? containerRect.height : Infinity;
      let { left, top, width, height } = drag.startBox;

      if (drag.mode === 'move') {
        left = Math.min(Math.max(0, drag.startBox.left + dx), Math.max(0, maxLeft - width));
        top = Math.min(Math.max(0, drag.startBox.top + dy), Math.max(0, maxTop - height));
      } else {
        const h = drag.handle;
        if (h.includes('e')) width = Math.max(MIN_WIDTH, drag.startBox.width + dx);
        if (h.includes('s')) height = Math.max(MIN_HEIGHT, drag.startBox.height + dy);
        if (h.includes('w')) {
          const newWidth = Math.max(MIN_WIDTH, drag.startBox.width - dx);
          left = drag.startBox.left + (drag.startBox.width - newWidth);
          width = newWidth;
        }
        if (h.includes('n')) {
          const newHeight = Math.max(MIN_HEIGHT, drag.startBox.height - dy);
          top = drag.startBox.top + (drag.startBox.height - newHeight);
          height = newHeight;
        }
        // Não deixa a caixa sair do container ao redimensionar pelas
        // bordas de cima/esquerda (senão "left"/"top" negativo sumiria
        // da prévia sem nenhum aviso visual do porquê).
        if (left < 0) { width += left; left = 0; }
        if (top < 0) { height += top; top = 0; }
      }
      onChange({ left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [onChange, containerRef]);

  return (
    <div
      className="gif-move-box"
      style={{ left: value.left, top: value.top, width: value.width, height: value.height }}
      onMouseDown={(e) => onPointerDown(e, 'move')}
      onTouchStart={(e) => onPointerDown(e, 'move')}
    >
      <div className="gif-move-box-label">{label}</div>
      <div className="gif-move-box-dims">{value.width} × {value.height}px</div>
      {HANDLES.map((h) => (
        <div
          key={h}
          className={`gif-move-handle gif-move-handle-${h}`}
          onMouseDown={(e) => onPointerDown(e, 'resize', h)}
          onTouchStart={(e) => onPointerDown(e, 'resize', h)}
        />
      ))}
    </div>
  );
}
