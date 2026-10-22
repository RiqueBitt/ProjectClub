import { useEffect, useRef, useState } from 'react';

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Só um player tocando por vez no app inteiro (como no Discord/WhatsApp).
let currentlyPlaying = null;

const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 2.2v9.6a.6.6 0 0 0 .9.5l7.8-4.8a.6.6 0 0 0 0-1L4.4 1.7a.6.6 0 0 0-.9.5z" fill="currentColor" /></svg>
);
const PauseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="2" width="3" height="10" rx="1" fill="currentColor" /><rect x="8" y="2" width="3" height="10" rx="1" fill="currentColor" /></svg>
);

// Player de áudio próprio (o <audio controls> nativo tem cara diferente em
// cada navegador e não dá pra estilizar). Por baixo continua um <audio>.
//
// Revisão (player no celular):
//  - Mensagem de voz gravada no navegador (WebM do MediaRecorder) não traz
//    duração: audio.duration = Infinity — a barra ficava parada em 0%, o
//    total aparecia "0:00" e arrastar dava erro. Agora descobre a duração
//    real pulando pro fim e voltando (técnica padrão pra esse caso).
//  - Barra de progresso ARRASTÁVEL com o dedo (pointer events +
//    setPointerCapture), área de toque de 28px (a trilha visível continua
//    fina), teclado (← → Home End) e role="slider" pra leitor de tela.
//  - Botão reflete o estado REAL do áudio (eventos play/pause): antes o
//    play() rejeitado (autoplay bloqueado, formato não suportado) deixava o
//    botão em "pausar" com nada tocando.
//  - Ícones em SVG (os caracteres ▶/❚❚ viravam emoji colorido no Android).
//  - Erro de reprodução mostra aviso e link pra baixar o arquivo.
export default function CustomAudioPlayer({ src, compact = false }) {
  const audioRef = useRef(null);
  const trackRef = useRef(null);
  const draggingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    setPlaying(false); setCurrentTime(0); setDuration(0); setLoaded(false); setFailed(false);
    const setRealDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) { setDuration(audio.duration); setLoaded(true); return true; }
      return false;
    };
    const onLoaded = () => {
      if (setRealDuration()) return;
      // WebM sem duração: pula pro "fim" e o navegador calcula a real. Só
      // quando a pessoa der play (não ao aparecer na tela): o pulo baixa o
      // arquivo inteiro, e no celular isso gastava dados à toa.
      setLoaded(true);
    };
    const onDurationChange = () => { setRealDuration(); };
    // Enquanto mede a duração (pulo pro fim), não mexe na barra.
    const onTime = () => {
      if (draggingRef.current || !Number.isFinite(audio.duration)) return;
      setCurrentTime(audio.currentTime || 0);
    };
    const onPlay = () => {
      if (currentlyPlaying && currentlyPlaying !== audio) { try { currentlyPlaying.pause(); } catch { /* ok */ } }
      currentlyPlaying = audio;
      setPlaying(true);
    };
    const onPause = () => { setPlaying(false); if (currentlyPlaying === audio) currentlyPlaying = null; };
    const onEnd = () => { setPlaying(false); setCurrentTime(0); try { audio.currentTime = 0; } catch { /* ok */ } };
    const onError = () => { setFailed(true); setPlaying(false); };
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('error', onError);
      if (currentlyPlaying === audio) { try { audio.pause(); } catch { /* ok */ } currentlyPlaying = null; }
    };
  }, [src]);

  const probeRef = useRef(null);
  const probeDuration = () => {
    const audio = audioRef.current;
    if (!audio || Number.isFinite(audio.duration)) return Promise.resolve();
    if (probeRef.current) return probeRef.current;
    probeRef.current = new Promise((resolve) => {
      const done = () => {
        audio.removeEventListener('durationchange', onChange);
        clearTimeout(timer);
        if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
        try { audio.currentTime = 0; } catch { /* ok */ }
        setCurrentTime(0);
        resolve();
      };
      const onChange = () => { if (Number.isFinite(audio.duration)) done(); };
      // Navegador que nunca informa a duração: desiste em 3s e toca assim mesmo.
      const timer = setTimeout(done, 3000);
      audio.addEventListener('durationchange', onChange);
      try { audio.currentTime = 1e101; } catch { done(); }
    });
    return probeRef.current;
  };
  useEffect(() => { probeRef.current = null; }, [src]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || failed) return;
    if (!audio.paused) { audio.pause(); return; }
    await probeDuration();
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch((err) => { if (err?.name !== 'AbortError') setPlaying(false); });
  };

  const seekTo = (seconds) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const t = Math.min(duration, Math.max(0, seconds));
    try { audio.currentTime = t; } catch { /* ok */ }
    setCurrentTime(t);
  };
  // getBoundingClientRect e clientX ficam na mesma escala (inclusive com o
  // zoom de 1,2 do desktop nos navegadores atuais).
  const ratioAt = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };
  const onPointerDown = (e) => {
    if (!duration || e.button > 0) return;
    draggingRef.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ok */ }
    setCurrentTime(ratioAt(e.clientX) * duration);
  };
  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    setCurrentTime(ratioAt(e.clientX) * duration);
  };
  const onPointerUp = (e) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    seekTo(ratioAt(e.clientX) * duration);
  };
  const onKeyDown = (e) => {
    if (!duration) return;
    const step = Math.max(1, duration / 20);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); seekTo(currentTime + step); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); seekTo(currentTime - step); }
    else if (e.key === 'Home') { e.preventDefault(); seekTo(0); }
    else if (e.key === 'End') { e.preventDefault(); seekTo(duration); }
  };

  const progress = duration ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className={`custom-audio-player ${compact ? 'compact' : ''}${failed ? ' is-failed' : ''}`}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button" className="custom-audio-play-btn" onClick={toggle} disabled={failed}
        title={playing ? 'Pausar' : 'Reproduzir'} aria-label={playing ? 'Pausar' : 'Reproduzir'}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      {failed ? (
        <span className="custom-audio-error">
          Não foi possível tocar este áudio aqui. <a href={src} target="_blank" rel="noreferrer" download>Baixar</a>
        </span>
      ) : (
        <div
          ref={trackRef}
          className="custom-audio-track"
          role="slider" tabIndex={0}
          aria-label="Posição do áudio"
          aria-valuemin={0} aria-valuemax={Math.round(duration) || 0} aria-valuenow={Math.round(currentTime)}
          aria-valuetext={`${formatTime(currentTime)} de ${formatTime(duration)}`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <div className="custom-audio-track-fill" style={{ width: `${progress}%` }} />
          <div className="custom-audio-track-knob" style={{ left: `${progress}%` }} />
        </div>
      )}
      {!compact && !failed && (
        <span className="custom-audio-time">{formatTime(currentTime)} / {loaded ? formatTime(duration) : '--:--'}</span>
      )}
    </div>
  );
}
