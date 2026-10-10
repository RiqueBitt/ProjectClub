import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { togglePinMessage } from '../api/endpoints';
import { useSocket } from '../context/SocketContext.jsx';
import { useStore } from '../store/useStore';
import { useLiveRefresh } from '../utils/liveRefresh';
import { usePopoverCoordination } from '../utils/popoverCoordinator';
import UserAvatar from './UserAvatar.jsx';
import NavIcon from './NavIcons.jsx';
import { cssZoom } from '../utils/cssZoom';
import '../styles/nav.css';

// Mensagens fixadas de um canal/conversa: lista no cabeçalho do chat
// (ícone de alfinete) e a faixa opcional "Destaques" com a mais recente.
// Atualiza sozinho pelo evento de socket `message:pin` (e `message:update`,
// que o servidor já mandava), com o refresh ao vivo como rede de segurança.

const fetchPinned = ({ conversationId, channelId }) => api
  .get('/messages/pinned', { params: { conversationId: conversationId || undefined, channelId: channelId || undefined } })
  .then((r) => r.data?.messages || []);

export function usePinnedMessages({ conversationId, channelId, enabled = true }) {
  const { socket } = useSocket() || {};
  const [pins, setPins] = useState([]);
  const [loading, setLoading] = useState(true);
  const roomRef = useRef(null);
  const roomId = conversationId || channelId;
  roomRef.current = roomId;

  const reload = useCallback(() => {
    if (!enabled || !roomId) return Promise.resolve();
    const asked = roomId;
    return fetchPinned({ conversationId, channelId })
      .then((list) => { if (roomRef.current === asked) setPins(Array.isArray(list) ? list : []); })
      .catch(() => {})
      .finally(() => { if (roomRef.current === asked) setLoading(false); });
  }, [enabled, roomId, conversationId, channelId]);

  useEffect(() => {
    setPins([]);
    setLoading(true);
    reload();
  }, [reload]);

  // Socket: fixou/desafixou aqui (ou uma fixada foi editada/apagada).
  useEffect(() => {
    if (!socket || !enabled) return undefined;
    let t = null;
    const later = () => { clearTimeout(t); t = setTimeout(reload, 250); };
    const sameRoom = (m) => (conversationId ? m?.conversationId === conversationId : m?.channelId === channelId);
    const onPin = (p) => { if (sameRoom(p)) later(); };
    const onUpdate = (m) => {
      if (!sameRoom(m)) return;
      setPins((prev) => {
        const had = prev.some((x) => x.id === m.id);
        if (had || m.pinned) later();
        return had ? prev.map((x) => (x.id === m.id ? { ...x, ...m } : x)) : prev;
      });
    };
    const onDelete = ({ id }) => setPins((prev) => prev.filter((x) => x.id !== id));
    socket.on('message:pin', onPin);
    socket.on('message:update', onUpdate);
    socket.on('message:delete', onDelete);
    return () => {
      clearTimeout(t);
      socket.off('message:pin', onPin);
      socket.off('message:update', onUpdate);
      socket.off('message:delete', onDelete);
    };
  }, [socket, enabled, reload, conversationId, channelId]);

  useLiveRefresh((ctx) => fetchPinned({ conversationId, channelId }).then((list) => ctx.put(setPins)(list)), {
    enabled: enabled && !!roomId, key: roomId,
  });

  return { pins: pins.filter((p) => p.pinned !== false && !p.deleted), loading, reload, setPins };
}

function snippetOf(m) {
  if (m.content) return m.content.length > 220 ? `${m.content.slice(0, 220)}…` : m.content;
  if (m.stickerUrl) return 'Figurinha';
  if (m.poll) return 'Enquete';
  if (m.attachments?.length) return m.attachments.length === 1 ? 'Anexo' : `${m.attachments.length} anexos`;
  return 'Mensagem';
}

