import { useCallback, useEffect, useRef, useState } from 'react';
import { ytSearch, ytTrending, ytRelated, ytChannel, ytSuggest, listYoutubeVideos } from '../../api/endpoints';
import { parseYouTubeId, thumb, canUseWebview } from './ytUtils.js';
import '../../styles/ytbrowser.css';
import { useMusic } from '../../music/musicStore';

// ============================================================
// Navegador do YouTube dentro do "Assistir juntos": busca com
// sugestões, chips (Em alta, Música, Jogos, Ao vivo), grade com rolagem
// infinita, "A seguir" do vídeo atual e botões de fila. Clicar num vídeo
// toca pra todo mundo (yt:open, mesma sincronização de antes).
// No app desktop ainda tem a aba "YouTube completo" (<webview>).
// ============================================================

function Ico({ d, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  );
}
const I = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4-4',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5 10 17l9-10',
  back: 'M15 5l-7 7 7 7',
  fire: 'M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.6.7-2.7 1.5-3.5.2 1.5 1 2.3 1.9 2.5C11 8 11 5.5 12 3ZM12 21a7 7 0 0 0 7-7',
  music: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  game: 'M6 9h12a3 3 0 0 1 3 3v3a2.5 2.5 0 0 1-4.5 1.5L15 15H9l-1.5 1.5A2.5 2.5 0 0 1 3 15v-3a3 3 0 0 1 3-3ZM8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01',
  live: 'M12 12h.01M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8',
  yt: 'M3.5 8.2c.2-1.6 1.3-2.7 2.9-2.8C8.2 5.2 10 5.1 12 5.1s3.8.1 5.6.3c1.6.1 2.7 1.2 2.9 2.8.2 1.3.2 2.5.2 3.8s0 2.5-.2 3.8c-.2 1.6-1.3 2.7-2.9 2.8-1.8.2-3.6.3-5.6.3s-3.8-.1-5.6-.3c-1.6-.1-2.7-1.2-2.9-2.8C3.3 14.5 3.3 13.3 3.3 12s0-2.5.2-3.8ZM10 9v6l5-3-5-3Z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  reload: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
};

const CHIPS = [
  { id: 'now', label: 'Em alta', icon: I.fire },
  { id: 'music', label: 'Música', icon: I.music },
  { id: 'gaming', label: 'Jogos', icon: I.game },
  { id: 'live', label: 'Ao vivo', icon: I.live },
];

const viewKey = (v) => `${v.type}:${v.cat || v.q || v.id || ''}`;

function fetchPage(view, continuation) {
  if (view.type === 'search') return ytSearch(view.q, continuation);
  if (view.type === 'channel') return ytChannel(view.id);
  return ytTrending(view.cat, continuation);
}

// Lista paginada de uma "visão" (em alta/busca/canal), com continuação.
function useFeed(view) {
  const [feed, setFeed] = useState({ key: null, items: [], cont: null, loading: true, unavailable: false });
  const keyRef = useRef(null);
  const busyRef = useRef(false);
  const key = viewKey(view);

  useEffect(() => {
    keyRef.current = key; busyRef.current = true;
    setFeed({ key, items: [], cont: null, loading: true, unavailable: false });
    fetchPage(view).then((d) => {
      if (keyRef.current !== key) return;
      setFeed({ key, items: d?.videos || [], cont: d?.continuation || null, loading: false, unavailable: !!d?.unavailable || !(d?.videos || []).length });
    }).catch(() => {
      if (keyRef.current === key) setFeed({ key, items: [], cont: null, loading: false, unavailable: true });
    }).finally(() => { if (keyRef.current === key) busyRef.current = false; });
    // view muda junto com key
  }, [key]);

  const more = useCallback(() => {
    if (busyRef.current || !feed.cont || feed.key !== key) return;
    busyRef.current = true;
    setFeed((f) => ({ ...f, loading: true }));
    fetchPage(view, feed.cont).then((d) => {
      if (keyRef.current !== key) return;
      setFeed((f) => {
        const seen = new Set(f.items.map((x) => x.videoId));
        const add = (d?.videos || []).filter((x) => !seen.has(x.videoId));
        return { ...f, items: f.items.concat(add), cont: add.length ? (d?.continuation || null) : null, loading: false };
      });
    }).catch(() => {
      if (keyRef.current === key) setFeed((f) => ({ ...f, cont: null, loading: false }));
    }).finally(() => { if (keyRef.current === key) busyRef.current = false; });
  }, [feed.cont, feed.key, key]);

  return { ...feed, more, current: feed.key === key };
}

