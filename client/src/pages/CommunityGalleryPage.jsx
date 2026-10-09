import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { listCommunityGallery } from '../api/endpoints';
import { FeaturedGlyph } from '../components/FeaturedChannels.jsx';
import ChannelIcon from '../components/ChannelIcon.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { proxyImage } from '../utils/imageProxy';
import '../styles/channels.css';

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
  { key: 'posts', label: 'Feed' },
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
  const navigate = useNavigate();
  const openLightbox = useStore((s) => s.openLightbox);
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

  const visible = useMemo(() => (items || []).filter((i) => kind === 'all' || i.kind === kind), [items, kind]);
  const counts = useMemo(() => {
    const c = { all: 0, image: 0, gif: 0, video: 0 };
    for (const i of items || []) { c.all += 1; c[i.kind] = (c[i.kind] || 0) + 1; }
    return c;
  }, [items]);

  const open = (index) => {
    openLightbox(visible.map((i) => ({ url: proxyImage(i.url), filename: i.filename || i.title || 'midia', mimeType: mimeOf(i) })), index);
  };

  return (
    <div className="cx-page">
      <div className="cx-inner">
        <header className="cx-hero cx-hero-galeria">
          <span className="cx-hero-icon"><FeaturedGlyph name="image" size={26} /></span>
          <div className="cx-hero-text">
            <span className="cx-eyebrow">Canal em destaque</span>
            <h1>Galeria</h1>
            <p>Fotos, vídeos e GIFs que a galera já compartilhou nos canais e no Feed, tudo num lugar só.</p>
          </div>
        </header>

        <div className="cgal-filters">
          <div className="cx-tabs" role="tablist" aria-label="Tipo de mídia">
            {KINDS.map((k) => (
              <button
                key={k.key} type="button" role="tab" aria-selected={kind === k.key}
                className={`cx-tab${kind === k.key ? ' active' : ''}`} onClick={() => setKind(k.key)}
              >
                {k.label}
                {items && <span className="cx-tab-count">{counts[k.key] || 0}</span>}
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
          </div>
        </div>

        {items === null && (
          <div className="cgal-grid">
            {Array.from({ length: 12 }, (_, i) => <div key={i} className="cx-skeleton cgal-skeleton" />)}
          </div>
        )}
        {items !== null && visible.length === 0 && (
          <div className="cx-empty">
            <span className="cx-empty-icon"><FeaturedGlyph name="image" size={26} /></span>
            <h3>{error ? 'Algo deu errado' : 'Nada por aqui ainda'}</h3>
            <p>{error || 'Quando alguém mandar uma foto, vídeo ou GIF nos canais ou no Feed, aparece aqui.'}</p>
          </div>
        )}
        {items !== null && visible.length > 0 && (
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
                <figcaption className="cgal-caption">
                  <span className="cgal-author">
                    <UserAvatar user={item.author} size={20} />
                    <span className="truncate">{item.author?.displayName || 'Alguém'}</span>
                  </span>
                  {item.source === 'channel' && item.channel ? (
                    <button type="button" className="cgal-where" onClick={() => navigate(`/channels/${item.channel.id}`)} title={`Abrir ${item.channel.name}`}>
                      <ChannelIcon channel={item.channel} className="cgal-where-icon" />
                      <span className="truncate">{item.channel.name}</span>
                    </button>
                  ) : item.source === 'post' ? (
                    <button type="button" className="cgal-where" onClick={() => navigate(`/posts/${item.postId}`)} title={item.title}>
                      <FeaturedGlyph name="feed" size={13} />
                      <span className="truncate">{item.club?.name || 'Feed'}</span>
                    </button>
                  ) : null}
                  <span className="cgal-time">{timeAgo(item.createdAt)}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        {items !== null && nextBefore && (
          <div className="cgal-more">
            <button type="button" className="cx-btn ghost" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Carregando...' : 'Carregar mais'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
