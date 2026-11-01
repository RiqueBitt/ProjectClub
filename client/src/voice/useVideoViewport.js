// Conta pro engine ONDE um vídeo remoto aparece: se o bloco está visível
// (IntersectionObserver) e com que altura (ResizeObserver). O engine pausa
// no servidor o vídeo que ninguém está vendo e escolhe a camada do
// simulcast pelo tamanho (ver voice/screenPresets.js → viewportDecision).
//
//   const ref = useRef(null);
//   useVideoViewport(ref, { uid, kind: 'screen', report: voice.reportVideoViewport });
//
// Sem os observers (navegador antigo): só informa "visível" com a altura do
// momento — nunca pausa por engano.
import { useEffect } from 'react';

let seq = 0;
const SETTLE_MS = 150; // agrupa rajadas de resize/scroll num aviso só

export function useVideoViewport(ref, { uid, kind = 'camera', report, enabled = true } = {}) {
  useEffect(() => {
    const el = ref?.current;
    if (!enabled || !uid || typeof report !== 'function' || !el) return undefined;
    seq += 1;
    const viewId = `vp${seq}`;
    let visible = true;
    let height = Math.round(el.clientHeight || 0);
    let timer = null;
    const push = () => {
      timer = null;
      try { report(uid, kind, viewId, { visible, height }); } catch { /* engine trocou */ }
    };
    const schedule = () => { if (!timer) timer = setTimeout(push, SETTLE_MS); };
    let io = null; let ro = null;
    try {
      if (typeof IntersectionObserver === 'function') {
        io = new IntersectionObserver((entries) => {
          for (const e of entries) visible = !!e.isIntersecting;
          schedule();
        }, { threshold: 0 });
        io.observe(el);
      }
    } catch { io = null; }
    try {
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver((entries) => {
          for (const e of entries) height = Math.round(e.contentRect?.height || el.clientHeight || 0);
          schedule();
        });
        ro.observe(el);
      }
    } catch { ro = null; }
    push();
    return () => {
      clearTimeout(timer);
      try { io?.disconnect(); } catch { /* ok */ }
      try { ro?.disconnect(); } catch { /* ok */ }
      try { report(uid, kind, viewId, { remove: true }); } catch { /* ok */ }
    };
  }, [ref, uid, kind, report, enabled]);
}

export default useVideoViewport;
