import { useEffect, useRef } from 'react';
import { cssZoom } from './cssZoom';
import {
  swipeAxis, swipeOffset, swipeProgress, swipeShouldReply, SWIPE_EDGE,
} from './swipeReplyCore';

// "Arrastar pra responder" no celular/tablet: arrastar uma mensagem pra
// DIREITA (~60px) mostra o ícone de resposta, dá uma vibração leve e, ao
// soltar, abre a resposta pra ela — igual ao WhatsApp/Discord mobile.
//
// Convive com os outros gestos:
//  - começar colado na borda esquerda é o gesto de abrir a gaveta de
//    canais (useMobileGestures.js) — aqui é ignorado;
//  - rolagem vertical: o gesto só "trava" na horizontal quando o dedo anda
//    claramente pro lado (senão é rolagem e a gente solta). O CSS põe
//    `touch-action: pan-y` nas mensagens, então o navegador continua
//    rolando na vertical sozinho;
//  - segurar o dedo (menu da mensagem) é cancelado pelo próprio
//    useMobileGestures quando o dedo se mexe;
//  - modais param a propagação dos toques (Modal.jsx), e o que rola de lado
//    (blocos de código, carrosséis), campos de texto e .no-swipe ficam de fora.
//
// onReplyById(messageId) é chamado quando o gesto completa.

const SKIP_SELECTOR = 'input, textarea, select, [contenteditable="true"], video, audio, input[type="range"], .no-swipe, .edit-box, .message-hover-actions, .reaction-picker-popover';

function inHorizontalScroller(el, stopAt) {
  for (let n = el; n && n !== stopAt && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

const isTouchDevice = () => typeof window !== 'undefined'
  && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);

export function useSwipeToReply(listRef, onReplyById, enabled = true) {
  const onReplyRef = useRef(onReplyById);
  onReplyRef.current = onReplyById;

  useEffect(() => {
    const list = listRef.current;
    if (!enabled || !list || !isTouchDevice()) return undefined;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // Um único ícone flutuante, reaproveitado (não re-renderiza o chat a cada pixel).
    const icon = document.createElement('div');
    icon.className = 'swipe-reply-indicator';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
    document.body.appendChild(icon);

    let g = null; // gesto em andamento

    const reset = (animate) => {
      if (!g) return;
      const { el } = g;
      if (el) {
        el.style.transition = animate && !reduceMotion ? 'transform .18s ease' : '';
        el.style.transform = '';
        el.classList.remove('is-swiping');
        if (animate && !reduceMotion) setTimeout(() => { el.style.transition = ''; }, 200);
      }
      icon.classList.remove('visible', 'ready');
      g = null;
    };

    const onStart = (e) => {
      if (e.touches.length !== 1) { reset(false); return; }
      const t = e.touches[0];
      const target = e.target instanceof Element ? e.target : null;
      const el = target?.closest?.('.message[data-message-id]');
      if (!el || !list.contains(el) || t.clientX <= SWIPE_EDGE) return;
      const id = el.getAttribute('data-message-id');
      if (!id || id.startsWith('temp-')) return;
      if (target.closest(SKIP_SELECTOR) || inHorizontalScroller(target, list)) return;
      if (window.getSelection?.()?.toString()) return; // selecionando texto
      g = { el, id, x: t.clientX, y: t.clientY, axis: null, dx: 0, buzzed: false };
    };

    const onMove = (e) => {
      if (!g) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (!g.axis) {
        g.axis = swipeAxis(dx, dy);
        if (g.axis === 'y') { g = null; return; }
        if (!g.axis) return;
        g.el.classList.add('is-swiping');
        g.el.style.transition = '';
        // Posição do ícone: à esquerda da mensagem, no meio da parte visível.
        const z = cssZoom() || 1;
        const r = g.el.getBoundingClientRect();
        const top = Math.max(r.top, 0) + Math.min(r.height, window.innerHeight - Math.max(r.top, 0)) / 2;
        icon.style.top = `${top / z}px`;
        icon.style.left = `${(r.left + 10) / z}px`;
        icon.classList.add('visible');
      }
      g.dx = dx;
      const off = swipeOffset(dx);
      g.el.style.transform = off ? `translateX(${off}px)` : '';
      const p = swipeProgress(dx);
      icon.style.setProperty('--swipe-p', String(p));
      const ready = swipeShouldReply(dx);
      icon.classList.toggle('ready', ready);
      // Vibração leve ao cruzar o ponto de responder (uma vez por gesto).
      if (ready && !g.buzzed) { g.buzzed = true; try { navigator.vibrate?.(10); } catch { /* sem vibração */ } }
      if (!ready) g.buzzed = false;
    };

    const onEnd = () => {
      if (!g) return;
      const done = g.axis === 'x' && swipeShouldReply(g.dx);
      const { id } = g;
      reset(true);
      if (done) onReplyRef.current?.(id);
    };
    const onCancel = () => reset(true);

    list.addEventListener('touchstart', onStart, { passive: true });
    list.addEventListener('touchmove', onMove, { passive: true });
    list.addEventListener('touchend', onEnd, { passive: true });
    list.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      reset(false);
      list.removeEventListener('touchstart', onStart);
      list.removeEventListener('touchmove', onMove);
      list.removeEventListener('touchend', onEnd);
      list.removeEventListener('touchcancel', onCancel);
      icon.remove();
    };
  }, [listRef, enabled]);
}
