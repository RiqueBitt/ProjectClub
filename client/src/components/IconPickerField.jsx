import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import EmojiPicker from './EmojiPicker.jsx';
import { useStore } from '../store/useStore';
import { usePopoverCoordination } from '../utils/popoverCoordinator';
import { proxyImage } from '../utils/imageProxy';

// Campo "Ícone" dos modais de canal e categoria: emoji (Unicode ou
// personalizado da comunidade), imagem pequena enviada, ou nenhum (volta
// pro ícone padrão). O valor é { iconEmoji, iconUrl, file, previewUrl }.
// Imagem nova só sobe de verdade quando o modal salva (ver saveIcon).

const QUICK = ['💬', '📢', '🎮', '🎵', '📸', '🎉', '⭐', '🔥', '🛠️', '📚'];
const MAX_BYTES = 1024 * 1024;
const ACCEPT = 'image/png,image/gif,image/webp';

export function iconValueFrom(item) {
  return { iconEmoji: item?.iconEmoji || null, iconUrl: item?.iconUrl || null, file: null, previewUrl: null };
}

export function iconChanged(initial, value) {
  return !!value.file || (initial.iconEmoji || null) !== (value.iconEmoji || null) || (initial.iconUrl || null) !== (value.iconUrl || null);
}

// Salva o ícone depois que o canal/categoria existe: imagem nova → upload;
// emoji/remover → PATCH com os dois campos.
export async function saveIcon({ id, initial, value, update, upload }) {
  if (!iconChanged(initial, value)) return;
  if (value.file) { await upload(id, value.file); return; }
  await update(id, { iconEmoji: value.iconEmoji || null, iconUrl: value.iconEmoji ? null : (value.iconUrl || null) });
}

function DefaultGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function IconPickerField({ value, onChange, label = 'ÍCONE', defaultIcon = null, hint }) {
  const usableEmojis = useStore((s) => s.usableEmojis);
  const [pickerOpen, setPickerOpen] = useState(false);
  usePopoverCoordination(pickerOpen, () => setPickerOpen(false));
  const [pickerStyle, setPickerStyle] = useState(null);
  const [error, setError] = useState('');
  const moreRef = useRef(null);
  const pickerRef = useRef(null);
  const fileRef = useRef(null);

  // Mesmo posicionamento do seletor do status personalizado: abre acima
  // ou abaixo do botão, conforme o espaço; no celular vira folha de baixo.
  useEffect(() => {
    if (!pickerOpen) { setPickerStyle(null); return; }
    if (window.matchMedia('(max-width: 600px)').matches) { setPickerStyle(null); return; }
    const rect = moreRef.current?.getBoundingClientRect();
    if (!rect) return;
    const h = Math.min(window.innerHeight * 0.46, window.innerHeight - 24);
    let top = rect.top - h - 8;
    if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - h - 8);
    setPickerStyle({ position: 'fixed', top: `${Math.max(8, top)}px` });
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e) => {
      if (pickerRef.current?.contains(e.target) || moreRef.current?.contains(e.target)) return;
      setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [pickerOpen]);

  // Libera a prévia local da imagem quando ela sai de cena.
  useEffect(() => () => { if (value.previewUrl) URL.revokeObjectURL(value.previewUrl); }, [value.previewUrl]);

  const pickEmoji = (picked) => {
    setError('');
    const custom = /^:([a-zA-Z0-9_]+):$/.exec(picked || '');
    if (custom) {
      const emoji = usableEmojis.find((e) => e.name === custom[1]);
      if (emoji) onChange({ iconEmoji: null, iconUrl: emoji.url, file: null, previewUrl: null });
    } else if (picked) {
      onChange({ iconEmoji: picked, iconUrl: null, file: null, previewUrl: null });
    }
    setPickerOpen(false);
  };

  const pickFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|gif|webp)$/i.test(file.type)) { setError('Use uma imagem PNG, GIF ou WebP.'); return; }
    if (file.size > MAX_BYTES) { setError('Imagem grande demais (máximo 1 MB).'); return; }
    setError('');
    onChange({ iconEmoji: null, iconUrl: null, file, previewUrl: URL.createObjectURL(file) });
  };

  const clear = () => { setError(''); onChange({ iconEmoji: null, iconUrl: null, file: null, previewUrl: null }); };

  const hasIcon = !!(value.iconEmoji || value.iconUrl || value.file);
  const imgSrc = value.previewUrl || (value.iconUrl ? proxyImage(value.iconUrl) : null);

  return (
    <div className="icon-field">
      <span className="icon-field-label">{label}</span>
      <div className="icon-field-row">
        <div className={`icon-field-preview${hasIcon ? ' has-icon' : ''}`} aria-label="Prévia do ícone">
          {imgSrc ? <img src={imgSrc} alt="" /> : value.iconEmoji ? <span className="icon-field-emoji">{value.iconEmoji}</span> : (defaultIcon || <DefaultGlyph />)}
        </div>
        <div className="icon-field-controls">
          <div className="icon-field-quick" role="group" aria-label="Emojis rápidos">
            {QUICK.map((e) => (
              <button
                key={e} type="button" className={`icon-field-quick-btn${value.iconEmoji === e ? ' active' : ''}`}
                onClick={() => pickEmoji(e)} title={`Usar ${e}`}
              >{e}</button>
            ))}
          </div>
          <div className="icon-field-actions">
            <button ref={moreRef} type="button" className="icon-field-btn" onClick={() => setPickerOpen((v) => !v)}>
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2M9 9.5h.01M15 9.5h.01" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
              Mais emojis
            </button>
            <button type="button" className="icon-field-btn" onClick={() => fileRef.current?.click()}>
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M5 20h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Enviar imagem
            </button>
            <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={pickFile} />
            {hasIcon && (
              <button type="button" className="icon-field-btn icon-field-btn-danger" onClick={clear}>
                <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
                Remover
              </button>
            )}
          </div>
        </div>
      </div>
      {error ? <span className="icon-field-error">{error}</span> : <span className="icon-field-hint">{hint || 'Emoji ou imagem PNG, GIF ou WebP de até 1 MB. Sem ícone, fica o padrão.'}</span>}
      {pickerOpen && createPortal(
        <div ref={pickerRef} style={{ display: 'contents' }}>
          <EmojiPicker variant="reaction" serverEmojis={usableEmojis} style={pickerStyle || {}} onPick={pickEmoji} onClose={() => setPickerOpen(false)} />
        </div>,
        document.body,
      )}
    </div>
  );
}
