import { useEffect, useRef, useState } from 'react';
import { useYouTubeApp } from './youtubeStore';
import { loadYouTubeApi } from '../components/voice/YouTubeWatch.jsx';
import {
  Ico, I, CHIPS, useFeed, VideoCard, Skeletons, RelatedList, SearchBox,
} from '../components/voice/YouTubeBrowser.jsx';
import { parseYouTubeId, thumb, readCaptionsPref, writeCaptionsPref, applyCaptions } from '../components/voice/ytUtils.js';
import { ytRelated, listYoutubeVideos } from '../api/endpoints';
import { useMusic } from '../music/musicStore';
import '../styles/ytbrowser.css';
import '../styles/ytapp.css';

// ============================================================
// YouTube pessoal (botão na barra de cima): navegar, buscar e assistir
// sem precisar de chamada nem canal. Um único player do YouTube fica
// sempre montado (YouTubeHost) e "segue" o lugar certo: grande na tela
// de assistir ou pequeno no canto (mini player) enquanto você navega.
// O player usa os controles do próprio YouTube: qualidade (⚙), velocidade,
// legendas e tela cheia funcionam como no site.
// ============================================================

const X = {
  cc: 'M4 6h16v12H4zM10.5 10.2A2.2 2.2 0 1 0 10.5 13.8M17 10.2A2.2 2.2 0 1 0 17 13.8',
  ccOff: 'M4 6h16v12H4zM10.5 10.2A2.2 2.2 0 1 0 10.5 13.8M17 10.2A2.2 2.2 0 1 0 17 13.8M3 3l18 18',
  mini: 'M4 5h16v14H4zM12 12h6v5h-6z',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.3 1.3M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.3-1.3',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  headphones: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z',
  auto: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
  list: 'M4 6h12M4 12h12M4 18h8M17 15v6M14 18h6',
};

