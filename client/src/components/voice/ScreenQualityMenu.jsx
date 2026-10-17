import { useEffect, useRef, useState } from 'react';
import { usePopoverCoordination } from '../../utils/popoverCoordinator';
import CallIcon from './CallIcons.jsx';

// Qualidade da transmissão de tela, trocada AO VIVO (sem parar de
// transmitir). Usa setScreenShareQuality do VoiceContext, que aplica a
// resolução/fps na faixa da tela pelo engine e lembra a escolha.
// Mesma tabela do motor (voice/screenPresets.js). Cada troca muda a
// captura (applyConstraints), o contentHint e o bitrate/fps das 2 camadas do
// simulcast (setParameters) — e fica lembrada pra próxima transmissão.
const RESOLUTIONS = ['720p', '1080p', '1440p'];
const FRAME_RATES = [5, 15, 30, 60];

export default function ScreenQualityMenu({ voice, className = '', placement = 'up' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  usePopoverCoordination(open, () => setOpen(false));
  const wrapRef = useRef(null);
  const current = voice?.screenQuality || { quality: '720p', frameRate: 30 };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = async (patch) => {
    if (busy) return;
    setBusy(true);
    try { await voice.setScreenShareQuality({ ...current, ...patch }); } finally { setBusy(false); }
  };

  return (
    <div ref={wrapRef} className={`sqm ${className}${open ? ' is-open' : ''}`}>
      <button
        type="button" className="sqm-toggle" onClick={() => setOpen((v) => !v)}
        aria-label="Qualidade da transmissão" aria-expanded={open} data-tip="Qualidade da transmissão"
      >
        <CallIcon name={placement === 'up' ? 'caretUp' : 'caret'} size={14} strokeWidth={2.4} />
      </button>
      {open && (
        <div className={`sqm-pop sqm-pop-${placement}`} role="dialog" aria-label="Qualidade da transmissão">
          <div className="sqm-head">
            <CallIcon name="quality" size={16} />
            <strong>Qualidade da transmissão</strong>
          </div>
          <div className="sqm-label">Resolução</div>
          <div className="sqm-seg" role="radiogroup" aria-label="Resolução">
            {RESOLUTIONS.map((q) => (
              <button
                key={q} type="button" role="radio" aria-checked={current.quality === q}
                className={current.quality === q ? 'is-on' : ''} disabled={busy}
                onClick={() => pick({ quality: q })}
              >
                {q}
              </button>
            ))}
          </div>
          <div className="sqm-label">Quadros por segundo</div>
          <div className="sqm-seg" role="radiogroup" aria-label="Quadros por segundo">
            {FRAME_RATES.map((f) => (
              <button
                key={f} type="button" role="radio" aria-checked={current.frameRate === f}
                className={current.frameRate === f ? 'is-on' : ''} disabled={busy}
                onClick={() => pick({ frameRate: f })}
              >
                {f} FPS
              </button>
            ))}
          </div>
          <p className="sqm-note">A mudança vale na hora, sem parar a transmissão.</p>
        </div>
      )}
    </div>
  );
}
