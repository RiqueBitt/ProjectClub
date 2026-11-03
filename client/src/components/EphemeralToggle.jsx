import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { setConversationEphemeral } from '../api/endpoints';
import { useStore } from '../store/useStore';
import { usePopoverCoordination } from '../utils/popoverCoordinator';
import { cssZoom } from '../utils/cssZoom';
import ChatIcon from './ChatIcons.jsx';
import '../styles/ephemeral.css';

// "Mensagens temporárias" (Fase 5) — botão do relógio no cabeçalho da DM.
// Desligado / 24 horas / 7 dias. Qualquer participante pode mudar; vale pras
// mensagens novas e uma linha na conversa mostra quem mudou.
export const EPHEMERAL_OPTIONS = [
  { mode: 'off', seconds: null, label: 'Desligado', hint: 'As mensagens ficam até alguém apagar.' },
  { mode: '24h', seconds: 86400, label: '24 horas', hint: 'Mensagens novas somem 24 horas depois de enviadas.' },
  { mode: '7d', seconds: 604800, label: '7 dias', hint: 'Mensagens novas somem 7 dias depois de enviadas.' },
];

export function ephemeralLabel(seconds) {
  return EPHEMERAL_OPTIONS.find((o) => o.seconds === (seconds ?? null))?.label || 'Desligado';
}

export default function EphemeralToggle({ conversation }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  usePopoverCoordination(open, () => setOpen(false));
  const current = conversation?.ephemeralSeconds ?? null;
  const on = current != null;

  useLayoutEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const z = cssZoom();
    const vw = window.innerWidth / z;
    const width = Math.min(300, vw - 16);
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

  if (!conversation?.id) return null;

  const pick = async (opt) => {
    if (busy) return;
    if (opt.seconds === current) { setOpen(false); return; }
    setBusy(true);
    try {
      const { conversation: updated } = await setConversationEphemeral(conversation.id, opt.mode);
      if (updated) useStore.getState().upsertConversation({ id: updated.id, ephemeralSeconds: updated.ephemeralSeconds ?? null });
      setOpen(false);
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível mudar as mensagens temporárias.');
    } finally { setBusy(false); }
  };

  const title = on ? `Mensagens temporárias: ${ephemeralLabel(current)}` : 'Mensagens temporárias: desligado';
  return (
    <>
      <button
        ref={btnRef} type="button"
        className={`icon-btn chat-header-btn ephemeral-btn ${on ? 'is-on' : ''} ${open ? 'on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={title} aria-label={title} aria-expanded={open} aria-haspopup="menu"
      >
        <ChatIcon name="clock" />
        {on && <span className="ephemeral-btn-tag" aria-hidden="true">{current === 86400 ? '24h' : '7d'}</span>}
      </button>
      {open && pos && createPortal(
        <div className="ephemeral-panel" ref={panelRef} style={{ top: pos.top, left: pos.left, width: pos.width }} role="menu" aria-label="Mensagens temporárias">
          <div className="ephemeral-panel-head">
            <ChatIcon name="clock" size={16} />
            <strong>Mensagens temporárias</strong>
          </div>
          <p className="ephemeral-panel-note">Vale para as mensagens novas, para todo mundo na conversa. Quem participa pode mudar — a conversa mostra quem mudou.</p>
          {EPHEMERAL_OPTIONS.map((opt) => {
            const active = opt.seconds === current;
            return (
              <button
                key={opt.mode} type="button" role="menuitemradio" aria-checked={active}
                className={`ephemeral-option ${active ? 'active' : ''}`} disabled={busy} onClick={() => pick(opt)}
              >
                <span className="ephemeral-option-radio" aria-hidden="true" />
                <span className="ephemeral-option-text">
                  <b>{opt.label}</b>
                  <small>{opt.hint}</small>
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

// Relógio pequeno ao lado da hora de uma mensagem temporária.
export function EphemeralMark({ expiresAt }) {
  if (!expiresAt) return null;
  const when = new Date(expiresAt);
  if (Number.isNaN(when.getTime())) return null;
  const label = `Mensagem temporária — some em ${when.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
  return (
    <span className="ephemeral-mark" title={label} aria-label={label} role="img">
      <ChatIcon name="clock" size={12} />
    </span>
  );
}
