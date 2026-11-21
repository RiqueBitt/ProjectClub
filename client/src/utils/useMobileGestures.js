import { useEffect } from 'react';
import { useStore } from '../store/useStore';

// Gestos do celular (≤ 768px):
// - deslizar pra direita a partir da borda esquerda abre a gaveta de canais
//   (onde a coluna vira gaveta, ≤ 600px);
// - deslizar pra esquerda com a gaveta aberta fecha ela (o gesto de abrir
//   a lista de membros pela borda direita continua em MainApp.jsx);
// - segurar o dedo numa mensagem abre o menu dela (o mesmo do clique direito).
// Toques que começam dentro de algo que rola de lado (abas, carrosséis,
// blocos de código) são ignorados pra não brigar com essa rolagem.

const MAX_WIDTH = 768;
const EDGE = 28;
const SWIPE = 60;
const LONG_PRESS_MS = 480;
const MOVE_TOLERANCE = 10;

function inHorizontalScroller(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    if (n.matches?.('input, textarea, [contenteditable="true"], input[type="range"], .no-swipe')) return true;
  }
  return false;
}

export function useMobileGestures() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(`(max-width: ${MAX_WIDTH}px)`);
    // A coluna de canais só vira gaveta de verdade até 600px (ver global.css).
    const drawerMq = window.matchMedia('(max-width: 600px)');
    let start = null;
    let pressTimer = null;
    let longPressFired = false;
    let suppressNativeUntil = 0;

    const clearPress = () => { clearTimeout(pressTimer); pressTimer = null; };

    const onTouchStart = (e) => {
      if (!mq.matches || e.touches.length !== 1) { start = null; clearPress(); return; }
      const t = e.touches[0];
      const target = e.target instanceof Element ? e.target : null;
      start = { x: t.clientX, y: t.clientY, target, scroller: !!target && inHorizontalScroller(target), membersOpen: useStore.getState().mobileMembersOpen };
      longPressFired = false;
      clearPress();
      // Segurar numa mensagem: abre o menu de contexto dela.
      const msg = target?.closest?.('.message[data-message-id]');
      if (msg && !target.closest('a, button, input, textarea, video, audio, [contenteditable="true"]')) {
        pressTimer = setTimeout(() => {
          pressTimer = null;
          longPressFired = true;
          suppressNativeUntil = Date.now() + 900;
          navigator.vibrate?.(12);
          msg.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: start?.x || 0, clientY: start?.y || 0,
          }));
        }, LONG_PRESS_MS);
      }
    };

    const onTouchMove = (e) => {
      if (!start || !pressTimer) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - start.x) > MOVE_TOLERANCE || Math.abs(t.clientY - start.y) > MOVE_TOLERANCE) clearPress();
    };

    const onTouchEnd = (e) => {
      clearPress();
      const s = start;
      start = null;
      if (longPressFired) {
        // Não deixa o "clique" de soltar o dedo acionar nada por baixo do menu.
        if (e.cancelable) e.preventDefault();
        longPressFired = false;
        return;
      }
      if (!s || !drawerMq.matches || s.scroller) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const st = useStore.getState();
      if (s.membersOpen || st.mobileMembersOpen) return; // MainApp.jsx cuida da lista de membros
      const drawerOpen = st.mobileSidebarOpen || st.mobileChannelListOpen;
      if (dx > 0 && !drawerOpen && s.x <= EDGE) st.openMobileChannelList();
      else if (dx < 0 && drawerOpen) st.closeMobileChannelList();
    };

    const onTouchCancel = () => { clearPress(); start = null; longPressFired = false; };

    // Android já dispara "contextmenu" sozinho ao segurar — evita abrir 2x.
    const onNativeContextMenu = (e) => {
      if (!e.isTrusted) return;
      if (Date.now() < suppressNativeUntil) { e.preventDefault(); e.stopPropagation(); return; }
      if (pressTimer) clearPress(); // o próprio sistema já abriu o menu
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: false });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true });
    document.addEventListener('contextmenu', onNativeContextMenu, true);
    return () => {
      clearPress();
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchCancel);
      document.removeEventListener('contextmenu', onNativeContextMenu, true);
    };
  }, []);
}
