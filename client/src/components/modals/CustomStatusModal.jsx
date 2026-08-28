import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from '../Modal.jsx';
import EmojiPicker from '../EmojiPicker.jsx';
import { usePopoverCoordination } from '../../utils/popoverCoordinator';
import { useStore } from '../../store/useStore';
import { setCustomStatus } from '../../api/endpoints';

const QUICK_EMOJIS = ['💬', '🎮', '🎧', '📚', '💻', '😴', '🍕', '☕', '🚀', '❤️'];
const DURATIONS = [
  { label: 'Não limpar', value: null },
  { label: '30 minutos', value: 30 },
  { label: '1 hora', value: 60 },
  { label: '4 horas', value: 240 },
  { label: 'Hoje (24 horas)', value: 1440 },
];

export default function CustomStatusModal({ user, onClose, onSaved }) {
  const [text, setText] = useState(user.customStatus || '');
  const [emoji, setEmoji] = useState(user.customStatusEmoji || '');
  const [duration, setDuration] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  usePopoverCoordination(pickerOpen, () => setPickerOpen(false));
  const [pickerStyle, setPickerStyle] = useState(null);
  const moreBtnRef = useRef(null);
  const pickerRef = useRef(null);
  const usableEmojis = useStore((s) => s.usableEmojis);

  const pickEmoji = (value) => {
    // Only one emoji/custom emoji allowed on a status at a time — picking
    // a new one always replaces whatever was there, never appends.
    setEmoji(value);
    setPickerOpen(false);
  };

  // Bug fix: this used to render the picker with no computed position at
  // all — it fell back to the base `.emoji-picker-popover` rule's
  // `bottom: 44px; right: 0` (meant for the message composer's own anchor),
  // which combined with the "reaction" variant's `position: fixed; left:
  // 50%` in a way that made the popover appear to open and immediately
  // vanish. Same fix as the message reaction picker: measure the "+"
  // button's actual position and flip above/below depending on available
  // room, and close on an actual outside click instead of nothing at all.
  useEffect(() => {
    if (!pickerOpen) { setPickerStyle(null); return; }
    if (window.matchMedia('(max-width: 600px)').matches) { setPickerStyle(null); return; }
    const btn = moreBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const estimatedHeight = Math.min(window.innerHeight * 0.46, window.innerHeight - 24);
    let top = rect.top - estimatedHeight - 8;
    if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - estimatedHeight - 8);
    setPickerStyle({ position: 'fixed', top: `${Math.max(8, top)}px` });
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDocDown = (e) => {
      if (pickerRef.current?.contains(e.target) || moreBtnRef.current?.contains(e.target)) return;
      setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('touchstart', onDocDown);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('touchstart', onDocDown);
    };
  }, [pickerOpen]);

  const save = async () => {
    const { user: updated } = await setCustomStatus({ text: text || null, emoji: emoji || null, durationMinutes: duration });
    onSaved(updated);
    onClose();
  };

  const clear = async () => {
    const { user: updated } = await setCustomStatus({ text: null, emoji: null, durationMinutes: null });
    onSaved(updated);
    onClose();
  };

  return (
    <Modal title="Definir status personalizado" onClose={onClose} width="420px">
      <div className="custom-status-form">
        <div className="custom-status-input-row">
          <div className="emoji-quick-row">
            {QUICK_EMOJIS.map((e) => (
              <button key={e} type="button" className={`emoji-quick-btn ${emoji === e ? 'active' : ''}`} onClick={() => setEmoji(emoji === e ? '' : e)}>{e}</button>
            ))}
            <div className="composer-picker-anchor">
              <button ref={moreBtnRef} type="button" className="emoji-quick-btn emoji-quick-more" title="Mais emojis (inclusive personalizados)" onClick={() => setPickerOpen((v) => !v)}>+</button>
              {pickerOpen && createPortal(
                <div ref={pickerRef} style={{ display: 'contents' }}>
                  <EmojiPicker
                    variant="reaction"
                    serverEmojis={usableEmojis}
                    style={pickerStyle || {}}
                    onPick={pickEmoji}
                    onClose={() => setPickerOpen(false)}
                  />
                </div>,
                document.body,
              )}
            </div>
          </div>
          <input
            placeholder="O que está acontecendo?"
            value={text}
            maxLength={128}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        <label>
          LIMPAR STATUS APÓS
          <select value={duration ?? ''} onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : null)}>
            {DURATIONS.map((d) => (
              <option key={d.label} value={d.value ?? ''}>{d.label}</option>
            ))}
          </select>
        </label>

        <div className="modal-actions">
          <button className="btn-link" onClick={clear}>Limpar status</button>
          <button className="btn-primary" onClick={save}>Salvar</button>
        </div>
      </div>
    </Modal>
  );
}
