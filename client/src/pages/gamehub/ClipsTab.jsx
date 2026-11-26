import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '../../components/Modal.jsx';
import UserAvatar from '../../components/UserAvatar.jsx';
import { useStore } from '../../store/useStore';
import { createClip, deleteClip, likeClip, listClips } from '../../api/gameHub';
import { HubPage } from './GameHubShell.jsx';
import { EmptyState, GameCover, GamePicker, Ico, agoLabel, errText, useLoad } from './shared.jsx';

// Game Hub → Clipes. O vídeo nunca vai pro nosso servidor:
//  - "Do clube": clipes que a galera publicou com link (YouTube, Twitch,
//    Medal, Streamable) — guardamos só o link, o título e o jogo;
//  - "Neste PC": a pasta de clipes do app do PC (Alt+F10 salva os últimos
//    30 s). Lista, toca e organiza direto da pasta; pra mostrar pro clube,
//    sobe num site de vídeo e publica o link.

const notice = (m) => useStore.getState().pushNotice(m);
const PROVIDERS = { youtube: 'YouTube', twitch: 'Twitch', medal: 'Medal', streamable: 'Streamable' };
const clipsApi = () => (typeof window !== 'undefined' ? window.electronAPI?.clips : null);
const hasLibrary = () => typeof clipsApi()?.library === 'function';