// ---------------- Player (sempre montado) ----------------
export function YouTubeHost() {
  const { video, open, view } = useYouTubeApp();
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const readyRef = useRef(false);
  const loadedRef = useRef(null);
  const [rect, setRect] = useState(null);
  const watching = open && view === 'watch';

  // Cria/destrói o player.
  useEffect(() => {
    if (!video || playerRef.current) return undefined;
    let dead = false;
    loadYouTubeApi().then((YT) => {
      if (dead || !hostRef.current) return;
      const mount = document.createElement('div');
      hostRef.current.appendChild(mount);
      loadedRef.current = video.videoId;
      playerRef.current = new YT.Player(mount, {
        host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%', videoId: video.videoId,
        playerVars: {
          autoplay: 1, controls: 1, rel: 0, modestbranding: 1, playsinline: 1, fs: 1, iv_load_policy: 3,
          hl: 'pt-BR', cc_lang_pref: 'pt', cc_load_policy: readCaptionsPref() ? 1 : 0, origin: window.location.origin,
        },
        events: {
          onReady: (e) => { readyRef.current = true; applyCaptions(e.target, readCaptionsPref()); try { e.target.playVideo(); } catch { /* ignora */ } },
          onApiChange: (e) => applyCaptions(e.target, readCaptionsPref()),
          onStateChange: (e) => {
            if (e.data === 1) {
              applyCaptions(e.target, readCaptionsPref());
              try { useMusic.getState().setPlaying(false); } catch { /* ignora */ }
              window.dispatchEvent(new Event('pc-yt-play'));
              try {
                const d = e.target.getVideoData?.();
                const st = useYouTubeApp.getState();
                if (d?.title && st.video && !st.video.title) useYouTubeApp.setState({ video: { ...st.video, title: d.title, channel: st.video.channel || d.author || '' } });
              } catch { /* ignora */ }
            }
            if (e.data === 0) playNextAfterEnd();
          },
        },
      });
    }).catch(() => {});
    return () => { dead = true; };
  }, [video]);

  // Troca de vídeo / fechar.
  useEffect(() => {
    const p = playerRef.current;
    if (!video) {
      if (p) { try { p.destroy(); } catch { /* ignora */ } }
      playerRef.current = null; readyRef.current = false; loadedRef.current = null;
      if (hostRef.current) hostRef.current.innerHTML = '';
      return;
    }
    if (p && readyRef.current && loadedRef.current !== video.videoId) {
      loadedRef.current = video.videoId;
      try { p.loadVideoById(video.videoId); } catch { /* ignora */ }
    }
  }, [video]);

  // Acompanha o lugar do player na tela de assistir.
  useEffect(() => {
    if (!watching) { setRect(null); return undefined; }
    let raf = 0;
    const tick = () => {
      const slot = document.querySelector('.ytp-slot');
      const raw = slot?.getBoundingClientRect();
      // O <html> pode ter zoom (escala da interface): o retângulo vem na
      // escala da tela e o "position: fixed" usa px sem zoom.
      const z = Number(document.documentElement.currentCSSZoom || parseFloat(getComputedStyle(document.documentElement).zoom)) || 1;
      const r = raw && { top: raw.top / z, left: raw.left / z, width: raw.width / z, height: raw.height / z };
      setRect((old) => {
        if (!r) return old;
        if (old && Math.abs(old.top - r.top) < 0.5 && Math.abs(old.left - r.left) < 0.5 && Math.abs(old.width - r.width) < 0.5 && Math.abs(old.height - r.height) < 0.5) return old;
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      });
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [watching]);

  // Pausa ao ir para o mini player? Não: continua tocando (como no YouTube).
  useEffect(() => {
    const onCaptions = (e) => applyCaptions(playerRef.current, !!e.detail);
    // Cinema começou a tocar: pausa o YouTube (um vídeo por vez).
    const onCine = () => { try { playerRef.current?.pauseVideo?.(); } catch { /* ignora */ } };
    window.addEventListener('pc-yt-captions', onCaptions);
    window.addEventListener('pc-cine-play', onCine);
    return () => { window.removeEventListener('pc-yt-captions', onCaptions); window.removeEventListener('pc-cine-play', onCine); };
  }, []);

  if (!video) return null;
  const style = watching && rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : undefined;
  const isMini = !watching;
  return (
    <div className={`ytp-host${isMini ? ' is-mini' : ' is-big'}${open && !watching ? ' over-app' : ''}`} style={style}>
      <div className="ytp-frame" ref={hostRef} />
      {isMini && (
        <div className="ytp-mini-bar">
          <button type="button" className="ytp-mini-title" onClick={() => useYouTubeApp.getState().restore()} title="Abrir o vídeo">
            <strong className="truncate" data-no-translate>{video.title || 'YouTube'}</strong>
            <small className="truncate" data-no-translate>{video.channel || ''}</small>
          </button>
          <button type="button" className="ytp-mini-btn" onClick={() => useYouTubeApp.getState().restore()} aria-label="Ampliar" title="Ampliar"><Ico d={X.expand} size={16} /></button>
          <button type="button" className="ytp-mini-btn" onClick={() => useYouTubeApp.getState().close()} aria-label="Fechar vídeo" title="Fechar vídeo"><Ico d={I.close} size={16} /></button>
        </div>
      )}
    </div>
  );
}

// Fim do vídeo: "assistir depois" primeiro; senão, relacionado (se a
// reprodução automática estiver ligada).
async function playNextAfterEnd() {
  const st = useYouTubeApp.getState();
  const queued = st.shiftQueue();
  if (queued) { st.play(queued); keepMini(st.mini); return; }
  if (!st.autoplay || !st.video) return;
  try {
    const d = await ytRelated(st.video.videoId);
    const seen = new Set(useYouTubeApp.getState().history.map((h) => h.videoId));
    const next = (d?.videos || []).find((v) => !seen.has(v.videoId) && !v.live) || (d?.videos || [])[0];
    if (next) { const wasMini = useYouTubeApp.getState().mini; useYouTubeApp.getState().play(next); keepMini(wasMini); }
  } catch { /* ignora */ }
}
function keepMini(wasMini) { if (wasMini) useYouTubeApp.setState({ mini: true, open: false }); }

// ---------------- Tela (navegar / assistir) ----------------
function WatchView({ video, onChannel }) {
  const st = useYouTubeApp();
  const [cc, setCc] = useState(readCaptionsPref);
  const [copied, setCopied] = useState(false);
  const toggleCc = () => {
    const on = !cc; setCc(on); writeCaptionsPref(on);
    window.dispatchEvent(new CustomEvent('pc-yt-captions', { detail: on }));
  };
  const url = `https://www.youtube.com/watch?v=${video.videoId}`;
  const copy = () => { navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };
  const audio = () => {
    useMusic.getState().playNow({ videoId: video.videoId, title: video.title, artist: video.channel || '', thumbnail: thumb(video.videoId), duration: '' });
    useYouTubeApp.getState().close();
  };
  return (
    <div className="ytp-watch">
      <main className="ytp-watch-main">
        <div className="ytp-slot" aria-label="Player do YouTube" />
        <h2 className="ytp-title" data-no-translate>{video.title || 'Carregando…'}</h2>
        <div className="ytp-meta">
          {video.channel && (video.channelId
            ? <button type="button" className="ytp-chan" onClick={() => onChannel(video)} data-no-translate>{video.channel}</button>
            : <span className="ytp-chan" data-no-translate>{video.channel}</span>)}
          <div className="ytp-actions">
            <button type="button" className={`ytp-act${cc ? ' is-on' : ''}`} onClick={toggleCc} aria-pressed={cc} title={cc ? 'Desligar legendas (inclusive automáticas)' : 'Ligar legendas'}>
              <Ico d={cc ? X.cc : X.ccOff} size={17} />{cc ? 'Legendas ligadas' : 'Legendas desligadas'}
            </button>
            <button type="button" className={`ytp-act${st.autoplay ? ' is-on' : ''}`} onClick={() => st.setAutoplay(!st.autoplay)} aria-pressed={st.autoplay} title="Tocar o próximo vídeo sozinho">
              <Ico d={X.auto} size={17} />Reprodução automática {st.autoplay ? 'ligada' : 'desligada'}
            </button>
            <button type="button" className="ytp-act" onClick={audio} title="Ouvir só o áudio no player de música"><Ico d={X.headphones} size={17} />Só o áudio</button>
            <button type="button" className="ytp-act" onClick={copy}><Ico d={X.link} size={17} />{copied ? 'Link copiado!' : 'Copiar link'}</button>
            <a className="ytp-act" href={url} target="_blank" rel="noreferrer"><Ico d={X.ext} size={17} />Abrir no YouTube</a>
          </div>
        </div>
        <p className="ytp-tip">Qualidade, velocidade e legendas também ficam na engrenagem ⚙ do player. Atalhos: espaço pausa, ← → voltam/avançam, F tela cheia, C legendas.</p>
      </main>
      <aside className="ytp-side">
        {st.queue.length > 0 && (
          <>
            <p className="ytb-side-h">Assistir depois ({st.queue.length})</p>
            <div className="ytp-queue">
              {st.queue.map((q) => (
                <div key={q.videoId} className="ytb-rel-item">
                  <button type="button" className="ytb-rel-main" onClick={() => { st.dequeue(q.videoId); st.play(q); }}>
                    <span className="ytb-rel-thumb"><img src={thumb(q.videoId)} alt="" loading="lazy" /></span>
                    <span className="ytb-rel-text"><strong data-no-translate>{q.title || q.videoId}</strong><small data-no-translate>{q.channel}</small></span>
                  </button>
                  <button type="button" className="ytb-qbtn" onClick={() => st.dequeue(q.videoId)} aria-label="Tirar da lista"><Ico d={I.close} size={14} /></button>
                </div>
              ))}
            </div>
          </>
        )}
        <p className="ytb-side-h">A seguir</p>
        <RelatedList videoId={video.videoId} onPlay={(v) => st.play(v)} onQueue={(v) => st.enqueue(v)} />
      </aside>
    </div>
  );
}

function BrowseView({ view, setView, mainRef, pasted, setPasted }) {
  const st = useYouTubeApp();
  const feed = useFeed(view);
  const sentinelRef = useRef(null);
  const [fallback, setFallback] = useState(null);
  const { more } = feed;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) more(); }, { root: mainRef.current, rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more, mainRef]);
  useEffect(() => {
    if (!feed.unavailable || fallback) return;
    listYoutubeVideos().then((d) => setFallback((d?.videos || []).map((v) => ({ videoId: v.videoId, title: v.title, thumbnail: v.thumbnailUrl, channel: 'Mr. Pinguim', channelId: null })))).catch(() => setFallback([]));
  }, [feed.unavailable, fallback]);
  const items = feed.items.length ? feed.items : (feed.unavailable && !feed.loading ? (fallback || []) : []);
  const queued = new Set(st.queue.map((q) => q.videoId));
  let heading = null;
  if (view.type === 'search') heading = <>Resultados para <q data-no-translate>{view.q}</q></>;
  if (view.type === 'channel') heading = <span data-no-translate>{view.name || 'Canal'}</span>;
  return (
    <main className="ytb-main" ref={mainRef}>
      <div className="ytb-chips" role="toolbar" aria-label="Categorias">
        {view.type !== 'trending' && (
          <button type="button" className="ytb-chip" onClick={() => { setPasted(null); setView({ type: 'trending', cat: 'now' }); }} aria-label="Voltar para Em alta"><Ico d={I.back} size={15} /></button>
        )}
        {CHIPS.map((c) => (
          <button key={c.id} type="button" aria-pressed={view.type === 'trending' && view.cat === c.id}
            className={`ytb-chip${view.type === 'trending' && view.cat === c.id ? ' is-on' : ''}`}
            onClick={() => { setPasted(null); setView({ type: 'trending', cat: c.id }); mainRef.current?.scrollTo?.({ top: 0 }); }}
          ><Ico d={c.icon} size={15} /> {c.label}</button>
        ))}
        {st.history.length > 0 && (
          <button type="button" className={`ytb-chip${view.type === 'history' ? ' is-on' : ''}`} onClick={() => setView({ type: 'history' })}><Ico d={X.list} size={15} /> Histórico</button>
        )}
      </div>
      {pasted && (
        <div className="ytb-pasted">
          <img src={thumb(pasted.videoId)} alt="" />
          <div>
            <strong>Link do YouTube</strong>
            <small data-no-translate>Vídeo {pasted.videoId}</small>
            <div className="ytb-pasted-actions">
              <button type="button" className="ytb-primary" onClick={() => st.play(pasted)}>Assistir</button>
              <button type="button" className="ytb-ghost" onClick={() => st.enqueue(pasted)}>{queued.has(pasted.videoId) ? 'Na lista' : 'Assistir depois'}</button>
            </div>
          </div>
        </div>
      )}
      {heading && <h3 className="ytb-h">{heading}</h3>}
      {view.type === 'history' ? (
        <div className="ytb-grid">
          {st.history.map((v) => <VideoCard key={v.videoId} v={{ ...v, thumbnail: thumb(v.videoId) }} onPlay={st.play} onQueue={st.enqueue} queued={queued.has(v.videoId)} playLabel="Assistir" />)}
        </div>
      ) : (
        <>
          {feed.unavailable && !feed.loading && <div className="ytb-notice" role="status">Não consegui falar com o YouTube agora. Você ainda pode colar um link na busca.</div>}
          <div className="ytb-grid">
            {items.map((v) => (
              <VideoCard key={v.videoId} v={v} onPlay={st.play} onQueue={st.enqueue} queued={queued.has(v.videoId)} playLabel="Assistir"
                onChannel={view.type === 'channel' ? null : (x) => { setPasted(null); setView({ type: 'channel', id: x.channelId, name: x.channel }); mainRef.current?.scrollTo?.({ top: 0 }); }} />
            ))}
            {feed.loading && <Skeletons n={feed.items.length ? 4 : 12} />}
          </div>
          <div ref={sentinelRef} className="ytb-sentinel" aria-hidden="true" />
        </>
      )}
    </main>
  );
}

