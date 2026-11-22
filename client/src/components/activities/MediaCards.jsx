import { useEffect, useState } from 'react';
import { getActivityVideo } from '../../api/endpoints';
import { useVoice } from '../../context/VoiceContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { useMusic } from '../../music/musicStore';
import '../../styles/media-cards.css';

// Cartões das atividades YouTube e Música mandadas no chat
// (/atividade/video/<id> e /atividade/musica/<id>). Nada toca sozinho: o
// vídeo abre no próprio cartão quando a pessoa clica; a música toca no
// player de música do app (continua tocando ao navegar). Quem está numa
// call pode "Levar pra call" (entra na fila da atividade da chamada).

const thumb = (id, q = 'hqdefault') => `https://i.ytimg.com/vi/${id}/${q}.jpg`;
const fmtDur = (s) => {
  if (!s) return '';
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

const infoCache = new Map();
function useVideoInfo(videoId) {
  const [info, setInfo] = useState(() => infoCache.get(videoId));
  useEffect(() => {
    if (infoCache.has(videoId)) { setInfo(infoCache.get(videoId)); return undefined; }
    let alive = true;
    getActivityVideo(videoId)
      .then((d) => { infoCache.set(videoId, d); if (alive) setInfo(d); })
      .catch(() => { const d = { videoId, title: null, channel: null }; infoCache.set(videoId, d); if (alive) setInfo(d); });
    return () => { alive = false; };
  }, [videoId]);
  return info;
}

function Ico({ d, size = 16, fill = false }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
const P = {
  play: 'M8 5.5v13l10-6.5z', pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  call: 'M4 12a8 8 0 0 1 16 0v5a2 2 0 0 1-2 2h-1v-6h3M4 13h3v6H6a2 2 0 0 1-2-2z',
  queue: 'M4 6h12M4 12h12M4 18h7M17 15v6M14 18h6',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
};

// Botão "Levar pra call" (só aparece pra quem está numa chamada).
function SendToCall({ videoId, title, mode }) {
  const voice = useVoice();
  const { socket } = useSocket() || {};
  const [sent, setSent] = useState(false);
  const channelId = voice?.call?.channelId;
  if (!channelId || !socket) return null;
  return (
    <button
      type="button" className={`mc-btn${sent ? ' is-done' : ''}`}
      onClick={() => { socket.emit('yt:queue:add', { channelId, videoId, title, mode }); setSent(true); setTimeout(() => setSent(false), 2500); }}
      title={mode === 'music' ? 'Toca na chamada pra todo mundo (entra na fila se já tiver música)' : 'Assistir junto na chamada (entra na fila se já tiver vídeo)'}
    >
      <Ico d={P.call} /> {sent ? 'Mandado pra call' : 'Levar pra call'}
    </button>
  );
}

export function YouTubeVideoCard({ videoId }) {
  const info = useVideoInfo(videoId);
  const [playing, setPlaying] = useState(false);
  const title = info?.title || 'Vídeo do YouTube';
  return (
    <div className="mc-card mc-video" role="group" aria-label={`Vídeo do YouTube: ${title}`}>
      <div className="mc-video-frame">
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1`}
            title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
          />
        ) : (
          <button type="button" className="mc-video-poster" onClick={() => setPlaying(true)} aria-label={`Assistir ${title}`}>
            <img src={thumb(videoId)} alt="" loading="lazy" />
            <span className="mc-play-big"><Ico d={P.play} size={30} fill /></span>
            {info?.durationSec ? <span className="mc-dur">{fmtDur(info.durationSec)}</span> : null}
          </button>
        )}
      </div>
      <div className="mc-meta">
        <span className="mc-badge mc-badge-yt">YouTube</span>
        <strong className="mc-title" data-no-translate>{title}</strong>
        {info?.channel && <small className="mc-sub" data-no-translate>{info.channel}</small>}
      </div>
      <div className="mc-actions">
        {!playing && <button type="button" className="mc-btn mc-btn-main" onClick={() => setPlaying(true)}><Ico d={P.play} fill /> Assistir aqui</button>}
        <SendToCall videoId={videoId} title={info?.title} mode="video" />
        <a className="mc-btn mc-btn-ghost" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer noopener"><Ico d={P.ext} /> YouTube</a>
      </div>
    </div>
  );
}

export function MusicTrackCard({ videoId }) {
  const info = useVideoInfo(videoId);
  const m = useMusic();
  const cur = m.queue[m.index];
  const isCurrent = cur?.videoId === videoId;
  const isPlaying = isCurrent && m.playing;
  const title = info?.title || 'Música';
  const track = { videoId, title, artist: info?.channel || '', thumbnail: thumb(videoId, 'mqdefault') };
  const toggle = () => {
    if (isCurrent) m.toggle(); else m.playNow(track);
  };
  return (
    <div className={`mc-card mc-music${isPlaying ? ' is-playing' : ''}`} role="group" aria-label={`Música: ${title}`}>
      <div className="mc-cover-wrap">
        <span className="mc-vinyl" aria-hidden="true" />
        <img className="mc-cover" src={thumb(videoId)} alt="" loading="lazy" />
        <button type="button" className="mc-cover-play" onClick={toggle} aria-label={isPlaying ? `Pausar ${title}` : `Tocar ${title}`}>
          <Ico d={isPlaying ? P.pause : P.play} size={24} fill />
        </button>
      </div>
      <div className="mc-music-body">
        <span className="mc-badge mc-badge-music">
          {isPlaying ? <span className="mc-eq" aria-hidden="true"><i /><i /><i /><i /></span> : '♪'} Música
        </span>
        <strong className="mc-title" data-no-translate>{title}</strong>
        {info?.channel && <small className="mc-sub" data-no-translate>{info.channel}{info.durationSec ? ` · ${fmtDur(info.durationSec)}` : ''}</small>}
        <div className="mc-actions">
          <button type="button" className="mc-btn mc-btn-main" onClick={toggle}><Ico d={isPlaying ? P.pause : P.play} fill /> {isPlaying ? 'Pausar' : (isCurrent ? 'Continuar' : 'Ouvir')}</button>
          <button type="button" className="mc-btn" onClick={() => m.enqueue(track)} title="Adicionar à sua fila de músicas"><Ico d={P.queue} /> Fila</button>
          <SendToCall videoId={videoId} title={info?.title} mode="music" />
        </div>
      </div>
    </div>
  );
}
