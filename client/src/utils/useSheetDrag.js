import { useEffect, useRef, useState } from 'react';

const MIN_VH = 32;
const MAX_VH = 92;
// Item pedido: "menos alto" (pro menu de GIF/emoji no PC) — 60vh
// (bem mais da metade da tela) também batia com a queixa anterior de
// "cobrindo demais" no mobile. 40vh é uma altura inicial mais
// enxuta nos dois contextos — ainda dá pra arrastar a alça pra
// aumentar se quiser, isso não muda (MIN_VH/MAX_VH continuam os
// mesmos).
const DEFAULT_VH = 40;

// Powers the drag handle at the top of the GIF/emoji picker. On mobile it's
// shown as a bottom sheet (see .sheet-drag-handle in global.css) — drag up
// to grow it, down to shrink it or dismiss, same gesture language as
// WhatsApp/Telegram's own sticker/GIF sheets. The message reaction picker
// (see EmojiPicker's `reaction` variant) also shows this handle on desktop,
// so the same gesture works with a mouse there too — touch uses
// touchmove/touchend on the handle itself, mouse needs window-level
// mousemove/mouseup since the cursor can leave the handle mid-drag. Returns
// the current height (in vh) plus the handlers to spread onto the handle
// element.
export function useSheetDrag(onDismiss, defaultVh = DEFAULT_VH) {
  const [heightVh, setHeightVhState] = useState(defaultVh);
  const heightRef = useRef(defaultVh);
  const dragRef = useRef(null);

  const setHeightVh = (next) => {
    heightRef.current = next;
    setHeightVhState(next);
  };

  const startDrag = (clientY) => {
    dragRef.current = { startY: clientY, startHeight: heightRef.current };
  };
  const moveDrag = (clientY) => {
    if (!dragRef.current) return;
    const deltaY = dragRef.current.startY - clientY; // up = positive
    const deltaVh = (deltaY / window.innerHeight) * 100;
    setHeightVh(Math.min(MAX_VH, Math.max(MIN_VH - 10, dragRef.current.startHeight + deltaVh)));
  };
  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    // Dragged down past the minimum — read as "let go to dismiss", same as
    // swiping a real bottom sheet away, instead of leaving it awkwardly tiny.
    if (heightRef.current < MIN_VH) onDismiss?.();
    else setHeightVh(Math.max(MIN_VH, heightRef.current));
  };

  const onTouchStart = (e) => startDrag(e.touches[0].clientY);
  const onTouchMove = (e) => moveDrag(e.touches[0].clientY);
  const onTouchEnd = () => endDrag();
  const onMouseDown = (e) => { e.preventDefault(); startDrag(e.clientY); };

  useEffect(() => {
    const onMouseMove = (e) => moveDrag(e.clientY);
    const onMouseUp = () => endDrag();
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return { heightVh, dragHandlers: { onTouchStart, onTouchMove, onTouchEnd, onMouseDown } };
}