export default function YouTubeApp() {
  const st = useYouTubeApp();
  const [view, setView] = useState({ type: 'trending', cat: 'now' });
  const [pasted, setPasted] = useState(null);
  const inputRef = useRef(null);
  const mainRef = useRef(null);

  useEffect(() => {
    if (!st.open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) useYouTubeApp.getState().minimize(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [st.open]);

  if (!st.open) return null;
  const onSearch = (q) => {
    const id = parseYouTubeId(q);
    if (id) { setPasted({ videoId: id, title: '' }); st.browse(); return; }
    setPasted(null); setView({ type: 'search', q }); st.browse();
    mainRef.current?.scrollTo?.({ top: 0 });
  };
  const openChannel = (v) => { setPasted(null); setView({ type: 'channel', id: v.channelId, name: v.channel }); st.browse(); };
  const watching = st.view === 'watch' && st.video;

  return (
    <div className="ytw-modal-back ytb-back ytp-back" onMouseDown={(e) => { if (e.target === e.currentTarget) st.minimize(); }}>
      <div className="ytb ytp" role="dialog" aria-modal="true" aria-label="YouTube">
        <header className="ytb-head">
          <div className="ytb-brand">
            <span className="ytb-logo"><Ico d={I.yt} size={20} /></span>
            <span className="ytb-brand-t"><strong>YouTube</strong><small>no Project Club</small></span>
          </div>
          <SearchBox initial="" onSearch={onSearch} inputRef={inputRef} />
          {st.video && (
            <button type="button" className={`ytb-icon-btn${watching ? ' is-on' : ''}`} onClick={() => (watching ? st.browse() : st.restore())} title={watching ? 'Explorar vídeos' : 'Voltar ao vídeo'} aria-label={watching ? 'Explorar vídeos' : 'Voltar ao vídeo'}>
              <Ico d={watching ? I.grid : I.yt} />
            </button>
          )}
          <button type="button" className="ytb-icon-btn" onClick={st.minimize} title={st.video ? 'Minimizar (continua tocando)' : 'Fechar'} aria-label="Minimizar"><Ico d={st.video ? X.mini : I.close} /></button>
          {st.video && <button type="button" className="ytb-icon-btn" onClick={st.close} title="Fechar e parar o vídeo" aria-label="Fechar"><Ico d={I.close} /></button>}
        </header>
        <div className="ytb-body">
          {watching
            ? <WatchView video={st.video} onChannel={openChannel} />
            : <BrowseView view={view} setView={setView} mainRef={mainRef} pasted={pasted} setPasted={setPasted} />}
        </div>
      </div>
    </div>
  );
}
