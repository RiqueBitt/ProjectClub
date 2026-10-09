import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import PageIcon from '../PageIcons.jsx';

// Menu "Transmitir tela": escolhe o perfil (ou ajusta qualidade/FPS à mão)
// e se o som do computador vai junto. Depois disso o seletor de tela/janela
// do app de PC (ou do navegador) abre para escolher O QUE transmitir.
//
// BUG CORRIGIDO ("abre o menu e nada funciona"): esse menu era desenhado
// dentro da barra de controles da chamada, que tem pointer-events: none
// (pra não bloquear a tela por baixo). O menu herdava isso — aparecia, mas
// nenhum clique funcionava. Agora ele é desenhado direto no <body>.
const PRESETS = [
  { key: 'text', icon: 'doc', title: 'Texto e slides', hint: 'Mais nítido, 15 FPS', quality: '1080p', frameRate: 15 },
  { key: 'balanced', icon: 'scale', title: 'Equilibrado', hint: '720p, 30 FPS', quality: '720p', frameRate: 30 },
  { key: 'games', icon: 'gamepad', title: 'Jogos e vídeos', hint: '1080p, 60 FPS', quality: '1080p', frameRate: 60 },
];
const QUALITIES = ['720p', '1080p'];
const FPS = [15, 30, 60];
const STORAGE_KEY = 'screenShareOptions';

function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && QUALITIES.includes(saved.quality) && FPS.includes(saved.frameRate)) return saved;
  } catch { /* sem storage */ }
  return { quality: '720p', frameRate: 30, audio: true };
}

export default function ScreenShareModal({ onClose, onShare }) {
  const [opts, setOpts] = useState(loadSaved);
  const isDesktopApp = typeof window !== 'undefined' && !!window.electronAPI;
  const activePreset = PRESETS.find((p) => p.quality === opts.quality && p.frameRate === opts.frameRate)?.key;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (patch) => setOpts((o) => ({ ...o, ...patch }));

  const share = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(opts)); } catch { /* sem storage */ }
    onClose();
    onShare({ quality: opts.quality, frameRate: opts.frameRate, audio: opts.audio });
  };

  return createPortal(
    <div className="ssm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ssm" role="dialog" aria-modal="true" aria-labelledby="ssm-title">
        <header className="ssm-head">
          <span className="ssm-head-icon"><PageIcon name="monitor" size={22} /></span>
          <div>
            <h2 id="ssm-title">Transmitir tela</h2>
            <p>Escolha a qualidade. Depois você seleciona a tela ou a janela.</p>
          </div>
          <button type="button" className="ssm-close" onClick={onClose} aria-label="Fechar"><PageIcon name="close" size={18} /></button>
        </header>

        <div className="ssm-body">
          <div className="ssm-presets" role="radiogroup" aria-label="Perfil de qualidade">
            {PRESETS.map((p) => (
              <button
                key={p.key} type="button" role="radio" aria-checked={activePreset === p.key}
                className={`ssm-preset${activePreset === p.key ? ' active' : ''}`}
                onClick={() => set({ quality: p.quality, frameRate: p.frameRate })}
              >
                <span className="ssm-preset-icon"><PageIcon name={p.icon} size={20} /></span>
                <strong>{p.title}</strong>
                <small>{p.hint}</small>
              </button>
            ))}
          </div>

          <div className="ssm-row">
            <span className="ssm-label">Resolução</span>
            <div className="ssm-seg">
              {QUALITIES.map((q) => (
                <button key={q} type="button" className={opts.quality === q ? 'active' : ''} onClick={() => set({ quality: q })}>{q}</button>
              ))}
            </div>
          </div>
          <div className="ssm-row">
            <span className="ssm-label">Quadros por segundo</span>
            <div className="ssm-seg">
              {FPS.map((f) => (
                <button key={f} type="button" className={opts.frameRate === f ? 'active' : ''} onClick={() => set({ frameRate: f })}>{f} FPS</button>
              ))}
            </div>
          </div>

          <label className="ssm-toggle">
            <span className="ssm-toggle-icon"><PageIcon name="volume" size={18} /></span>
            <span className="ssm-toggle-text">
              <strong>Incluir som do computador</strong>
              <small>{isDesktopApp ? 'O som do PC vai junto com a imagem.' : 'Marque "compartilhar áudio" no seletor do navegador.'}</small>
            </span>
            <input type="checkbox" checked={opts.audio} onChange={(e) => set({ audio: e.target.checked })} />
            <span className="ssm-switch" aria-hidden="true" />
          </label>

          {opts.frameRate === 60 && opts.quality === '1080p' && (
            <p className="ssm-note">1080p a 60 FPS usa bastante internet. Se travar para quem assiste, troque para 720p.</p>
          )}
        </div>

        <footer className="ssm-foot">
          <button type="button" className="ssm-cancel" onClick={onClose}>Cancelar</button>
          <button type="button" className="ssm-go" onClick={share} autoFocus>
            <PageIcon name="monitor" size={17} /> Escolher tela
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
