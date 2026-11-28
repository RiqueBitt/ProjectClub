import { useLayoutEffect, useState } from 'react';

// Marcador que desliza até o item ativo de uma fileira (abas, filtros).
// Devolve o style do marcador: posição e tamanho do item que tem `selector`
// dentro do `ref`. Remede quando a fileira muda de tamanho.
export function useSlidingPill(ref, selector, deps = []) {
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const wrap = ref.current;
    if (!wrap) return undefined;
    const measure = () => {
      const el = wrap.querySelector(selector);
      if (!el) { setBox(null); return; }
      const next = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      setBox((cur) => (cur && cur.x === next.x && cur.y === next.y && cur.w === next.w && cur.h === next.h ? cur : next));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(wrap);
    return () => ro?.disconnect();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return box ? { transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h, opacity: 1 } : { opacity: 0 };
}
