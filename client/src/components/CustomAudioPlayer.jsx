import { useEffect, useRef, useState } from 'react';

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// A fully custom-styled audio player - play/pause button, seekable
// progress bar, current/total time - instead of the browser's own
// <audio controls> UI (which looks completely different per browser/OS
// and can't be restyled to match the rest of the app at all). The actual
// audio element is still a plain <audio> under the hood (nothing else can
// decode/play a file), it's just rendered with no native UI of its own -
// every control on screen is ours.
export default function CustomAudioPlayer({ src, compact = false }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoaded = () => { setDuration(audio.duration || 0); setLoaded(true); };
    const onTime = () => setCurrentTime(audio.currentTime || 0);
    const onEnd = () => { setPlaying(false); setCurrentTime(0); };
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
    };
  }, [src]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); } else { audio.play(); setPlaying(true); }
  };

  const seek = (e) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  };

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`custom-audio-player ${compact ? 'compact' : ''}`}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button type="button" className="custom-audio-play-btn" onClick={toggle} title={playing ? 'Pausar' : 'Reproduzir'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="custom-audio-track" onClick={seek}>
        <div className="custom-audio-track-fill" style={{ width: `${progress}%` }} />
        <div className="custom-audio-track-knob" style={{ left: `${progress}%` }} />
      </div>
      {!compact && (
        <span className="custom-audio-time">{formatTime(currentTime)} / {loaded ? formatTime(duration) : '--:--'}</span>
      )}
    </div>
  );
}
