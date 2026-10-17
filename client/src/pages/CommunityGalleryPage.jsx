import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { listCommunityGallery } from '../api/endpoints';
import { FeaturedGlyph } from '../components/FeaturedChannels.jsx';
import ChannelIcon from '../components/ChannelIcon.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { proxyImage } from '../utils/imageProxy';
import '../styles/channels.css';
import { useLiveRefresh, mergeFirstPage } from '../utils/liveRefresh';
import { useSocket } from '../context/SocketContext.jsx';
import {
  lookupGalleryLikes, toggleGalleryLike, listTopGallery,
  listGalleryAlbums, getGalleryAlbum, createGalleryAlbum, deleteGalleryAlbum, updateGalleryAlbum,
  addToGalleryAlbum, removeFromGalleryAlbum,
} from '../api/contentx';
import '../styles/contentx.css';
import { channelPath, postPath } from '../utils/prettyLinks';

// Ícones locais (traço) da Galeria nova: curtir, álbum, ordenar.
const GI = {
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  album: 'M4 7h16v12H4zM7 4h10M9 12l2 2 4-4',
  plus: 'M12 5v14M5 12h14',
  back: 'm15 18-6-6 6-6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  pen: 'M4 20h4L19 9l-4-4L4 16v4Z',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M20 6 9 17l-5-5',
};
function GIcon({ name, size = 16, filled = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={GI[name]} /></svg>
  );
}

