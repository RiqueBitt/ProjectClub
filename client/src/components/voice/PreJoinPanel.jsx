import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CallIcon from './CallIcons.jsx';
import {
  getPreferredMicId, setPreferredMicId, getPreferredSpeakerId, setPreferredSpeakerId,
  getPreferredCameraId, setPreferredCameraId, isOutputSelectionSupported,
} from '../../utils/audioDevices';
import { watchForSilentMic } from '../../utils/micDiagnostics';
import { setExtra } from '../../utils/extraPrefs';
import '../../styles/prejoin.css';

// "Testar antes de entrar" (estilo Google Meet/Discord): antes de conectar
// numa chamada, mostra o microfone com medidor de volume ao vivo, a câmera
// com prévia, a saída de áudio com som de teste e as opções de entrar mudo /
// com câmera. Tudo que é aberto aqui (mic, câmera, AudioContext) é fechado
// ao sair do painel — por "Entrar", "Cancelar", Esc ou clique fora.

const LEVEL_TICK_MS = 60;

const stopStream = (stream) => { stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* já parada */ } }); };

// Pede o dispositivo escolhido; se ele sumiu, cai pro padrão do sistema.
async function openDevice(kind, deviceId) {
  const base = kind === 'audio'
    ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    : { width: { ideal: 1280 }, height: { ideal: 720 } };
  const constraints = (id) => ({ [kind]: id ? { ...base, deviceId: { exact: id } } : base, [kind === 'audio' ? 'video' : 'audio']: false });
  try {
    return await navigator.mediaDevices.getUserMedia(constraints(deviceId));
  } catch (err) {
    if (!deviceId || err?.name === 'NotAllowedError') throw err;
    return navigator.mediaDevices.getUserMedia(constraints(''));
  }
}

function deviceError(err, what) {
  if (err?.name === 'NotAllowedError') return `O acesso ${what} foi bloqueado. Libere no cadeado da barra de endereço (ou nas permissões do app).`;
  if (err?.name === 'NotReadableError') return `${what === 'à câmera' ? 'A câmera' : 'O microfone'} está em uso por outro programa.`;
  return what === 'à câmera' ? 'Não encontramos nenhuma câmera funcionando.' : 'Não encontramos nenhum microfone funcionando.';
}

// Som curto de teste (duas notas), tocado pela saída escolhida.
async function playTestTone(speakerId) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  const dest = ctx.createMediaStreamDestination();
  const out = ctx.createGain();
  out.gain.value = 0.25;
  out.connect(dest);
  const notes = [[659.25, 0], [880, 0.18], [1318.5, 0.36]];
  notes.forEach(([freq, at]) => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t0 = ctx.currentTime + at;
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(1, t0 + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.42);
    osc.connect(env).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.45);
  });
  const el = new Audio();
  el.srcObject = dest.stream;
  if (speakerId && isOutputSelectionSupported()) { try { await el.setSinkId(speakerId); } catch { /* saída sumiu — toca na padrão */ } }
  await ctx.resume().catch(() => {});
  await el.play();
  await new Promise((r) => { setTimeout(r, 900); });
  el.pause();
  el.srcObject = null;
  stopStream(dest.stream);
  ctx.close().catch(() => {});
}