function embedUrl(clip) {
  const host = window.location.hostname;
  if (clip.provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${clip.embedId}?autoplay=1&rel=0`;
  if (clip.provider === 'twitch') return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(clip.embedId)}&parent=${encodeURIComponent(host)}&autoplay=true`;
  if (clip.provider === 'streamable') return `https://streamable.com/e/${clip.embedId}?autoplay=1`;
  return null; // Medal: abre no site deles
}

export function ClipCard({ clip, onOpen, onLike }) {
  return (
    <article className="gh-clip">
      <button type="button" className="gh-clip-art" onClick={() => onOpen(clip)} aria-label={`Assistir ${clip.title}`}>
        <GameCover src={clip.thumb} appId={clip.game?.steamAppId} name={clip.game?.name || ''} />
        <span className="gh-clip-play"><Ico name="play" size={22} /></span>
        <span className={`gh-clip-prov p-${clip.provider}`}>{PROVIDERS[clip.provider]}</span>
      </button>
      <div className="gh-clip-body">
        <strong className="gh-clip-title truncate" title={clip.title}>{clip.title}</strong>
        <div className="gh-clip-meta">
          {clip.author && <UserAvatar user={clip.author} size={20} />}
          <span className="truncate">{clip.author?.displayName}{clip.game ? ` · ${clip.game.name}` : ''}</span>
          {onLike && (
            <button type="button" className={`gh-like${clip.liked ? ' on' : ''}`} aria-pressed={clip.liked} aria-label={clip.liked ? 'Descurtir' : 'Curtir'} onClick={() => onLike(clip)}>
              <Ico name="heart" size={15} />{clip.likesCount > 0 && <span>{clip.likesCount}</span>}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function ClipPlayer({ clip, onClose, onDelete }) {
  const src = embedUrl(clip);
  return (
    <Modal title={clip.title} onClose={onClose} width="880px" className="gh-player-modal">
      <div className="gh-player">
        {src ? (
          <iframe src={src} title={clip.title} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        ) : (
          <div className="gh-player-out">
            <p>Esse clipe abre no site do {PROVIDERS[clip.provider]}.</p>
            <a className="gh-btn is-primary" href={clip.url} target="_blank" rel="noopener noreferrer"><Ico name="external" size={15} /> Abrir clipe</a>
          </div>
        )}
      </div>
      <div className="gh-player-foot">
        {clip.author && <span className="gh-player-who"><UserAvatar user={clip.author} size={22} /> {clip.author.displayName} · {agoLabel(clip.createdAt)}{clip.game ? ` · ${clip.game.name}` : ''}</span>}
        <span className="gh-player-act">
          <a className="gh-link-btn" href={clip.url} target="_blank" rel="noopener noreferrer"><Ico name="external" size={14} /> Abrir no {PROVIDERS[clip.provider]}</a>
          {clip.mine && onDelete && <button type="button" className="gh-link-btn is-danger" onClick={() => onDelete(clip)}><Ico name="trash" size={14} /> Apagar</button>}
        </span>
      </div>
    </Modal>
  );
}

function PublishModal({ preset, onClose, onPublished }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState(preset?.title || '');
  const [game, setGame] = useState(preset?.game ? { name: preset.game, steamAppId: null } : null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const clip = await createClip({ url: url.trim(), title: title.trim(), gameName: game?.name || null, steamAppId: game?.steamAppId || null });
      onPublished(clip);
      onClose();
    } catch (err) { setError(errText(err, 'Não consegui publicar.')); } finally { setSaving(false); }
  };
  return (
    <Modal title="Publicar clipe" onClose={onClose} width="520px">
      <form onSubmit={submit} className="auth-form gh-form">
        {preset && (
          <p className="gh-callout">
            <Ico name="folder" size={16} />
            <span>O arquivo <b>{preset.name}</b> fica só no seu PC. Suba no YouTube, Medal ou Streamable e cole o link aqui.
              {' '}<button type="button" className="gh-link-btn" onClick={() => clipsApi()?.reveal?.(preset.name)}>Mostrar na pasta</button></span>
          </p>
        )}
        <label>
          LINK DO CLIPE
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/… ou clips.twitch.tv/…" inputMode="url" required autoFocus />
        </label>
        <label>
          TÍTULO
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Ex.: ace no último round" required />
        </label>
        <GamePicker value={game} onChange={setGame} label="JOGO (opcional)" />
        {error && <div className="auth-error">{error}</div>}
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Publicando…' : 'Publicar no clube'}</button>
      </form>
    </Modal>
  );
}

const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function LocalClips({ onPublish }) {
  const [state, setState] = useState({ loading: true, folder: '', clips: [] });
  const [show, setShow] = useState(24);
  const [playing, setPlaying] = useState(null);
  const load = useCallback(() => {
    clipsApi().library().then((r) => setState({ loading: false, folder: r?.folder || '', clips: r?.clips || [] })).catch(() => setState({ loading: false, folder: '', clips: [] }));
  }, []);
  useEffect(() => {
    load();
    const off = clipsApi()?.onSaved?.(() => load());
    return () => { if (typeof off === 'function') off(); };
  }, [load]);
  const trash = async (c) => {
    if (!window.confirm(`Mandar “${c.name}” pra Lixeira?`)) return;
    const ok = await clipsApi().trash(c.name);
    notice(ok ? 'Clipe enviado pra Lixeira.' : 'Não consegui apagar esse arquivo.');
    if (ok) { setPlaying(null); load(); }
  };
  if (state.loading) return <div className="gh-clip-grid">{[0, 1, 2, 3].map((i) => <span key={i} className="gh-skel gh-clip-skel" />)}</div>;
  return (
    <>
      <div className="gh-local-bar">
        <span className="gh-local-path truncate" title={state.folder}><Ico name="folder" size={15} /> {state.folder}</span>
        <button type="button" className="gh-btn" onClick={() => clipsApi()?.openFolder?.()}>Abrir pasta</button>
      </div>
      {state.clips.length === 0 ? (
        <EmptyState icon="film" title="Nenhum clipe nesta pasta ainda">
          Ligue os clipes em Configurações → Clipes e aperte o atalho (Alt+F10) no meio do jogo: os últimos 30 segundos vão pra essa pasta.
        </EmptyState>
      ) : (
        <>
          <div className="gh-clip-grid">
            {state.clips.slice(0, show).map((c) => (
              <article key={c.name} className="gh-clip is-local">
                <button type="button" className="gh-clip-art" onClick={() => setPlaying(c)} aria-label={`Assistir ${c.name}`}>
                  <video src={`${c.url}#t=1`} preload="metadata" muted playsInline tabIndex={-1} />
                  <span className="gh-clip-play"><Ico name="play" size={22} /></span>
                </button>
                <div className="gh-clip-body">
                  <strong className="gh-clip-title truncate" title={c.name}>{c.game || 'Clipe'}</strong>
                  <div className="gh-clip-meta"><span className="truncate">{new Date(c.recordedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {fmtSize(c.size)}</span></div>
                </div>
              </article>
            ))}
          </div>
          {state.clips.length > show && <button type="button" className="gh-btn gh-more" onClick={() => setShow((n) => n + 24)}>Mostrar mais</button>}
        </>
      )}
      {playing && (
        <Modal title={playing.game || 'Clipe'} onClose={() => setPlaying(null)} width="880px" className="gh-player-modal">
          <div className="gh-player"><video src={playing.url} controls autoPlay playsInline /></div>
          <div className="gh-player-foot">
            <span className="gh-player-who truncate">{playing.name}</span>
            <span className="gh-player-act">
              <button type="button" className="gh-link-btn" onClick={() => clipsApi()?.reveal?.(playing.name)}><Ico name="folder" size={14} /> Mostrar na pasta</button>
              <button type="button" className="gh-link-btn" onClick={() => { onPublish({ name: playing.name, game: playing.game, title: playing.game ? `${playing.game} — ` : '' }); setPlaying(null); }}><Ico name="send" size={14} /> Publicar no clube</button>
              <button type="button" className="gh-link-btn is-danger" onClick={() => trash(playing)}><Ico name="trash" size={14} /> Lixeira</button>
            </span>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function ClipsTab() {
  const desktop = !!clipsApi();
  const [view, setView] = useState('clube');
  const [mine, setMine] = useState(false);
  const { data, loading, error, reload, setData } = useLoad(() => listClips(mine ? { mine: '1' } : undefined), [mine]);
  const [open, setOpen] = useState(null);
  const [publish, setPublish] = useState(null); // null | {} | preset do PC
  const clips = useMemo(() => data?.clips || [], [data]);

  const like = async (clip) => {
    try {
      const r = await likeClip(clip.id);
      setData((d) => ({ ...d, clips: d.clips.map((c) => (c.id === clip.id ? { ...c, liked: r.liked, likesCount: r.likesCount } : c)) }));
    } catch (err) { notice(errText(err, 'Não deu pra curtir agora.')); }
  };
  const remove = async (clip) => {
    if (!window.confirm('Apagar esse clipe do clube? (o vídeo continua onde ele está)')) return;
    try { await deleteClip(clip.id); setOpen(null); setData((d) => ({ ...d, clips: d.clips.filter((c) => c.id !== clip.id) })); } catch (err) { notice(errText(err, 'Não consegui apagar.')); }
  };
  const more = async () => {
    const last = clips[clips.length - 1];
    if (!last) return;
    const r = await listClips({ ...(mine ? { mine: '1' } : {}), before: last.createdAt });
    setData((d) => ({ clips: [...d.clips, ...r.clips], more: r.more }));
  };

  return (
    <HubPage>
      <div className="gh-head">
        <div>
          <h1 className="gh-h1">Clipes</h1>
          <p className="gh-sub">Os melhores momentos da galera. O vídeo fica no seu PC ou no site de vídeo — aqui vai só o link.</p>
        </div>
        <button type="button" className="gh-btn is-primary is-lg" onClick={() => setPublish({})}><Ico name="link" size={17} /> Publicar clipe</button>
      </div>
      <div className="gh-chips" role="tablist" aria-label="Clipes">
        <button type="button" role="tab" aria-selected={view === 'clube' && !mine} className={`gh-chip${view === 'clube' && !mine ? ' on' : ''}`} onClick={() => { setView('clube'); setMine(false); }}>Do clube</button>
        <button type="button" role="tab" aria-selected={view === 'clube' && mine} className={`gh-chip${view === 'clube' && mine ? ' on' : ''}`} onClick={() => { setView('clube'); setMine(true); }}>Meus publicados</button>
        <button type="button" role="tab" aria-selected={view === 'pc'} className={`gh-chip${view === 'pc' ? ' on' : ''}`} onClick={() => setView('pc')}><Ico name="folder" size={14} /> Neste PC</button>
      </div>

      {view === 'pc' ? (
        hasLibrary() ? <LocalClips onPublish={setPublish} /> : (
          <EmptyState icon="folder" title={desktop ? 'Atualize o app do PC' : 'Seus clipes ficam no app do PC'}>
            {desktop
              ? 'Essa versão do app ainda não mostra a pasta de clipes. Ele se atualiza sozinho; feche e abra de novo.'
              : 'No app do Project Club pro computador, o atalho Alt+F10 salva os últimos 30 segundos do jogo numa pasta do seu PC — e eles aparecem aqui.'}
          </EmptyState>
        )
      ) : loading && !data ? (
        <div className="gh-clip-grid">{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className="gh-skel gh-clip-skel" />)}</div>
      ) : error && !data ? (
        <EmptyState icon="film" title="Os clipes não carregaram" action={<button type="button" className="gh-btn" onClick={reload}>Tentar de novo</button>} />
      ) : clips.length === 0 ? (
        <EmptyState icon="film" title={mine ? 'Você ainda não publicou clipes' : 'Nenhum clipe ainda'} action={<button type="button" className="gh-btn is-primary" onClick={() => setPublish({})}><Ico name="link" size={16} /> Publicar o primeiro</button>}>
          Cole o link de um clipe do YouTube, Twitch, Medal ou Streamable.
        </EmptyState>
      ) : (
        <>
          <div className="gh-clip-grid">{clips.map((c) => <ClipCard key={c.id} clip={c} onOpen={setOpen} onLike={like} />)}</div>
          {data?.more && <button type="button" className="gh-btn gh-more" onClick={more}>Mostrar mais</button>}
        </>
      )}

      {open && <ClipPlayer clip={open} onClose={() => setOpen(null)} onDelete={remove} />}
      {publish && <PublishModal preset={publish.name ? publish : null} onClose={() => setPublish(null)} onPublished={(c) => { setView('clube'); setData((d) => ({ ...(d || {}), clips: [c, ...((d && d.clips) || [])] })); notice('Clipe publicado!'); }} />}
    </HubPage>
  );
}
