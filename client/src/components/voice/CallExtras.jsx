import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { QUICK_REACTIONS, getVoicePref, onVoicePrefsChange } from '../../utils/voicePrefs';
import '../../styles/call-extras.css';

// Extras da tela de chamada (self-service, só mexem na SUA experiência):
//  I. Reações rápidas — barra de emojis + camada de emojis flutuantes.
//  N. Gravação com consentimento — aviso de pedido + faixa "🔴 Gravando".
//  K. Legendas ao vivo (pt-BR) do seu próprio microfone.

// ---------- Reações rápidas (I) ----------

// Barra com os 5 emojis. Clicar manda a reação pra todo mundo (o próprio
// VoiceContext já limita o ritmo pra não virar spam).
export function ReactionBar({ voice }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div className={`ce-reactbar${open ? ' open' : ''}`} ref={wrapRef}>
      <button
        type="button" className="vc-ctrl ce-reactbar-toggle" aria-label="Reações" aria-expanded={open}
        title="Reagir" onClick={() => setOpen((v) => !v)}
      >
        <span className="ce-reactbar-emoji" aria-hidden="true">🎉</span>
        <span className="vc-ctrl-label">Reagir</span>
      </button>
      {open && (
        <div className="ce-reactbar-pop" role="menu" aria-label="Escolher reação">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji} type="button" className="ce-react-pick" role="menuitem"
              aria-label={`Reagir com ${emoji}`} onClick={() => { voice.sendReaction(emoji); setOpen(false); }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Camada dos emojis flutuantes (sobe e some). Cada um ganha uma posição
// horizontal aleatória estável pela key.
export function ReactionsOverlay({ voice, memberFor, meId, meName }) {
  const reactions = voice?.reactions || [];
  if (reactions.length === 0) return null;
  return (
    <div className="ce-reactions-layer" aria-live="polite">
      {reactions.map((r) => {
        const name = String(r.userId) === String(meId) ? (meName || 'Você') : (memberFor?.(r.userId)?.displayName || 'Alguém');
        // Posição horizontal pseudo-aleatória derivada do id (estável).
        const seed = r.id.split('-').pop();
        const left = 8 + (Number(seed) * 37) % 78;
        return (
          <div key={r.id} className="ce-react-float" style={{ left: `${left}%` }}>
            <span className="ce-react-float-emoji" aria-hidden="true">{r.emoji}</span>
            <span className="ce-react-float-name truncate">{name}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Gravação com consentimento (N) ----------

// Faixa persistente "🔴 Gravando" visível a TODOS enquanto grava.
export function RecordingBanner({ voice, meId }) {
  const rec = voice?.recording;
  if (!rec) return null;
  const mine = String(rec.byUserId) === String(meId);
  return (
    <div className="ce-recording-banner" role="status">
      <span className="ce-rec-dot" aria-hidden="true" />
      <span className="ce-rec-text">Gravando{rec.byName ? ` · ${rec.byName}` : ''}</span>
      {mine && (
        <button type="button" className="ce-rec-stop" onClick={voice.stopRecording}>Parar</button>
      )}
    </div>
  );
}

// Pergunta visível "X quer gravar esta chamada" — a gravação só começa se
// TODOS aceitarem; qualquer recusa cancela.
export function RecordingConsentModal({ voice }) {
  const prompt = voice?.recordingPrompt;
  if (!prompt) return null;
  return createPortal(
    <div className="ce-consent-overlay" role="dialog" aria-modal="true" aria-labelledby="ce-consent-title">
      <div className="ce-consent">
        <span className="ce-rec-dot ce-rec-dot-lg" aria-hidden="true" />
        <h2 id="ce-consent-title">{prompt.requesterName || 'Alguém'} quer gravar esta chamada</h2>
        <p>A gravação só começa se <strong>todo mundo</strong> aceitar. Você pode recusar sem problema.</p>
        <div className="ce-consent-actions">
          <button type="button" className="ce-consent-decline" onClick={() => voice.respondRecording(false)}>Não permitir</button>
          <button type="button" className="ce-consent-accept" onClick={() => voice.respondRecording(true)}>Permitir gravar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Botão pra INICIAR o pedido de gravação (quem está esperando os votos vê
// "Aguardando..."). Fica junto dos controles.
export function RecordButton({ voice }) {
  const rec = voice?.recording;
  const waiting = !rec && Object.keys(voice?.recordingConsents || {}).length > 0;
  if (rec) return null; // enquanto grava, o controle de parar está na faixa
  return (
    <button
      type="button" className={`vc-ctrl ce-record-btn${waiting ? ' is-waiting' : ''}`}
      onClick={voice.requestRecording} disabled={waiting}
      aria-label="Gravar chamada" title={waiting ? 'Aguardando todos permitirem…' : 'Gravar (com permissão de todos)'}
    >
      <span className="ce-record-ring" aria-hidden="true" />
      <span className="vc-ctrl-label">{waiting ? 'Aguardando…' : 'Gravar'}</span>
    </button>
  );
}

// Captura de áudio da gravação (N) — só roda pra quem INICIOU a gravação,
// e só DEPOIS que todos aceitaram (o estado `recording` só existe nesse
// caso). Mistura o seu microfone + o áudio de todos os participantes num
// stream só e grava com o MediaRecorder; ao parar, baixa o arquivo pra
// quem gravou. É só áudio (vídeo/tela ficam de fora — ver relatório).
// Se o navegador não suportar, a faixa "🔴 Gravando" continua valendo (o
// consentimento e o aviso visível não dependem disto).
export function RecordingCapture({ voice, meId }) {
  const rec = voice?.recording;
  const mine = rec && String(rec.byUserId) === String(meId);
  const remoteAudioStreams = voice?.remoteAudioStreams;
  const remoteScreenAudioStreams = voice?.remoteScreenAudioStreams;
  const recorderRef = useRef(null);
  const ctxRef = useRef(null);

  useEffect(() => {
    if (!mine) return undefined;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || typeof MediaRecorder === 'undefined') return undefined;
    let stopped = false;
    const chunks = [];
    try {
      const ctx = new AudioCtx();
      ctxRef.current = ctx;
      const dest = ctx.createMediaStreamDestination();
      const connectStream = (stream) => {
        try { ctx.createMediaStreamSource(stream).connect(dest); } catch { /* faixa já encerrada */ }
      };
      // Seu microfone.
      const micMedia = voice.getLocalMicTrack?.();
      if (micMedia) connectStream(new MediaStream([micMedia]));
      // Áudio de cada participante.
      Object.values(remoteAudioStreams || {}).forEach(connectStream);
      // Som das telas transmitidas (vem separado da voz).
      Object.values(remoteScreenAudioStreams || {}).forEach(connectStream);

      const rec2 = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
      rec2.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec2.onstop = () => {
        try {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          a.href = url; a.download = `chamada-${stamp}.webm`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch { /* sem como baixar — ok */ }
      };
      rec2.start(1000);
      recorderRef.current = rec2;
    } catch { /* não deu pra gravar — o aviso visível continua valendo */ }
    return () => {
      stopped = true;
      try { recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop(); } catch { /* ok */ }
      recorderRef.current = null;
      try { ctxRef.current?.close(); } catch { /* ok */ }
      ctxRef.current = null;
      void stopped;
    };
  // Recria se entrar mais gente com áudio durante a gravação (pra captar todos).
  }, [mine, remoteAudioStreams, remoteScreenAudioStreams]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ---------- Legendas ao vivo (K) ----------

export function isSpeechRecognitionSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Overlay de legendas do SEU microfone (reconhecimento do navegador,
// pt-BR, automático). Liga/desliga pela preferência 'captions'. Some
// graciosamente onde o navegador não suporta.
export function LiveCaptions({ active }) {
  const [enabled, setEnabled] = useState(() => getVoicePref('captions') === true);
  const [text, setText] = useState('');
  const [unsupported, setUnsupported] = useState(false);
  const recRef = useRef(null);
  useEffect(() => onVoicePrefsChange((p) => setEnabled(p.captions === true)), []);

  useEffect(() => {
    if (!active || !enabled) { setText(''); return undefined; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setUnsupported(true); return undefined; }
    setUnsupported(false);
    const rec = new SR();
    rec.lang = 'pt-BR';
    rec.continuous = true;
    rec.interimResults = true;
    let stopped = false;
    rec.onresult = (e) => {
      let out = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) out += e.results[i][0].transcript;
      setText(out.trim().slice(-160));
    };
    // O reconhecimento às vezes encerra sozinho — religa enquanto ligado.
    rec.onend = () => { if (!stopped) { try { rec.start(); } catch { /* já rodando */ } } };
    rec.onerror = () => { /* sem permissão/rede — deixa quieto */ };
    try { rec.start(); } catch { /* já rodando */ }
    recRef.current = rec;
    return () => {
      stopped = true;
      try { rec.stop(); } catch { /* ok */ }
      recRef.current = null;
    };
  }, [active, enabled]);

  if (!active || !enabled) return null;
  if (unsupported) {
    return <div className="ce-captions ce-captions-note" role="status">Legendas não são suportadas neste navegador.</div>;
  }
  if (!text) return null;
  return (
    <div className="ce-captions" role="status" aria-live="polite">
      <span className="ce-captions-tag">legenda automática</span>
      <span className="ce-captions-text">{text}</span>
    </div>
  );
}