export default function PreJoinPanel({ channelName, inOtherCall, otherCallName, onJoin, onCancel }) {
  const titleId = useId();
  const [devices, setDevices] = useState({ mics: [], cams: [], speakers: [] });
  const [micId, setMicId] = useState(getPreferredMicId);
  const [camId, setCamId] = useState(getPreferredCameraId);
  const [speakerId, setSpeakerId] = useState(getPreferredSpeakerId);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState('');
  const [camError, setCamError] = useState('');
  const [silent, setSilent] = useState(false);
  const [camStream, setCamStream] = useState(null);
  const [testing, setTesting] = useState(false);
  const videoRef = useRef(null);
  const joinBtnRef = useRef(null);
  const micRes = useRef(null); // { stream, ctx, raf, stopWatch }
  const camRef = useRef(null);
  const closedRef = useRef(false);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        mics: all.filter((d) => d.kind === 'audioinput' && d.deviceId),
        cams: all.filter((d) => d.kind === 'videoinput' && d.deviceId),
        speakers: all.filter((d) => d.kind === 'audiooutput' && d.deviceId),
      });
    } catch { /* sem suporte — listas vazias */ }
  }, []);

  const stopMic = useCallback(() => {
    const r = micRes.current;
    micRes.current = null;
    if (!r) return;
    cancelAnimationFrame(r.raf);
    r.stopWatch?.();
    stopStream(r.stream);
    r.ctx?.close().catch(() => {});
  }, []);
  const stopCam = useCallback(() => {
    stopStream(camRef.current);
    camRef.current = null;
  }, []);
  // Solta TUDO (mic, câmera, AudioContext) — chamado ao fechar o painel.
  const releaseAll = useCallback(() => {
    closedRef.current = true;
    stopMic();
    stopCam();
  }, [stopMic, stopCam]);

  // ---------- Microfone + medidor ----------
  useEffect(() => {
    let cancelled = false;
    setMicError('');
    setSilent(false);
    setLevel(0);
    stopMic();
    (async () => {
      let stream;
      try {
        stream = await openDevice('audio', micId);
      } catch (err) {
        if (!cancelled) setMicError(deviceError(err, 'ao microfone'));
        return;
      }
      if (cancelled || closedRef.current) { stopStream(stream); return; }
      refreshDevices(); // com permissão, os nomes dos aparelhos aparecem
      const res = { stream, ctx: null, raf: 0, stopWatch: null };
      micRes.current = res;
      // Diagnóstico de "microfone mudo pelo sistema" (micDiagnostics.js).
      res.stopWatch = watchForSilentMic(stream, () => { if (micRes.current === res) setSilent(true); });
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      res.ctx = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let last = 0;
      const loop = (t) => {
        if (micRes.current !== res) return;
        if (t - last > LEVEL_TICK_MS) {
          last = t;
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          // dBFS → 0..100 (−60 dB = vazio, 0 dB = cheio).
          const db = rms > 0 ? 20 * Math.log10(rms) : -100;
          const pct = Math.max(0, Math.min(100, Math.round(((db + 60) / 60) * 100)));
          setLevel((prev) => (Math.abs(prev - pct) < 2 ? prev : pct));
          if (pct > 12) setSilent(false);
        }
        res.raf = requestAnimationFrame(loop);
      };
      res.raf = requestAnimationFrame(loop);
    })();
    return () => { cancelled = true; stopMic(); };
  }, [micId, stopMic, refreshDevices]);

  // ---------- Câmera (prévia só quando ligada) ----------
  useEffect(() => {
    if (!camOn) { stopCam(); setCamStream(null); setCamError(''); return undefined; }
    let cancelled = false;
    setCamError('');
    (async () => {
      let stream;
      try {
        stream = await openDevice('video', camId);
      } catch (err) {
        if (!cancelled) { setCamError(deviceError(err, 'à câmera')); setCamOn(false); }
        return;
      }
      if (cancelled || closedRef.current) { stopStream(stream); return; }
      stopCam();
      camRef.current = stream;
      setCamStream(stream);
      refreshDevices();
    })();
    return () => { cancelled = true; };
  }, [camOn, camId, stopCam, refreshDevices]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = camStream;
  }, [camStream]);

  // Lista de aparelhos + plugar/desplugar enquanto o painel está aberto.
  useEffect(() => {
    refreshDevices();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', refreshDevices);
    return () => md?.removeEventListener?.('devicechange', refreshDevices);
  }, [refreshDevices]);

  // Fecha tudo ao desmontar (garantia extra além de releaseAll).
  useEffect(() => () => { closedRef.current = true; stopMic(); stopCam(); }, [stopMic, stopCam]);

  const cancel = useCallback(() => { releaseAll(); onCancel?.(); }, [releaseAll, onCancel]);
  const join = () => {
    releaseAll();
    if (dontShow) setExtra({ preJoinCheck: false });
    onJoin?.({ startMuted: !micOn, startCamera: camOn });
  };

  useEffect(() => {
    joinBtnRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') cancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cancel]);

  const pickMic = (id) => { setMicId(id); setPreferredMicId(id); };
  const pickCam = (id) => { setCamId(id); setPreferredCameraId(id); };
  const pickSpeaker = (id) => { setSpeakerId(id); setPreferredSpeakerId(id); };
  const testSpeaker = async () => {
    if (testing) return;
    setTesting(true);
    try { await playTestTone(speakerId); } catch { /* bloqueado — sem som */ }
    setTesting(false);
  };

  const outputSupported = isOutputSelectionSupported();
  const levelHint = micError ? micError
    : silent ? 'Não estamos captando som. Confira se o microfone não está mudo no sistema.'
      : level > 12 ? 'Estamos ouvindo você.' : 'Fale algo para testar.';
  const meterBars = 16;
  const litBars = Math.round((level / 100) * meterBars);

  return createPortal(
    <div className="pj-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="pj" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="pj-head">
          <div className="pj-head-text">
            <h2 id={titleId}>Testar antes de entrar</h2>
            <p className="pj-sub truncate"><CallIcon name="speaker" size={14} /> {channelName || 'Chamada'}</p>
          </div>
          <button type="button" className="pj-x" onClick={cancel} aria-label="Fechar"><CallIcon name="close" size={18} /></button>
        </header>

        <div className="pj-body">
          {/* Prévia: câmera ao vivo (espelhada) ou aviso de câmera desligada. */}
          <div className={`pj-preview${camStream ? ' has-video' : ''}`}>
            {camStream ? (
              <video ref={videoRef} autoPlay playsInline muted className="pj-video" />
            ) : (
              <div className="pj-preview-empty">
                <CallIcon name="cameraOff" size={30} />
                <span>{camError || 'Câmera desligada'}</span>
              </div>
            )}
            <div className="pj-preview-controls">
              <button
                type="button" className={`pj-round${micOn ? '' : ' is-off'}`} onClick={() => setMicOn((v) => !v)}
                aria-pressed={!micOn} aria-label={micOn ? 'Entrar com microfone ligado (clique para entrar mudo)' : 'Entrar mudo (clique para ligar o microfone)'}
                title={micOn ? 'Microfone ligado ao entrar' : 'Entrar mudo'}
              >
                <CallIcon name={micOn ? 'mic' : 'micOff'} size={20} />
              </button>
              <button
                type="button" className={`pj-round${camOn ? ' is-on' : ' is-off'}`} onClick={() => setCamOn((v) => !v)}
                aria-pressed={camOn} aria-label={camOn ? 'Entrar com câmera ligada (clique para desligar)' : 'Entrar com câmera desligada (clique para ligar)'}
                title={camOn ? 'Câmera ligada ao entrar' : 'Câmera desligada ao entrar'}
              >
                <CallIcon name={camOn ? 'camera' : 'cameraOff'} size={20} />
              </button>
            </div>
          </div>

          {/* Microfone + medidor ao vivo */}
          <section className="pj-field">
            <label className="pj-label" htmlFor={`${titleId}-mic`}><CallIcon name="mic" size={14} /> Microfone</label>
            <select id={`${titleId}-mic`} className="pj-select" value={micId} onChange={(e) => pickMic(e.target.value)}>
              <option value="">Padrão do sistema</option>
              {devices.mics.filter((d) => d.deviceId !== 'default').map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Microfone ${i + 1}`}</option>
              ))}
            </select>
            <div className="pj-meter" role="meter" aria-label="Volume do microfone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level}>
              {Array.from({ length: meterBars }, (_, i) => (
                <span key={i} className={i < litBars ? (i >= meterBars - 3 ? 'is-hot' : 'is-lit') : ''} />
              ))}
            </div>
            <p className={`pj-hint${micError || silent ? ' is-warn' : ''}`} role="status" aria-live="polite">
              {!micOn && !micError ? 'Você vai entrar mudo. ' : ''}{levelHint}
            </p>
          </section>

          {/* Câmera */}
          <section className="pj-field">
            <label className="pj-label" htmlFor={`${titleId}-cam`}><CallIcon name="camera" size={14} /> Câmera</label>
            <select
              id={`${titleId}-cam`} className="pj-select" value={camId} onChange={(e) => pickCam(e.target.value)}
              disabled={devices.cams.length === 0 && !camOn}
            >
              <option value="">{devices.cams.length ? 'Padrão do sistema' : 'Nenhuma câmera encontrada'}</option>
              {devices.cams.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Câmera ${i + 1}`}</option>)}
            </select>
          </section>

          {/* Saída de áudio + som de teste */}
          <section className="pj-field">
            <label className="pj-label" htmlFor={`${titleId}-out`}><CallIcon name="headphones" size={14} /> Saída de áudio</label>
            <div className="pj-row">
              {outputSupported ? (
                <select id={`${titleId}-out`} className="pj-select" value={speakerId} onChange={(e) => pickSpeaker(e.target.value)}>
                  <option value="">Padrão do sistema</option>
                  {devices.speakers.filter((d) => d.deviceId !== 'default').map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Saída ${i + 1}`}</option>
                  ))}
                </select>
              ) : (
                <span id={`${titleId}-out`} className="pj-static">Saída padrão do aparelho</span>
              )}
              <button type="button" className="pj-btn pj-test" onClick={testSpeaker} disabled={testing}>
                <CallIcon name="play" size={14} /> {testing ? 'Tocando…' : 'Tocar som de teste'}
              </button>
            </div>
          </section>

          {inOtherCall && <p className="pj-note">Você vai sair da chamada atual ({otherCallName || 'outra sala'}).</p>}
        </div>

        <footer className="pj-foot">
          <label className="pj-check">
            <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
            <span>Não mostrar de novo</span>
          </label>
          <div className="pj-actions">
            <button type="button" className="pj-btn" onClick={cancel}>Cancelar</button>
            <button type="button" ref={joinBtnRef} className="pj-btn pj-primary" onClick={join}>Entrar</button>
          </div>
        </footer>
        {dontShow && <p className="pj-foot-hint">Dá pra reativar em Configurações → Voz e vídeo.</p>}
      </div>
    </div>,
    document.body,
  );
}