// Curtidas: { [itemKey]: { count, liked } } — busca só o que ainda não sabe,
// e escuta 'gallery:like' pra contagem mudar ao vivo.
function useGalleryLikes(items) {
  const { socket } = useSocket() || {};
  const [likes, setLikes] = useState({});
  const keys = useMemo(() => (items || []).map((i) => i.id), [items]);
  useEffect(() => {
    const missing = keys.filter((k) => likes[k] === undefined).slice(0, 200);
    if (!missing.length) return;
    let alive = true;
    lookupGalleryLikes(missing).then((d) => {
      if (!alive) return;
      const mine = new Set(d.mine || []);
      setLikes((cur) => {
        const next = { ...cur };
        for (const k of missing) next[k] = { count: d.counts?.[k] || 0, liked: mine.has(k) };
        return next;
      });
    }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  useEffect(() => {
    if (!socket) return undefined;
    const on = ({ key, count }) => setLikes((cur) => (cur[key] ? { ...cur, [key]: { ...cur[key], count } } : cur));
    socket.on('gallery:like', on);
    return () => socket.off('gallery:like', on);
  }, [socket]);
  const seed = useCallback((counts, mine) => {
    const mineSet = new Set(mine || []);
    setLikes((cur) => {
      const next = { ...cur };
      for (const [k, c] of Object.entries(counts || {})) next[k] = { count: c, liked: mineSet.has(k) };
      return next;
    });
  }, []);
  const toggle = useCallback(async (key) => {
    const prev = likes[key] || { count: 0, liked: false };
    setLikes((cur) => ({ ...cur, [key]: { count: Math.max(0, prev.count + (prev.liked ? -1 : 1)), liked: !prev.liked } }));
    try {
      const r = await toggleGalleryLike(key);
      setLikes((cur) => ({ ...cur, [key]: { count: r.count, liked: r.liked } }));
    } catch { setLikes((cur) => ({ ...cur, [key]: prev })); }
  }, [likes]);
  return { likes, toggle, seed };
}

// Canal em destaque "Galeria": fotos, vídeos e GIFs que já foram postados
// na comunidade — anexos dos canais (só dos que você pode ver) e imagens
// dos posts do Feed. Nada novo para enviar: é uma vitrine do que existe.

const KINDS = [
  { key: 'all', label: 'Tudo' },
  { key: 'image', label: 'Fotos' },
  { key: 'gif', label: 'GIFs' },
  { key: 'video', label: 'Vídeos' },
];
const SOURCES = [
  { key: 'all', label: 'Todos os lugares' },
  { key: 'channels', label: 'Canais' },
  { key: 'posts', label: 'Fórum' },
];

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d} d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

function mimeOf(item) {
  if (item.kind === 'video') return 'video/mp4';
  if (item.kind === 'gif') return 'image/gif';
  return 'image/png';
}

export default function CommunityGalleryPage() {
  // Abas: Mídias (lista de sempre + "Mais curtidos") e Álbuns.
  const [section, setSection] = useState('media');
  const [albumPickFor, setAlbumPickFor] = useState(null); // item a guardar num álbum
  return (
    <div className="cx-page">
      <div className="cx-inner">
        <header className="cx-hero cx-hero-galeria">
          <span className="cx-hero-icon"><FeaturedGlyph name="image" size={26} /></span>
          <div className="cx-hero-text">
            <span className="cx-eyebrow">Canal em destaque</span>
            <h1>Galeria</h1>
            <p>Fotos, vídeos e GIFs que a galera já compartilhou nos canais e no Fórum, tudo num lugar só.</p>
          </div>
        </header>
        <div className="cxg-sections" role="tablist" aria-label="Seções da Galeria">
          <button type="button" role="tab" aria-selected={section === 'media'} className={section === 'media' ? 'active' : ''} onClick={() => setSection('media')}>
            <FeaturedGlyph name="image" size={15} /> Mídias
          </button>
          <button type="button" role="tab" aria-selected={section === 'albums'} className={section === 'albums' ? 'active' : ''} onClick={() => setSection('albums')}>
            <GIcon name="album" size={15} /> Álbuns
          </button>
        </div>
        {section === 'media' ? <GalleryMedia onAddToAlbum={setAlbumPickFor} /> : <GalleryAlbums onAddToAlbum={setAlbumPickFor} />}
      </div>
      {albumPickFor && <AlbumPicker item={albumPickFor} onClose={() => setAlbumPickFor(null)} />}
    </div>
  );
}

function GalleryMedia({ onAddToAlbum }) {
  const navigate = useNavigate();
  const openLightbox = useStore((s) => s.openLightbox);
  const [sort, setSort] = useState('recent'); // recent | top
  const [topData, setTopData] = useState(null);
  const [source, setSource] = useState('all');
  const [kind, setKind] = useState('all');
  const [items, setItems] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setItems(null); setError('');
    listCommunityGallery({ source, limit: 48 })
      .then((d) => { if (alive) { setItems(d.items || []); setNextBefore(d.nextBefore || null); } })
      .catch(() => { if (alive) { setItems([]); setError('Não foi possível carregar a galeria.'); } });
    return () => { alive = false; };
  }, [source]);

  // Tempo real (11s): busca só a 1ª página e junta com o que já foi
  // carregado (mantém "carregar mais", scroll e filtros).
  useLiveRefresh(async (ctx) => {
    const d = await listCommunityGallery({ source, limit: 48 });
    if (!ctx.ok()) return;
    const fresh = d.items || [];
    setItems((list) => (list ? mergeFirstPage(list, fresh) : list));
    // Só tinha a 1ª página: o cursor também segue a versão nova.
    setNextBefore((cur) => ((items || []).length <= fresh.length ? (d.nextBefore || null) : cur));
  }, { enabled: items !== null, key: source });

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await listCommunityGallery({ source, limit: 48, before: nextBefore });
      setItems((list) => {
        const seen = new Set((list || []).map((i) => i.id));
        return [...(list || []), ...(d.items || []).filter((i) => !seen.has(i.id))];
      });
      setNextBefore(d.nextBefore || null);
    } catch { /* tenta de novo no próximo clique */ }
    finally { setLoadingMore(false); }
  };

  // "Mais curtidos": lista própria do servidor (ordem por curtidas).
  useEffect(() => {
    if (sort !== 'top') return undefined;
    let alive = true;
    setTopData(null);
    listTopGallery({ limit: 60 }).then((d) => { if (alive) setTopData(d); }).catch(() => { if (alive) setTopData({ items: [] }); });
    return () => { alive = false; };
  }, [sort]);

  const baseItems = sort === 'top'
    ? (topData ? (topData.items || []).filter((i) => source === 'all' || (source === 'posts' ? i.source === 'post' : i.source === 'channel')) : null)
    : items;
  const { likes, toggle, seed } = useGalleryLikes(baseItems);
  useEffect(() => { if (topData) seed(topData.counts, topData.mine); }, [topData, seed]);

  const visible = useMemo(() => (baseItems || []).filter((i) => kind === 'all' || i.kind === kind), [baseItems, kind]);
  const counts = useMemo(() => {
    const c = { all: 0, image: 0, gif: 0, video: 0 };
    for (const i of baseItems || []) { c.all += 1; c[i.kind] = (c[i.kind] || 0) + 1; }
    return c;
  }, [baseItems]);

  const open = (index) => {
    openLightbox(visible.map((i) => ({ url: proxyImage(i.url), filename: i.filename || i.title || 'midia', mimeType: mimeOf(i) })), index);
  };
  const loading = baseItems === null;

  return (
    <>
        <div className="cgal-filters">
          <div className="cx-tabs" role="tablist" aria-label="Tipo de mídia">
            {KINDS.map((k) => (
              <button
                key={k.key} type="button" role="tab" aria-selected={kind === k.key}
                className={`cx-tab${kind === k.key ? ' active' : ''}`} onClick={() => setKind(k.key)}
              >
                {k.label}
                {baseItems && <span className="cx-tab-count">{counts[k.key] || 0}</span>}
              </button>
            ))}
          </div>
          <div className="cgal-sources" role="group" aria-label="De onde">
            {SOURCES.map((s) => (
              <button
                key={s.key} type="button" className={`cx-chip${source === s.key ? ' active' : ''}`}
                onClick={() => setSource(s.key)} aria-pressed={source === s.key}
              >{s.label}</button>
            ))}
            <span className="cxg-sort-sep" aria-hidden="true" />
            <button type="button" className={`cx-chip${sort === 'recent' ? ' active' : ''}`} aria-pressed={sort === 'recent'} onClick={() => setSort('recent')}>Recentes</button>
            <button type="button" className={`cx-chip${sort === 'top' ? ' active' : ''}`} aria-pressed={sort === 'top'} onClick={() => setSort('top')}>
              <GIcon name="heart" size={13} /> Mais curtidos
            </button>
          </div>
        </div>

        {loading && (
          <div className="cgal-grid">
            {Array.from({ length: 12 }, (_, i) => <div key={i} className="cx-skeleton cgal-skeleton" />)}
          </div>
        )}
        {!loading && visible.length === 0 && (
          <div className="cx-empty">
            <span className="cx-empty-icon">{sort === 'top' ? <GIcon name="heart" size={26} /> : <FeaturedGlyph name="image" size={26} />}</span>
            <h3>{error && sort !== 'top' ? 'Algo deu errado' : sort === 'top' ? 'Nenhuma curtida ainda' : 'Nada por aqui ainda'}</h3>
            <p>{sort === 'top' ? 'Curta as mídias que você gostar: as mais curtidas aparecem aqui.' : (error || 'Quando alguém mandar uma foto, vídeo ou GIF nos canais ou no Fórum, aparece aqui.')}</p>
          </div>
        )}
        {!loading && visible.length > 0 && (
          <div className="cgal-grid">
            {visible.map((item, index) => (
              <figure key={item.id} className={`cgal-tile kind-${item.kind}`}>
                <button type="button" className="cgal-media" onClick={() => open(index)} aria-label="Ampliar">
                  {item.kind === 'video'
                    ? <video src={proxyImage(item.url)} muted playsInline preload="metadata" />
                    : <img src={proxyImage(item.url)} alt={item.title || ''} loading="lazy" />}
                  {item.kind === 'video' && (
                    <span className="cgal-play" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
                    </span>
                  )}
                  {item.kind === 'gif' && <span className="cgal-kind">GIF</span>}
                </button>
                <TileActions item={item} like={likes[item.id]} onLike={() => toggle(item.id)} onAddToAlbum={() => onAddToAlbum(item)} />
                <figcaption className="cgal-caption">
                  <span className="cgal-author">
                    <UserAvatar user={item.author} size={20} />
                    <span className="truncate">{item.author?.displayName || 'Alguém'}</span>
                  </span>
                  {item.source === 'channel' && item.channel ? (
                    <button type="button" className="cgal-where" onClick={() => navigate(channelPath(item.channel))} title={`Abrir ${item.channel.name}`}>
                      <ChannelIcon channel={item.channel} className="cgal-where-icon" />
                      <span className="truncate">{item.channel.name}</span>
                    </button>
                  ) : item.source === 'post' ? (
                    <button type="button" className="cgal-where" onClick={() => navigate(postPath(item.post || item.postId))} title={item.title}>
                      <FeaturedGlyph name="feed" size={13} />
                      <span className="truncate">{item.club?.name || 'Fórum'}</span>
                    </button>
                  ) : null}
                  <span className="cgal-time">{timeAgo(item.createdAt)}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        {sort === 'recent' && items !== null && nextBefore && (
          <div className="cgal-more">
            <button type="button" className="cx-btn ghost" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Carregando...' : 'Carregar mais'}</button>
          </div>
        )}
    </>
  );
}

// Coração + contagem e "guardar em álbum", por cima da mídia.
function TileActions({ item, like, onLike, onAddToAlbum, onRemove }) {
  const liked = !!like?.liked;
  return (
    <div className="cxg-tile-actions">
      <button type="button" className={`cxg-like${liked ? ' on' : ''}`} onClick={onLike} aria-pressed={liked} aria-label={liked ? 'Descurtir' : 'Curtir'} title={liked ? 'Descurtir' : 'Curtir'}>
        <GIcon name="heart" size={15} filled={liked} />
        {like && like.count > 0 && <span>{like.count}</span>}
      </button>
      {onAddToAlbum && (
        <button type="button" className="cxg-tile-btn" onClick={onAddToAlbum} aria-label="Guardar em um álbum" title="Guardar em um álbum">
          <GIcon name="album" size={15} />
        </button>
      )}
      {onRemove && (
        <button type="button" className="cxg-tile-btn danger" onClick={onRemove} aria-label="Tirar do álbum" title={`Tirar do álbum${item.title ? `: ${item.title}` : ''}`}>
          <GIcon name="close" size={15} />
        </button>
      )}
    </div>
  );
}

// ---------- Álbuns ----------
function AlbumCover({ covers }) {
  if (!covers?.length) return <span className="cxg-album-cover empty"><GIcon name="album" size={28} /></span>;
  return (
    <span className={`cxg-album-cover n${Math.min(covers.length, 4)}`}>
      {covers.slice(0, 4).map((c, i) => (c.kind === 'video'
        ? <video key={i} src={proxyImage(c.url)} muted playsInline preload="metadata" />
        : <img key={i} src={proxyImage(c.url)} alt="" loading="lazy" />))}
    </span>
  );
}

function GalleryAlbums({ onAddToAlbum }) {
  const [albums, setAlbums] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => listGalleryAlbums().then((d) => setAlbums(d.albums || [])).catch(() => setAlbums((a) => a || [])), []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(({ put }) => listGalleryAlbums().then((d) => put(setAlbums)(d.albums || [])), { enabled: albums !== null && !openId, interval: 60000, key: 'gallery-albums' });

  if (openId) return <AlbumView id={openId} onBack={() => { setOpenId(null); load(); }} onAddToAlbum={onAddToAlbum} />;
  return (
    <>
      <div className="cxg-albums-bar">
        <p className="dim">Coleções de mídias montadas pela galera. Toque no ícone de álbum numa mídia pra guardar.</p>
        <button type="button" className="cx-btn primary" onClick={() => setCreating((v) => !v)}><GIcon name="plus" /> Novo álbum</button>
      </div>
      {creating && <AlbumForm onClose={() => setCreating(false)} onSaved={(a) => { setCreating(false); setAlbums((l) => [a, ...(l || [])]); }} />}
      {albums === null ? (
        <div className="cxg-album-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="cx-skeleton cxg-album-skel" />)}</div>
      ) : albums.length === 0 ? (
        <div className="cx-empty">
          <span className="cx-empty-icon"><GIcon name="album" size={26} /></span>
          <h3>Nenhum álbum ainda</h3>
          <p>Crie o primeiro e junte as melhores fotos, vídeos e GIFs da comunidade.</p>
        </div>
      ) : (
        <div className="cxg-album-grid">
          {albums.map((a) => (
            <button key={a.id} type="button" className="cxg-album-card" onClick={() => setOpenId(a.id)}>
              <AlbumCover covers={a.covers} />
              <span className="cxg-album-info">
                <strong className="truncate">{a.name}</strong>
                <small>{a.count === 1 ? '1 mídia' : `${a.count} mídias`}{a.createdBy ? ` · por ${a.createdBy.displayName}` : ''}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function AlbumForm({ album, onClose, onSaved }) {
  const [name, setName] = useState(album?.name || '');
  const [description, setDescription] = useState(album?.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = album ? await updateGalleryAlbum(album.id, { name, description }) : await createGalleryAlbum({ name, description });
      onSaved(r.album);
    } catch (err) { setError(err.response?.data?.error || 'Não foi possível salvar o álbum.'); }
    setBusy(false);
  };
  return (
    <form className="cev-create cxg-album-form" onSubmit={submit}>
      <label>Nome do álbum<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="Ex.: Melhores momentos" /></label>
      <label>Descrição (opcional)<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={300} /></label>
      {error && <div className="auth-error">{error}</div>}
      <div className="cev-create-actions">
        <button type="button" className="cx-btn ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" className="cx-btn primary" disabled={busy || !name.trim()}>{busy ? 'Salvando...' : album ? 'Salvar' : 'Criar álbum'}</button>
      </div>
    </form>
  );
}

function AlbumView({ id, onBack, onAddToAlbum }) {
  const openLightbox = useStore((s) => s.openLightbox);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const load = useCallback(() => getGalleryAlbum(id).then(setData).catch((err) => setError(err.response?.data?.error || 'Não foi possível abrir o álbum.')), [id]);
  useEffect(() => { load(); }, [load]);
  const items = data?.items || null;
  const { likes, toggle, seed } = useGalleryLikes(items);
  useEffect(() => { if (data) seed(data.counts, data.mine); }, [data, seed]);

  if (error) return <div className="cx-empty"><h3>Ops</h3><p>{error}</p><button type="button" className="cx-btn ghost" onClick={onBack}>Voltar</button></div>;
  if (!data) return <div className="cgal-grid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="cx-skeleton cgal-skeleton" />)}</div>;
  const { album } = data;
  const remove = async (item) => {
    setData((d) => ({ ...d, items: d.items.filter((i) => i.id !== item.id) }));
    try { await removeFromGalleryAlbum(album.id, item.id); } catch { load(); }
  };
  const del = async () => {
    if (!confirm(`Apagar o álbum "${album.name}"? As mídias continuam na Galeria.`)) return;
    try { await deleteGalleryAlbum(album.id); onBack(); } catch (err) { setError(err.response?.data?.error || 'Não foi possível apagar.'); }
  };
  const open = (index) => openLightbox(items.map((i) => ({ url: proxyImage(i.url), filename: i.filename || i.title || 'midia', mimeType: mimeOf(i) })), index);

  return (
    <>
      <div className="cxg-album-head">
        <button type="button" className="cx-btn ghost" onClick={onBack}><GIcon name="back" /> Álbuns</button>
        <div className="cxg-album-head-text">
          <h2>{album.name}</h2>
          <p className="dim">{album.description || (album.createdBy ? `Álbum de ${album.createdBy.displayName}` : '')}</p>
        </div>
        {album.canEdit && (
          <div className="cxg-album-head-actions">
            <button type="button" className="cx-btn ghost" onClick={() => setEditing((v) => !v)}><GIcon name="pen" /> Editar</button>
            <button type="button" className="cx-btn ghost cxg-danger" onClick={del}><GIcon name="trash" /> Apagar</button>
          </div>
        )}
      </div>
      {editing && <AlbumForm album={album} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
      {items.length === 0 ? (
        <div className="cx-empty">
          <span className="cx-empty-icon"><GIcon name="album" size={26} /></span>
          <h3>Álbum vazio</h3>
          <p>Na aba Mídias, toque no ícone de álbum de uma foto pra guardar ela aqui.</p>
        </div>
      ) : (
        <div className="cgal-grid">
          {items.map((item, index) => (
            <figure key={item.id} className={`cgal-tile kind-${item.kind}`}>
              <button type="button" className="cgal-media" onClick={() => open(index)} aria-label="Ampliar">
                {item.kind === 'video'
                  ? <video src={proxyImage(item.url)} muted playsInline preload="metadata" />
                  : <img src={proxyImage(item.url)} alt={item.title || ''} loading="lazy" />}
                {item.kind === 'gif' && <span className="cgal-kind">GIF</span>}
              </button>
              <TileActions
                item={item} like={likes[item.id]} onLike={() => toggle(item.id)}
                onAddToAlbum={() => onAddToAlbum(item)} onRemove={album.canEdit ? () => remove(item) : undefined}
              />
              <figcaption className="cgal-caption">
                <span className="cgal-author">
                  <UserAvatar user={item.author} size={20} />
                  <span className="truncate">{item.author?.displayName || 'Alguém'}</span>
                </span>
                <span className="cgal-time">{timeAgo(item.createdAt)}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </>
  );
}

// Escolher em qual álbum (meu) guardar uma mídia — ou criar um na hora.
function AlbumPicker({ item, onClose }) {
  const [albums, setAlbums] = useState(null);
  const [status, setStatus] = useState({}); // albumId -> 'ok' | 'err:msg'
  const [newName, setNewName] = useState('');
  useEffect(() => {
    listGalleryAlbums().then((d) => setAlbums(d.albums || [])).catch(() => setAlbums([]));
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  // Só os álbuns que posso mexer (os meus; staff vê todos).
  const mine = (albums || []).filter((a) => a.canEdit);
  const add = async (albumId) => {
    try { await addToGalleryAlbum(albumId, item.id); setStatus((s) => ({ ...s, [albumId]: 'ok' })); } catch (err) {
      setStatus((s) => ({ ...s, [albumId]: `err:${err.response?.data?.error || 'Não deu certo.'}` }));
    }
  };
  const createAndAdd = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const { album } = await createGalleryAlbum({ name: newName.trim() });
      setAlbums((l) => [album, ...(l || [])]);
      setNewName('');
      add(album.id);
    } catch (err) { setStatus((s) => ({ ...s, new: `err:${err.response?.data?.error || 'Não deu certo.'}` })); }
  };
  return (
    <div className="cxg-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cxg-modal" role="dialog" aria-modal="true" aria-label="Guardar em um álbum">
        <header>
          <h3>Guardar em um álbum</h3>
          <button type="button" className="cxg-tile-btn" onClick={onClose} aria-label="Fechar"><GIcon name="close" /></button>
        </header>
        {albums === null ? <div className="cx-skeleton" style={{ height: 120 }} /> : (
          <ul className="cxg-pick-list">
            {mine.length === 0 && <li className="dim">Você ainda não tem álbuns. Crie um abaixo.</li>}
            {mine.map((a) => {
              const st = status[a.id];
              return (
                <li key={a.id}>
                  <AlbumCover covers={a.covers} />
                  <span className="cxg-pick-name"><strong className="truncate">{a.name}</strong><small>{st?.startsWith('err:') ? st.slice(4) : (a.count === 1 ? '1 mídia' : `${a.count} mídias`)}</small></span>
                  <button type="button" className={`cx-btn ${st === 'ok' ? 'ghost' : 'primary'}`} disabled={st === 'ok'} onClick={() => add(a.id)}>
                    {st === 'ok' ? <><GIcon name="check" /> Guardado</> : 'Guardar'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <form className="cxg-pick-new" onSubmit={createAndAdd}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} placeholder="Novo álbum" aria-label="Nome do novo álbum" />
          <button type="submit" className="cx-btn ghost" disabled={!newName.trim()}><GIcon name="plus" /> Criar e guardar</button>
        </form>
        {status.new?.startsWith('err:') && <div className="auth-error">{status.new.slice(4)}</div>}
      </div>
    </div>
  );
}
