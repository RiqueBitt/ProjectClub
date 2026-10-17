import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from '../Modal.jsx';
import EmojiPicker from '../EmojiPicker.jsx';
import { usePopoverCoordination } from '../../utils/popoverCoordinator';
import { useStore } from '../../store/useStore';
import { setCustomStatus } from '../../api/endpoints';
import { STATUS_DURATIONS, statusExpiryPayload, describeStatusExpiry } from '../../utils/chatFeatures';
import StatusEmoji from '../StatusEmoji.jsx';

const QUICK_EMOJIS = ['💬', '🎮', '🎧', '📚', '💻', '😴', '🍕', '☕', '🚀', '❤️'];
// Sugestões de um clique (emoji + texto), igual ao Discord.
const PRESETS = [
  { emoji: '📅', text: 'Em reunião', duration: '1h' },
  { emoji: '🎮', text: 'Jogando', duration: '4h' },
  { emoji: '📚', text: 'Estudando', duration: '4h' },
  { emoji: '🍕', text: 'Almoçando', duration: '30m' },
  { emoji: '🤒', text: 'Doente', duration: 'today' },
  { emoji: '🏖️', text: 'De férias', duration: 'never' },
];

export default function CustomStatusModal({ user, onClose, onSaved }) {
  const [text, setText] = useState(user.customStatus || '');
  const [emoji, setEmoji] = useState(user.customStatusEmoji || '');
  // Opção de expiração (STATUS_DURATIONS): 30m, 1h, 4h, hoje, nunca.
  const [duration, setDuration] = useState('today');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const currentExpiry = describeStatusExpiry(user.customStatusExpiresAt);
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

  const run = async (payload) => {
    setSaving(true);
    setError('');
    try {
      const { user: updated } = await setCustomStatus(payload);
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || 'Não deu pra salvar o status. Tente de novo.');
      setSaving(false);
    }
  };
  const save = () => run({ text: text.trim() || null, emoji: emoji || null, ...statusExpiryPayload(duration) });
  const clear = () => run({ text: null, emoji: null, durationMinutes: null });
  const applyPreset = (p) => { setEmoji(p.emoji); setText(p.text); setDuration(p.duration); };
  const hasStatus = !!(text.trim() || emoji);
  const previewExpiresAt = (() => {
    const p = statusExpiryPayload(duration);
    if (p.expiresAt) return p.expiresAt;
    return p.durationMinutes ? new Date(Date.now() + p.durationMinutes * 60000).toISOString() : null;
  })();

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

        {!text && !emoji && (
          <div className="custom-status-presets" aria-label="Sugestões">
            {PRESETS.map((p) => (
              <button key={p.text} type="button" className="custom-status-preset" onClick={() => applyPreset(p)}>
                <span aria-hidden="true">{p.emoji}</span> {p.text}
              </button>
            ))}
          </div>
        )}

        <fieldset className="custom-status-durations">
          <legend>Limpar status após</legend>
          <div className="custom-status-chips" role="radiogroup" aria-label="Limpar status após">
            {STATUS_DURATIONS.map((d) => (
              <button
                key={d.id} type="button" role="radio" aria-checked={duration === d.id}
                className={`custom-status-chip ${duration === d.id ? 'on' : ''}`}
                onClick={() => setDuration(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </fieldset>

        {hasStatus && (
          <div className="custom-status-preview" aria-live="polite">
            <span className="custom-status-preview-label">Prévia</span>
            <span className="custom-status-preview-bubble">
              {emoji && <StatusEmoji emoji={emoji} />} {text.trim() || <i>sem texto</i>}
            </span>
            <small>{describeStatusExpiry(previewExpiresAt) || 'Fica até você limpar'}</small>
          </div>
        )}
        {currentExpiry && <p className="custom-status-current">Status atual: {currentExpiry.toLowerCase()}.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button className="btn-link" onClick={clear} disabled={saving}>Limpar status</button>
          <button className="btn-primary" onClick={save} disabled={saving || !hasStatus}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </Modal>
  );
}
