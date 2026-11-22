import { useCallback, useEffect, useRef, useState } from 'react';
import { MusicBrowse, Results, useMusicSearch, Ico, I } from './MusicPlayer.jsx';
import {
  musicStatus, musicResolve, musicDisconnect,
  spotifySearch, spotifyConnectUrl, spotifyPlaylists, spotifyPlaylistTracks,
  lastfmSearch, lastfmTop, lastfmConnect, lastfmList,
  ytAddPlaylist, ytRemovePlaylist, ytPlaylistTracks,
} from '../api/endpoints';

// "Música" (antes YouTube Music): a pessoa escolhe o serviço — YouTube
// Music, Spotify ou Last.fm —, usa sem conta (busca) ou conecta a conta pra
// abrir as playlists dela. Tudo toca pelo YouTube (player sincronizado da
// call / player pessoal): música do Spotify/Last.fm é procurada no YouTube
// na hora de tocar (server/src/services/music.js → resolve).

export const SERVICES = [
  { id: 'youtube', label: 'YouTube Music', color: '#ff0033' },
  { id: 'spotify', label: 'Spotify', color: '#1ed760' },
  { id: 'lastfm', label: 'Last.fm', color: '#d51007' },
];
const LOGO = {
  youtube: 'M10 8.5v7l6-3.5zM12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  spotify: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7 9.5c3.5-1 7-.7 10 1M7.5 12.5c3-.8 6-.5 8.5 1M8 15.5c2.4-.6 4.7-.4 6.8.8',
  lastfm: 'M10.5 16.2 9.8 14.3s-1.1 1.2-2.8 1.2C5.5 15.5 4.4 14.2 4.4 12c0-2.8 1.4-3.8 2.8-3.8 2 0 2.6 1.3 3.2 3l.7 2.2c.7 2.2 2.1 3.9 6 3.9 2.8 0 4.7-.9 4.7-3 0-1.7-1-2.6-2.8-3l-1.3-.3c-.9-.2-1.2-.6-1.2-1.2 0-.7.6-1.2 1.5-1.2 1 0 1.6.4 1.7 1.3l2-.2c-.2-1.9-1.4-2.6-3.6-2.6-1.9 0-3.7.7-3.7 3 0 1.5.7 2.4 2.5 2.8l1.4.3c1 .2 1.4.7 1.4 1.3 0 .8-.8 1.1-2.2 1.1-2.2 0-3.1-1.1-3.6-2.7l-.7-2.2C10.6 7.6 9.4 6.1 6.8 6.1 4 6.1 2.6 7.9 2.6 12c0 4 2 5.6 4.6 5.6 2 0 3.3-1.4 3.3-1.4z',
};
export function ServiceLogo({ id, size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={LOGO[id]} /></svg>;
}

const errOf = (e, fb) => e?.response?.data?.error || fb;

// Faixa de qualquer serviço → faixa do YouTube (com videoId) pra tocar.
export async function toPlayable(t) {
  if (t.videoId) return t;
  const r = await musicResolve(t.title, t.artist);
  return { videoId: r.videoId, title: t.title, artist: t.artist || r.channel, thumbnail: t.thumbnail || r.thumbnail, duration: r.duration || '' };
}

function useMusicStatus() {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState('');
  const reload = useCallback(() => musicStatus().then(setSt).catch((e) => setErr(errOf(e, 'Não deu pra carregar os serviços de música.'))), []);
  useEffect(() => { reload(); }, [reload]);
  return { st, setSt, err, reload };
}

// Lista de músicas com "abrir uma playlist" (voltar), estado de carregando.
function TrackList({ load, deps, onPlay, onAdd, busyId, empty }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setItems(null); setError('');
    load().then((d) => { if (alive) setItems(d); }).catch((e) => { if (alive) { setItems([]); setError(errOf(e, 'Não deu pra carregar.')); } });
    return () => { alive = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="mu-empty">{error}</p>;
  if (items && !items.length && empty) return <p className="mu-empty">{empty}</p>;
  return <Results items={items || []} loading={items === null} onPlay={onPlay} onAdd={onAdd} busyId={busyId} />;
}

function PlaylistGrid({ lists, onOpen, onRemove }) {
  return (
    <div className="mu-pl-grid">
      {lists.map((p) => (
        <div key={p.id} className="mu-pl">
          <button type="button" className="mu-pl-main" onClick={() => onOpen(p)}>
            {p.thumbnail ? <img src={p.thumbnail} alt="" loading="lazy" /> : <span className="mu-noart"><Ico d={I.list} size={20} /></span>}
            <span className="mu-row-text"><b data-no-translate>{p.title}</b>{p.count != null && <small>{p.count} músicas</small>}</span>
          </button>
          {onRemove && <button type="button" className="mu-icon-btn" onClick={() => onRemove(p)} aria-label={`Tirar ${p.title}`}><Ico d={I.x} size={14} /></button>}
        </div>
      ))}
    </div>
  );
}

function SearchBox({ placeholder, onSearch }) {
  const [q, setQ] = useState('');
  return (
    <form className="mu-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) onSearch(q.trim()); }}>
      <Ico d={I.search} size={16} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </form>
  );
}

function NotConfigured({ name }) {
  return (
    <div className="mu-notice">
      <strong>{name} ainda não foi configurado</strong>
      <p>A equipe precisa colar as chaves em Painel da Equipe → Música. Enquanto isso, use o YouTube Music.</p>
    </div>
  );
}

// ---------- YouTube Music ----------
function YouTubeSource({ st, setSt, onPlay, onAdd, busyId }) {
  const ms = useMusicSearch();
  const [view, setView] = useState('browse'); // browse | lists | <playlist>
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => { ms.run(null, { q: null }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const lists = st?.youtube?.playlists || [];
  const add = async (e) => {
    e.preventDefault();
    if (!link.trim()) return;
    setAdding(true); setError('');
    try { setSt(await ytAddPlaylist(link.trim())); setLink(''); } catch (err) { setError(errOf(err, 'Não deu pra adicionar a playlist.')); } finally { setAdding(false); }
  };
  if (view !== 'browse' && view !== 'lists') {
    return (
      <>
        <button type="button" className="mu-back" onClick={() => setView('lists')}>← {view.title}</button>
        <TrackList load={() => ytPlaylistTracks(view.id).then((d) => d.tracks)} deps={[view.id]} onPlay={onPlay} onAdd={onAdd} busyId={busyId} empty="Playlist vazia." />
      </>
    );
  }
  return (
    <>
      <div className="mu-subtabs">
        <button type="button" className={view === 'browse' ? 'on' : ''} onClick={() => setView('browse')}>Explorar</button>
        <button type="button" className={view === 'lists' ? 'on' : ''} onClick={() => setView('lists')}>Minhas playlists{lists.length ? ` (${lists.length})` : ''}</button>
      </div>
      {view === 'browse' ? <MusicBrowse ms={ms} onPlay={onPlay} onAdd={onAdd} /> : (
        <>
          <form className="mu-connect" onSubmit={add}>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Cole o link de uma playlist do YouTube ou YouTube Music" aria-label="Link da playlist" />
            <button type="submit" className="btn-primary" disabled={adding || !link.trim()}>{adding ? 'Abrindo…' : 'Adicionar'}</button>
          </form>
          <p className="mu-hint">Sem login: a playlist precisa ser pública ou "não listada". Ela fica salva na sua conta do Project Club.</p>
          {error && <p className="mu-error">{error}</p>}
          {lists.length ? <PlaylistGrid lists={lists} onOpen={(p) => setView(p)} onRemove={async (p) => setSt(await ytRemovePlaylist(p.id))} /> : <p className="mu-empty">Nenhuma playlist ainda.</p>}
        </>
      )}
    </>
  );
}

// ---------- Spotify ----------
function SpotifySource({ st, reload, setSt, onPlay, onAdd, busyId }) {
  const s = st?.spotify;
  const [view, setView] = useState(s?.connected ? 'lists' : 'search');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const popupRef = useRef(null);
  useEffect(() => () => clearInterval(popupRef.current), []);
  if (!s?.configured) return <NotConfigured name="O Spotify" />;
  const connect = async () => {
    setError('');
    try {
      const { url } = await spotifyConnectUrl();
      const w = window.open(url, 'spotify-login', 'width=480,height=720');
      if (!w) { window.location.href = url; return; }
      // Quando a janelinha do Spotify fechar (ou voltar pro site), recarrega.
      clearInterval(popupRef.current);
      popupRef.current = setInterval(() => {
        let back = false;
        try { back = w.closed || w.location.origin === window.location.origin; } catch { back = false; }
        if (back) { clearInterval(popupRef.current); try { w.close(); } catch { /* */ } reload(); setView('lists'); }
      }, 700);
    } catch (e) { setError(errOf(e, 'Não deu pra abrir o login do Spotify.')); }
  };
  return (
    <>
      <div className="mu-account" style={{ '--svc': '#1ed760' }}>
        {s.connected ? (
          <>
            <span>Conectado como <b data-no-translate>{s.name}</b></span>
            <button type="button" className="mu-link-btn" onClick={async () => { setSt(await musicDisconnect('spotify')); setView('search'); }}>Desconectar</button>
          </>
        ) : (
          <>
            <span>Use sem conta (busca) ou conecte pra ver as suas playlists.</span>
            <button type="button" className="mu-svc-btn" onClick={connect}><ServiceLogo id="spotify" size={16} /> Conectar Spotify</button>
          </>
        )}
      </div>
      {error && <p className="mu-error">{error}</p>}
      <div className="mu-subtabs">
        <button type="button" className={view === 'search' ? 'on' : ''} onClick={() => setView('search')}>Buscar</button>
        {s.connected && <button type="button" className={view !== 'search' ? 'on' : ''} onClick={() => setView('lists')}>Minhas playlists</button>}
      </div>
      {view === 'search' && (
        <>
          <SearchBox placeholder="Buscar no Spotify: música, artista…" onSearch={setQ} />
          {q ? <TrackList load={() => spotifySearch(q).then((d) => d.tracks)} deps={[q]} onPlay={onPlay} onAdd={onAdd} busyId={busyId} empty="Nada encontrado." /> : <p className="mu-empty">Busque uma música do Spotify. Ela toca pelo YouTube (funciona pra todo mundo, sem Premium).</p>}
        </>
      )}
      {view === 'lists' && s.connected && (
        <TrackListOrLists
          loadLists={() => spotifyPlaylists().then((d) => d.playlists)}
          loadTracks={(p) => spotifyPlaylistTracks(p.id).then((d) => d.tracks)}
          onPlay={onPlay} onAdd={onAdd} busyId={busyId}
        />
      )}
    </>
  );
}

function TrackListOrLists({ loadLists, loadTracks, onPlay, onAdd, busyId, staticLists = null }) {
  const [lists, setLists] = useState(staticLists);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (staticLists) return undefined;
    let alive = true;
    loadLists().then((l) => { if (alive) setLists(l); }).catch((e) => { if (alive) { setLists([]); setError(errOf(e, 'Não deu pra carregar as playlists.')); } });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (open) {
    return (
      <>
        <button type="button" className="mu-back" onClick={() => setOpen(null)}>← {open.title}</button>
        <TrackList load={() => loadTracks(open)} deps={[open.id]} onPlay={onPlay} onAdd={onAdd} busyId={busyId} empty="Nenhuma música aqui." />
      </>
    );
  }
  if (error) return <p className="mu-error">{error}</p>;
  if (!lists) return <div className="mu-list">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="mu-row mu-skel" />)}</div>;
  return lists.length ? <PlaylistGrid lists={lists} onOpen={setOpen} /> : <p className="mu-empty">Nenhuma playlist.</p>;
}

// ---------- Last.fm ----------
function LastfmSource({ st, setSt, onPlay, onAdd, busyId }) {
  const s = st?.lastfm;
  const [view, setView] = useState(s?.connected ? 'lists' : 'top');
  const [q, setQ] = useState('');
  const [user, setUser] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!s?.configured) return <NotConfigured name="O Last.fm" />;
  const connect = async (e) => {
    e.preventDefault();
    if (!user.trim()) return;
    setBusy(true); setError('');
    try { setSt(await lastfmConnect(user.trim())); setView('lists'); } catch (err) { setError(errOf(err, 'Não deu pra conectar.')); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="mu-account" style={{ '--svc': '#d51007' }}>
        {s.connected ? (
          <>
            <span>Conectado como <b data-no-translate>{s.name}</b></span>
            <button type="button" className="mu-link-btn" onClick={async () => { setSt(await musicDisconnect('lastfm')); setView('top'); }}>Desconectar</button>
          </>
        ) : (
          <form className="mu-connect" onSubmit={connect}>
            <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Seu usuário do Last.fm" aria-label="Usuário do Last.fm" />
            <button type="submit" className="mu-svc-btn" disabled={busy || !user.trim()}><ServiceLogo id="lastfm" size={16} /> {busy ? 'Conectando…' : 'Conectar'}</button>
          </form>
        )}
      </div>
      {error && <p className="mu-error">{error}</p>}
      <div className="mu-subtabs">
        <button type="button" className={view === 'top' ? 'on' : ''} onClick={() => setView('top')}>Em alta no Brasil</button>
        <button type="button" className={view === 'search' ? 'on' : ''} onClick={() => setView('search')}>Buscar</button>
        {s.connected && <button type="button" className={view === 'lists' ? 'on' : ''} onClick={() => setView('lists')}>Minhas listas</button>}
      </div>
      {view === 'top' && <TrackList load={() => lastfmTop().then((d) => d.tracks)} deps={['top']} onPlay={onPlay} onAdd={onAdd} busyId={busyId} />}
      {view === 'search' && (
        <>
          <SearchBox placeholder="Buscar no Last.fm: música…" onSearch={setQ} />
          {q && <TrackList load={() => lastfmSearch(q).then((d) => d.tracks)} deps={[q]} onPlay={onPlay} onAdd={onAdd} busyId={busyId} empty="Nada encontrado." />}
        </>
      )}
      {view === 'lists' && s.connected && (
        <TrackListOrLists staticLists={s.lists} loadTracks={(l) => lastfmList(l.id).then((d) => d.tracks)} onPlay={onPlay} onAdd={onAdd} busyId={busyId} />
      )}
    </>
  );
}

/**
 * Escolher o serviço + navegar. `onPlay(track)` / `onAdd(track)` recebem a
 * faixa já com videoId (do YouTube), pronta pra tocar.
 */
export function MusicSources({ onPlay, onAdd, initialService }) {
  const { st, setSt, err, reload } = useMusicStatus();
  const [svc, setSvc] = useState(() => initialService || (() => { try { return localStorage.getItem('pc-music-service') || 'youtube'; } catch { return 'youtube'; } })());
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { try { localStorage.setItem('pc-music-service', svc); } catch { /* */ } }, [svc]);
  const wrap = (fn) => fn && (async (t) => {
    setBusyId(t.videoId || t.id); setError('');
    try { await fn(await toPlayable(t)); } catch (e) { setError(errOf(e, 'Não achei essa música pra tocar.')); } finally { setBusyId(null); }
  });
  const props = { st, setSt, reload, onPlay: wrap(onPlay), onAdd: wrap(onAdd), busyId };
  return (
    <div className="mu-sources">
      <div className="mu-services" role="tablist" aria-label="Serviço de música">
        {SERVICES.map((s) => (
          <button
            key={s.id} type="button" role="tab" aria-selected={svc === s.id}
            className={`mu-service${svc === s.id ? ' on' : ''}`} style={{ '--svc': s.color }}
            onClick={() => { setSvc(s.id); setError(''); }}
          >
            <ServiceLogo id={s.id} /> {s.label}
            {st?.[s.id]?.connected && <span className="mu-dot" title="Conta conectada" />}
          </button>
        ))}
      </div>
      {err && <p className="mu-error">{err}</p>}
      {error && <p className="mu-error" role="alert">{error}</p>}
      {svc === 'youtube' && <YouTubeSource key="yt" {...props} />}
      {svc === 'spotify' && (st ? <SpotifySource key="sp" {...props} /> : <p className="mu-empty">Carregando…</p>)}
      {svc === 'lastfm' && (st ? <LastfmSource key="lf" {...props} /> : <p className="mu-empty">Carregando…</p>)}
    </div>
  );
}