function whenOf(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `Hoje às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

// Botão do alfinete no cabeçalho + painel com a lista.
export function PinnedButton({ pins, loading, canUnpin, onJump, onUnpinned, open, setOpen }) {
  usePopoverCoordination(open, () => setOpen(false));
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const z = cssZoom();
    const vw = window.innerWidth / z;
    const width = Math.min(420, vw - 16);
    const left = Math.max(8, Math.min(r.right / z - width, vw - width - 8));
    setPos({ top: r.bottom / z + 8, left, width });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unpin = async (m) => {
    try {
      await togglePinMessage(m.id);
      onUnpinned?.(m.id);
    } catch {
      useStore.getState().pushNotice('Não foi possível desafixar esta mensagem.');
    }
  };

  return (
    <>
      <button
        ref={btnRef} type="button"
        className={`icon-btn chat-header-btn pins-btn ${open ? 'on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Mensagens fixadas" aria-label="Mensagens fixadas" aria-expanded={open}
      >
        <NavIcon name="pin" size={19} />
        {pins.length > 0 && <span className="pins-btn-count">{pins.length > 9 ? '9+' : pins.length}</span>}
      </button>
      {open && pos && createPortal(
        <div className="pins-panel" ref={panelRef} style={{ top: pos.top, left: pos.left, width: pos.width }} role="dialog" aria-label="Mensagens fixadas">
          <div className="pins-panel-head">
            <span className="pins-panel-head-icon"><NavIcon name="pin" size={16} /></span>
            <strong>Mensagens fixadas</strong>
            {pins.length > 0 && <span className="pins-panel-count">{pins.length}</span>}
            <button type="button" className="pins-panel-close" onClick={() => setOpen(false)} aria-label="Fechar"><NavIcon name="close" size={15} /></button>
          </div>
          <div className="pins-panel-list">
            {loading && pins.length === 0 && (
              <div className="pins-skeleton" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} />)}</div>
            )}
            {!loading && pins.length === 0 && (
              <div className="pins-empty">
                <span className="pins-empty-icon"><NavIcon name="pin" size={22} /></span>
                <strong>Nada fixado ainda</strong>
                <span>Clique com o botão direito numa mensagem e escolha “Fixar” pra guardar aqui.</span>
              </div>
            )}
            {pins.map((m) => (
              <div key={m.id} className="pins-item">
                <UserAvatar user={m.author} size={32} />
                <div className="pins-item-body">
                  <div className="pins-item-meta">
                    <strong className="truncate">{m.author?.displayName || 'Alguém'}</strong>
                    <span>{whenOf(m.createdAt)}</span>
                  </div>
                  <p className="pins-item-text">{snippetOf(m)}</p>
                  <div className="pins-item-actions">
                    <button type="button" onClick={() => { setOpen(false); onJump?.(m); }}>Ir até a mensagem</button>
                    {canUnpin && <button type="button" className="danger" onClick={() => unpin(m)}>Desafixar</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// Faixa "Destaques": a fixada mais recente, dispensável (volta quando
// alguém fixar outra).
export function PinnedStrip({ roomKey, pins, onJump, onOpenList }) {
  const latest = pins[0];
  const storageKey = `pinStripDismissed:${roomKey}`;
  const [dismissedId, setDismissedId] = useState(() => {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  });
  useEffect(() => {
    try { setDismissedId(localStorage.getItem(storageKey)); } catch { setDismissedId(null); }
  }, [storageKey]);

  if (!latest || dismissedId === latest.id) return null;
  const dismiss = () => {
    try { localStorage.setItem(storageKey, latest.id); } catch { /* sem localStorage */ }
    setDismissedId(latest.id);
  };
  return (
    <div className="pins-strip" role="note">
      <button type="button" className="pins-strip-main" onClick={() => onJump?.(latest)} title="Ir até a mensagem">
        <span className="pins-strip-icon"><NavIcon name="pin" size={15} /></span>
        <span className="pins-strip-label">Destaques</span>
        <span className="pins-strip-text truncate"><b>{latest.author?.displayName || 'Alguém'}:</b> {snippetOf(latest)}</span>
      </button>
      {pins.length > 1 && (
        <button type="button" className="pins-strip-more" onClick={onOpenList}>+{pins.length - 1}</button>
      )}
      <button type="button" className="pins-strip-close" onClick={dismiss} title="Esconder destaque" aria-label="Esconder destaque"><NavIcon name="close" size={14} /></button>
    </div>
  );
}