function Badge({ v }) {
  if (v.live) return <span className="ytb-dur is-live">AO VIVO</span>;
  if (v.duration) return <span className="ytb-dur">{v.duration}</span>;
  return null;
}

function VideoCard({ v, onPlay, onQueue, onChannel, queued }) {
  const meta = [v.views, v.published].filter(Boolean).join(' • ');
  return (
    <article className="ytb-card" data-testid="ytb-card">
      <button type="button" className="ytb-thumb" onClick={() => onPlay(v)} aria-label={`Assistir com a call: ${v.title}`}>
        <img src={v.thumbnail || thumb(v.videoId)} alt="" loading="lazy" />
        <Badge v={v} />
        <span className="ytb-play"><Ico d="M8 5.5v13l10-6.5-10-6.5Z" size={22} /> Assistir juntos</span>
      </button>
      <div className="ytb-row">
      <div className="ytb-info">
        <button type="button" className="ytb-title" onClick={() => onPlay(v)} data-no-translate title={v.title}>{v.title}</button>
        {v.channel && (
          v.channelId && onChannel
            ? <button type="button" className="ytb-chan" onClick={() => onChannel(v)} data-no-translate>{v.channel}</button>
            : <span className="ytb-chan" data-no-translate>{v.channel}</span>
        )}
        {meta && <span className="ytb-meta">{meta}</span>}
      </div>
      {!v.live && (
        <button type="button" className="ytb-qbtn" onClick={() => { useMusic.getState().playNow({ videoId: v.videoId, title: v.title, artist: v.channel || '', thumbnail: v.thumbnail || thumb(v.videoId), duration: v.duration || '' }); }} aria-label="Ouvir só o áudio pra mim" title="Ouvir no player de música (só pra você)">
          <Ico d="M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z" size={15} />
        </button>
      )}
      {onQueue && (
        <button type="button" className={`ytb-qbtn${queued ? ' is-done' : ''}`} onClick={() => onQueue(v)} aria-label={queued ? 'Adicionado à fila' : 'Adicionar à fila'} title={queued ? 'Na fila' : 'Adicionar à fila'}>
          <Ico d={queued ? I.check : I.plus} size={16} />
        </button>
      )}
      </div>
    </article>
  );
}

function Skeletons({ n = 8 }) {
  return Array.from({ length: n }, (_, i) => (
    <div key={i} className="ytb-card ytb-skel" aria-hidden="true"><div className="ytb-thumb" /><div className="ytb-line" /><div className="ytb-line short" /></div>
  ));
}

