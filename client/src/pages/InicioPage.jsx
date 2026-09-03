import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useSocket } from '../context/SocketContext.jsx';
import { listUpdates, listEvents, listYoutubeVideos, listFeaturedPosts, getPlatformStats, votePost } from '../api/endpoints';
import { PostCard } from './CommunitiesPage.jsx';
import { proxyImage } from '../utils/imageProxy';
import inicioIcon from '../assets/icons/nav-updates.png';

const EVENT_STATUS_LABEL = { UPCOMING: 'Em breve', ACTIVE: 'Ativo', ENDED: 'Encerrado' };

function formatEventDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Item pedido: "crie uma nova categoria chamada Início... funcionar
// como a página principal de novidades e destaques da plataforma" —
// consolida, numa tela só: atualizações recentes (reaproveita
// listUpdates, mesma API do antigo UpdatesPage.jsx — sem duplicar
// lógica), banner/ícone atual do app (já vinha pronto no store
// global), eventos da staff, vídeos do canal do YouTube, e posts da
// comunidade em destaque no mês. Cada seção busca e falha
// independente das outras — se o YouTube estiver fora do ar, por
// exemplo, o resto da página continua funcionando normalmente.
export default function InicioPage() {
  const navigate = useNavigate();
  const { community } = useStore();
  const { socket } = useSocket() || {};

  const [updates, setUpdates] = useState(null);
  const [events, setEvents] = useState(null);
  const [videos, setVideos] = useState(null);
  const [featuredPosts, setFeaturedPosts] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    listUpdates().then((d) => setUpdates(d.updates)).catch(() => setUpdates([]));
    listEvents().then((d) => setEvents(d.events)).catch(() => setEvents([]));
    listYoutubeVideos().then((d) => setVideos(d.videos)).catch(() => setVideos([]));
    listFeaturedPosts().then((d) => setFeaturedPosts(d.posts)).catch(() => setFeaturedPosts([]));
    getPlatformStats().then(setStats).catch(() => setStats(null));
  }, []);

  // Tempo real: eventos/atualizações novas publicadas pela staff
  // aparecem sem precisar recarregar a página.
  useEffect(() => {
    if (!socket) return;
    const onUpdateNew = (entry) => setUpdates((list) => (list ? [entry, ...list] : list));
    const onEventNew = (entry) => setEvents((list) => (list ? [entry, ...list] : list));
    const onEventUpdate = (entry) => setEvents((list) => (list ? list.map((e) => (e.id === entry.id ? entry : e)) : list));
    const onEventDelete = ({ id }) => setEvents((list) => (list ? list.filter((e) => e.id !== id) : list));
    socket.on('update:new', onUpdateNew);
    socket.on('event:new', onEventNew);
    socket.on('event:update', onEventUpdate);
    socket.on('event:delete', onEventDelete);
    return () => {
      socket.off('update:new', onUpdateNew);
      socket.off('event:new', onEventNew);
      socket.off('event:update', onEventUpdate);
      socket.off('event:delete', onEventDelete);
    };
  }, [socket]);

  const onVotePost = async (post, value) => {
    const nextMyVote = post.myVote === value ? 0 : value;
    const delta = nextMyVote - post.myVote;
    setFeaturedPosts((list) => list.map((p) => (p.id === post.id ? { ...p, myVote: nextMyVote, score: p.score + delta } : p)));
    try { await votePost(post.id, value); } catch { listFeaturedPosts().then((d) => setFeaturedPosts(d.posts)).catch(() => {}); }
  };

  return (
    <div className="inicio-page">
      <div className="inicio-hero" style={community.bannerUrl ? { backgroundImage: `url(${proxyImage(community.bannerUrl)})` } : undefined}>
        <div className="inicio-hero-overlay">
          <img className="inicio-hero-icon" src={community.iconUrl ? proxyImage(community.iconUrl) : inicioIcon} alt="" />
          <div>
            <h1>{community.name}</h1>
            <p className="dim">Novidades, eventos e destaques da comunidade.</p>
          </div>
        </div>
      </div>

      {/* Item pedido: "mostra informações sobre a plataforma" */}
      {stats && (
        <div className="inicio-stats-row">
          <div className="inicio-stat-chip"><strong>{stats.memberCount}</strong><span>membros</span></div>
          <div className="inicio-stat-chip"><strong>{stats.postCount}</strong><span>posts</span></div>
          <div className="inicio-stat-chip"><strong>{stats.communityCount}</strong><span>comunidades</span></div>
        </div>
      )}

      {events === null ? null : events.length > 0 && (
        <section className="inicio-section">
          <h2>🎉 Eventos</h2>
          <div className="inicio-events-grid">
            {events.map((ev) => (
              <div key={ev.id} className="inicio-event-card">
                {ev.bannerUrl && <img className="inicio-event-banner" src={proxyImage(ev.bannerUrl)} alt="" />}
                <div className="inicio-event-body">
                  <div className="inicio-event-top">
                    {ev.iconUrl && <img className="inicio-event-icon" src={proxyImage(ev.iconUrl)} alt="" />}
                    <span className="truncate">{ev.title}</span>
                    <span className={`inicio-event-status status-${ev.status.toLowerCase()}`}>{EVENT_STATUS_LABEL[ev.status]}</span>
                  </div>
                  <p className="dim inicio-event-desc">{ev.description}</p>
                  {(ev.startsAt || ev.endsAt) && (
                    <p className="dim inicio-event-dates">
                      {ev.startsAt && formatEventDate(ev.startsAt)}
                      {ev.startsAt && ev.endsAt && ' — '}
                      {ev.endsAt && formatEventDate(ev.endsAt)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {featuredPosts === null ? null : featuredPosts.length > 0 && (
        <section className="inicio-section">
          <h2>🔥 Posts em destaque do mês</h2>
          <div className="inicio-featured-posts">
            {featuredPosts.map((post) => (
              <PostCard key={post.id} post={post} onVote={onVotePost} onOpen={() => navigate(`/posts/${post.id}`)} />
            ))}
          </div>
        </section>
      )}

      {videos === null ? null : videos.length > 0 && (
        <section className="inicio-section">
          <h2>▶️ Vídeos recentes</h2>
          <div className="inicio-videos-grid">
            {videos.map((v) => (
              <a key={v.videoId} className="inicio-video-card" href={v.url} target="_blank" rel="noreferrer">
                <img className="inicio-video-thumb" src={v.thumbnailUrl} alt="" loading="lazy" />
                <span className="inicio-video-title truncate">{v.title}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {updates === null ? null : updates.length > 0 && (
        <section className="inicio-section">
          <h2>📰 Atualizações recentes</h2>
          <div className="updates-list">
            {updates.slice(0, 5).map((u) => (
              <div key={u.id} className="update-entry-card">
                <div className="update-entry-header">
                  <span className="update-entry-title">{u.title}</span>
                  <span className="dim">{new Date(u.createdAt).toLocaleDateString('pt-BR')}</span>
                </div>
                <p className="update-entry-desc">{u.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
