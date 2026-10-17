import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useVoice } from '../../context/VoiceContext.jsx';
import { queueRead } from '../../utils/readMarker';
import { matchShortcut, findFrom, isEditableTarget } from './shortcuts';

// Atalhos globais NOVOS (os antigos continuam com os donos de antes —
// ver shortcuts.js). Escuta em captura no window pra que Alt+↑/↓ não
// caia no "↑ edita a última mensagem" do campo de digitar.
const BLOCKING_UI = '.modal-overlay, [role="dialog"][aria-modal="true"], .pc-tour, .pc-sc-overlay, .chat-crop-overlay';

function channelButtons() {
  // Botões de canal da barra lateral, na ordem em que aparecem (os de voz
  // ficam de fora, igual ao Discord).
  return [...document.querySelectorAll('.sidebar-list .channel-item')]
    .filter((b) => !['VOICE', 'STAGE'].includes(b.getAttribute('data-channel-type')) && b.getClientRects().length > 0);
}

export function useGlobalShortcuts({ onOpenShortcuts, shortcutsOpen, onCloseShortcuts }) {
  const voice = useVoice();
  const location = useLocation();
  const navigate = useNavigate();
  const ref = useRef({});
  ref.current = { voice, navigate, pathname: location.pathname, onOpenShortcuts, shortcutsOpen, onCloseShortcuts };

  useEffect(() => {
    const onKeyDown = (e) => {
      const action = matchShortcut(e);
      if (!action) return;
      const st = ref.current;
      if (action === 'shortcuts') {
        e.preventDefault();
        if (st.shortcutsOpen) st.onCloseShortcuts?.();
        else if (!document.querySelector(BLOCKING_UI)) st.onOpenShortcuts?.();
        return;
      }
      if (document.querySelector(BLOCKING_UI)) return;

      if (action === 'toggleMute' || action === 'toggleDeafen') {
        if (!st.voice) return;
        e.preventDefault();
        e.stopPropagation();
        if (action === 'toggleMute') st.voice.toggleMute?.(); else st.voice.toggleDeafen?.();
        return;
      }

      if (action === 'prevChannel' || action === 'nextChannel' || action === 'prevUnread' || action === 'nextUnread') {
        const list = channelButtons();
        if (!list.length) return;
        e.preventDefault();
        e.stopPropagation();
        // Canal atual pela URL (atualiza na hora; a classe .active só no
        // próximo render — apertar rápido duas vezes pulava um canal).
        const openId = (window.location.pathname.match(/^\/channels\/([^/?#]+)/) || [])[1];
        let current = openId ? list.findIndex((b) => b.getAttribute('data-channel-id') === openId) : -1;
        if (current < 0) current = list.findIndex((b) => b.classList.contains('active'));
        const dir = action.startsWith('prev') ? -1 : 1;
        const unreadOnly = action.endsWith('Unread');
        const idx = findFrom(list, current, dir, (b) => !unreadOnly || b.classList.contains('unread') || !!b.querySelector('.mention-badge'));
        if (idx >= 0) {
          const id = list[idx].getAttribute('data-channel-id');
          if (id) st.navigate(`/channels/${id}`); else list[idx].click();
          try { list[idx].scrollIntoView({ block: 'nearest' }); } catch { /* ok */ }
        }
        return;
      }

      if (action === 'markRead') {
        // Esc tem dono em vários lugares (fechar menu, cancelar resposta,
        // sair do modo foco): só marca como lido quando ninguém usou.
        if (e.defaultPrevented) return;
        const s = useStore.getState();
        if (s.quickSwitcherOpen || s.focusMode) return;
        if (document.querySelector('[role="menu"], [role="listbox"], .emoji-picker-panel')) return;
        if (isEditableTarget(e.target) && !e.target.closest?.('.chat-window')) return;
        const ch = st.pathname.match(/^\/channels\/([^/?#]+)/);
        const cv = st.pathname.match(/^\/conversations\/([^/?#]+)/);
        const now = new Date().toISOString();
        if (ch) { queueRead('channel', ch[1], now); s.markChannelReadLocal?.(ch[1]); }
        else if (cv) { queueRead('conversation', cv[1], now); s.markConversationReadLocal?.(cv[1]); }
      }
    };
    // Captura pra Alt+setas; Esc em bolha (precisa ver o defaultPrevented
    // de quem tratou antes) — por isso dois registros.
    const onCapture = (e) => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) onKeyDown(e); };
    const onBubble = (e) => { if (!(e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) onKeyDown(e); };
    window.addEventListener('keydown', onCapture, true);
    window.addEventListener('keydown', onBubble);
    return () => {
      window.removeEventListener('keydown', onCapture, true);
      window.removeEventListener('keydown', onBubble);
    };
  }, []);
}