// "A seguir" do vídeo atual — usado no navegador e no palco da chamada.
export function RelatedList({ videoId, onPlay, onQueue, compact = false }) {
  const [state, setState] = useState({ id: null, items: null });
  const [added, setAdded] = useState(() => new Set());
  useEffect(() => {
    if (!videoId) return undefined;
    let alive = true;
    setState({ id: videoId, items: null });
    ytRelated(videoId).then((d) => { if (alive) setState({ id: videoId, items: d?.videos || [] }); })
      .catch(() => { if (alive) setState({ id: videoId, items: [] }); });
    return () => { alive = false; };
  }, [videoId]);
  const items = state.id === videoId ? state.items : null;
  const queue = (v) => { onQueue(v); setAdded((s) => new Set(s).add(v.videoId)); };
  if (items === null) {
    return <div className={`ytb-rel${compact ? ' is-compact' : ''}`}>{Array.from({ length: 4 }, (_, i) => <div key={i} className="ytb-rel-item ytb-skel"><div className="ytb-rel-thumb" /><div className="ytb-line" /></div>)}</div>;
  }
  if (!items.length) return <p className="ytb-empty-line">Sem sugestões para este vídeo agora.</p>;
  return (
    <div className={`ytb-rel${compact ? ' is-compact' : ''}`} role="list" data-testid="ytb-related">
      {items.map((v) => (
        <div key={v.videoId} className="ytb-rel-item" role="listitem">
          <button type="button" className="ytb-rel-main" onClick={() => onPlay(v)} title={v.title}>
            <span className="ytb-rel-thumb"><img src={v.thumbnail || thumb(v.videoId)} alt="" loading="lazy" /><Badge v={v} /></span>
            <span className="ytb-rel-text">
              <strong data-no-translate>{v.title}</strong>
              <small data-no-translate>{v.channel}</small>
              {!compact && v.views && <small>{[v.views, v.published].filter(Boolean).join(' • ')}</small>}
            </span>
          </button>
          <button type="button" className={`ytb-qbtn${added.has(v.videoId) ? ' is-done' : ''}`} onClick={() => queue(v)} aria-label="Adicionar à fila" title="Adicionar à fila">
            <Ico d={added.has(v.videoId) ? I.check : I.plus} size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

// Campo de busca com sugestões (setas + Enter).
function SearchBox({ initial, onSearch, inputRef }) {
  const [text, setText] = useState(initial || '');
  const [sugs, setSugs] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const reqRef = useRef(0);

  useEffect(() => {
    const q = text.trim();
    if (!open || q.length < 2 || parseYouTubeId(q)) { setSugs([]); return undefined; }
    const n = ++reqRef.current;
    const t = setTimeout(() => {
      ytSuggest(q).then((d) => { if (reqRef.current === n) { setSugs(d?.suggestions || []); setHi(-1); } }).catch(() => {});
    }, 180);
    return () => clearTimeout(t);
  }, [text, open]);

  const submit = (val) => {
    const q = String(val ?? text).trim();
    if (!q) return;
    setText(q); setOpen(false); setSugs([]);
    onSearch(q);
  };
  const onKey = (e) => {
    if (!sugs.length || !open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % sugs.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h <= 0 ? sugs.length - 1 : h - 1)); }
    else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); submit(sugs[hi]); }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
  };

  return (
    <form className="ytb-search" role="search" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="ytb-search-box">
        <input
          ref={inputRef} value={text} onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={onKey}
          placeholder="Pesquisar no YouTube ou colar um link" aria-label="Pesquisar no YouTube ou colar um link"
          role="combobox" aria-expanded={open && sugs.length > 0} aria-controls="ytb-sugs" aria-autocomplete="list"
          data-testid="ytb-input"
        />
        {text && <button type="button" className="ytb-clear" onClick={() => { setText(''); inputRef.current?.focus(); }} aria-label="Limpar"><Ico d={I.close} size={16} /></button>}
        {open && sugs.length > 0 && (
          <ul id="ytb-sugs" className="ytb-sugs" role="listbox" data-testid="ytb-sugs">
            {sugs.map((s, i) => (
              <li key={s} role="option" aria-selected={i === hi} className={i === hi ? 'is-hi' : ''} onMouseDown={(e) => { e.preventDefault(); submit(s); }}>
                <Ico d={I.search} size={15} /> <span data-no-translate>{s}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="submit" className="ytb-search-btn" aria-label="Pesquisar"><Ico d={I.search} /></button>
    </form>
  );
}

// Aba "YouTube completo" (só no app desktop): youtube.com de verdade num
// <webview> isolado; numa página /watch?v= aparece "Assistir com a call".
function YouTubeWebview({ onWatch }) {
  const hostRef = useRef(null);
  const wvRef = useRef(null);
  const [url, setUrl] = useState('https://www.youtube.com/');
  const [canBack, setCanBack] = useState(false);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:youtube');
    wv.setAttribute('src', 'https://www.youtube.com/');
    wv.className = 'ytb-webview';
    const onNav = (e) => { if (e?.url) setUrl(e.url); try { setCanBack(wv.canGoBack()); } catch { /* ignora */ } };
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    host.appendChild(wv);
    wvRef.current = wv;
    return () => {
      wv.removeEventListener('did-navigate', onNav);
      wv.removeEventListener('did-navigate-in-page', onNav);
      wv.remove();
      wvRef.current = null;
    };
  }, []);
  const id = parseYouTubeId(url);
  const watch = () => {
    // Pausa o vídeo do webview pra não tocar em dobro.
    try { wvRef.current?.executeJavaScript("document.querySelectorAll('video').forEach(v=>v.pause())"); } catch { /* ignora */ }
    let title = '';
    try { title = (wvRef.current?.getTitle?.() || '').replace(/\s*-\s*YouTube\s*$/, ''); } catch { /* ignora */ }
    onWatch({ videoId: id, title });
  };
  return (
    <div className="ytb-full">
      <div className="ytb-full-bar">
        <button type="button" className="ytb-icon-btn" disabled={!canBack} onClick={() => { try { wvRef.current?.goBack(); } catch { /* ignora */ } }} aria-label="Voltar"><Ico d={I.back} /></button>
        <button type="button" className="ytb-icon-btn" onClick={() => { try { wvRef.current?.reload(); } catch { /* ignora */ } }} aria-label="Recarregar"><Ico d={I.reload} /></button>
        <span className="ytb-full-url truncate" data-no-translate>{url.replace(/^https:\/\//, '')}</span>
        <button type="button" className="ytb-primary" disabled={!id} onClick={watch} title={id ? 'Toca este vídeo pra todo mundo da chamada' : 'Abra um vídeo para assistir com a call'}>
          <Ico d={I.yt} size={16} /> Assistir com a call
        </button>
      </div>
      <div className="ytb-full-host" ref={hostRef} />
    </div>
  );
}

export default function YouTubeBrowser({ yt, onClose }) {
  const [view, setView] = useState({ type: 'trending', cat: 'now' });
  const [tab, setTab] = useState('browse');
  const [queued, setQueued] = useState(() => new Set());
  const [fallback, setFallback] = useState(null);
  const [pasted, setPasted] = useState(null);
  const inputRef = useRef(null);
  const mainRef = useRef(null);
  const sentinelRef = useRef(null);
  const feed = useFeed(view);
  const active = yt.active;
  const currentId = yt.state?.videoId || null;
  const webview = canUseWebview();

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Rolagem infinita.
  const { more } = feed;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) more(); }, { root: mainRef.current, rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more, tab]);

  // YouTube fora do ar: mostra os vídeos do canal do Project Club.
  useEffect(() => {
    if (!feed.unavailable || fallback) return;
    listYoutubeVideos().then((d) => setFallback((d?.videos || []).map((v) => ({ videoId: v.videoId, title: v.title, thumbnail: v.thumbnailUrl, channel: 'Mr. Pinguim', channelId: null })))).catch(() => setFallback([]));
  }, [feed.unavailable, fallback]);

  const play = (v) => { yt.emit('yt:open', { videoId: v.videoId, title: v.title || undefined, mode: 'video' }); onClose(); };
  const queue = (v) => {
    yt.emit('yt:queue:add', { videoId: v.videoId, title: v.title || undefined });
    setQueued((s) => new Set(s).add(v.videoId));
  };
  const onSearch = (q) => {
    const id = parseYouTubeId(q);
    if (id) { setPasted({ videoId: id, title: '' }); return; }
    setPasted(null);
    setView({ type: 'search', q });
    mainRef.current?.scrollTo?.({ top: 0 });
  };
  const openChannel = (v) => { setPasted(null); setView({ type: 'channel', id: v.channelId, name: v.channel }); mainRef.current?.scrollTo?.({ top: 0 }); };

  const items = feed.items.length ? feed.items : (feed.unavailable && !feed.loading ? (fallback || []) : []);
  let heading = null;
  if (view.type === 'search') heading = <>Resultados para <q data-no-translate>{view.q}</q></>;
  if (view.type === 'channel') heading = <span data-no-translate>{view.name || 'Canal'}</span>;

  return (
    <div className="ytw-modal-back ytb-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ytb" role="dialog" aria-modal="true" aria-label="YouTube - Assistir juntos" data-testid="ytb">
        <header className="ytb-head">
          <div className="ytb-brand">
            <span className="ytb-logo"><Ico d={I.yt} size={20} /></span>
            <span className="ytb-brand-t"><strong>YouTube</strong><small>Assistir juntos</small></span>
          </div>
          {tab === 'browse' && <SearchBox initial="" onSearch={onSearch} inputRef={inputRef} />}
          {tab !== 'browse' && <span className="ytb-grow" />}
          <button type="button" className="ytb-icon-btn" onClick={onClose} aria-label="Fechar"><Ico d={I.close} /></button>
        </header>

        {webview && (
          <div className="ytb-tabs" role="tablist" aria-label="Modo">
            <button type="button" role="tab" aria-selected={tab === 'browse'} className={tab === 'browse' ? 'is-on' : ''} onClick={() => setTab('browse')}><Ico d={I.grid} size={15} /> Navegar</button>
            <button type="button" role="tab" aria-selected={tab === 'full'} className={tab === 'full' ? 'is-on' : ''} onClick={() => setTab('full')}><Ico d={I.globe} size={15} /> YouTube completo</button>
          </div>
        )}

        {tab === 'full' ? <YouTubeWebview onWatch={play} /> : (
          <div className={`ytb-body${active ? ' has-side' : ''}`}>
            <main className="ytb-main" ref={mainRef}>
              <div className="ytb-chips" role="toolbar" aria-label="Categorias">
                {view.type !== 'trending' && (
                  <button type="button" className="ytb-chip" onClick={() => { setPasted(null); setView({ type: 'trending', cat: 'now' }); }} aria-label="Voltar para Em alta"><Ico d={I.back} size={15} /></button>
                )}
                {CHIPS.map((c) => (
                  <button
                    key={c.id} type="button" aria-pressed={view.type === 'trending' && view.cat === c.id}
                    className={`ytb-chip${view.type === 'trending' && view.cat === c.id ? ' is-on' : ''}`}
                    onClick={() => { setPasted(null); setView({ type: 'trending', cat: c.id }); mainRef.current?.scrollTo?.({ top: 0 }); }}
                  ><Ico d={c.icon} size={15} /> {c.label}</button>
                ))}
              </div>

              {pasted && (
                <div className="ytb-pasted" data-testid="ytb-pasted">
                  <img src={thumb(pasted.videoId)} alt="" />
                  <div>
                    <strong>Link do YouTube</strong>
                    <small data-no-translate>Vídeo {pasted.videoId}</small>
                    <div className="ytb-pasted-actions">
                      <button type="button" className="ytb-primary" onClick={() => play(pasted)}>Assistir juntos</button>
                      {active && <button type="button" className="ytb-ghost" onClick={() => queue(pasted)}>{queued.has(pasted.videoId) ? 'Na fila' : 'Adicionar à fila'}</button>}
                    </div>
                  </div>
                </div>
              )}

              {heading && <h3 className="ytb-h">{heading}</h3>}
              {feed.unavailable && !feed.loading && (
                <div className="ytb-notice" role="status">
                  Não consegui falar com o YouTube agora. Você ainda pode colar um link na busca{fallback?.length ? ' ou escolher um vídeo do canal abaixo' : ''}.
                </div>
              )}

              <div className="ytb-grid" data-testid="ytb-grid">
                {items.map((v) => (
                  <VideoCard
                    key={v.videoId} v={v} onPlay={play} queued={queued.has(v.videoId)}
                    onQueue={active ? queue : null} onChannel={view.type === 'channel' ? null : openChannel}
                  />
                ))}
                {feed.loading && <Skeletons n={feed.items.length ? 4 : 12} />}
              </div>
              <div ref={sentinelRef} className="ytb-sentinel" aria-hidden="true" />
              {!feed.loading && feed.current && !feed.cont && feed.items.length > 0 && <p className="ytb-end">Fim dos resultados</p>}
            </main>

            {active && currentId && (
              <aside className="ytb-side" aria-label="Tocando agora e a seguir">
                <div className="ytb-now">
                  <img src={thumb(currentId)} alt="" />
                  <div><small>Tocando na call</small><strong data-no-translate>{yt.state?.title || 'Vídeo atual'}</strong></div>
                </div>
                <p className="ytb-side-h">A seguir</p>
                <RelatedList videoId={currentId} onPlay={play} onQueue={queue} />
              </aside>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
