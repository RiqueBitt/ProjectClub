import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useSocket } from '../context/SocketContext.jsx';
import { listUpdates, listEvents, listYoutubeVideos, listFeaturedPosts, getPlatformStats, votePost } from '../api/endpoints';
import { PostCard } from './CommunitiesPage.jsx';
import { renderRichContent } from '../utils/richTextRender.jsx';
import { proxyImage } from '../utils/imageProxy';
import { hour12Option } from '../utils/formatTime';
import inicioIcon from '../assets/icons/logo-project-club.png';

const EVENT_STATUS_LABEL = { UPCOMING: 'Em breve', ACTIVE: 'Ativo', ENDED: 'Encerrado' };
// Item pedido: mostra só os 4 vídeos mais recentes do canal.
const VIDEOS_SHOWN = 4;
const UPDATE_COLLAPSED_LINES = 6;

function formatEventDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: hour12Option() });
}

// Item pedido: "adicione os - ** __ que deixa mais bonito" — o app já
// tem um parser de markdown leve (**negrito**, __sublinhado__, etc —
// ver richTextRender.jsx, reaproveitado aqui) que só NÃO suporta listas
// (linhas com "- item"). Em vez de mexer nesse arquivo compartilhado
// (usado em mensagens de chat e bio de perfil — mudar o comportamento
// dele afetaria essas duas coisas também, fora do escopo daqui), trato
// as linhas de lista aqui mesmo, isolado, e devolvo o resto do texto
// pro renderRichContent normalmente.
function renderUpdateBody(text) {
  const lines = text.split('\n');
  const blocks = [];
  let currentList = null;
  for (const line of lines) {
    const listMatch = line.match(/^-\s+(.*)$/);
    if (listMatch) {
      if (!currentList) { currentList = []; blocks.push({ type: 'list', items: currentList }); }
      currentList.push(listMatch[1]);
    } else {
      currentList = null;
      blocks.push({ type: 'line', text: line });
    }
  }
  return blocks.map((block, i) => {
    if (block.type === 'list') {
      return (
        <ul key={i} className="update-entry-list">
          {block.items.map((item, j) => <li key={j}>{renderRichContent(item)}</li>)}
        </ul>
      );
    }
    return block.text ? <p key={i} className="update-entry-line">{renderRichContent(block.text)}</p> : <br key={i} />;
  });
}

// Item pedido: "se uma descrição tiver mais de 6 linhas, mostra ver
// mais, aí abrindo todas as linhas"
function UpdateEntryBody({ text }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = text.split('\n').length;
  const isLong = lineCount > UPDATE_COLLAPSED_LINES;
  const shown = expanded || !isLong ? text : text.split('\n').slice(0, UPDATE_COLLAPSED_LINES).join('\n');
  return (
    <div className="update-entry-body">
      {renderUpdateBody(shown)}
      {isLong && (
        <button type="button" className="update-entry-see-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Ver menos' : 'Ver mais'}
        </button>
      )}
    </div>
  );
}

// Item pedido: "crie uma nova categoria chamada Início... funcionar
// como a página principal de novidades e destaques da plataforma" —
// consolida, numa tela só: atualizações recentes (reaproveita
// listUpdates, mesma API do antigo UpdatesPage.jsx — sem duplicar
// lógica), banner/ícone atual do app (já vinha pronto no store
// global), eventos da staff, vídeos do canal do YouTube (paginados, 12
// por vez), e posts da comunidade em destaque no mês. Cada seção busca
// e falha independente das outras — se o YouTube estiver fora do ar,
// por exemplo, o resto da página continua funcionando normalmente.
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

  // Tempo real: eventos/atualizações novas ou editadas pela staff
  // aparecem sem precisar recarregar a página.
  useEffect(() => {
    if (!socket) return;
    const onUpdateNew = (entry) => setUpdates((list) => (list ? [entry, ...list] : list));
    const onUpdateEdit = (entry) => setUpdates((list) => (list ? list.map((u) => (u.id === entry.id ? entry : u)) : list));
    const onEventNew = (entry) => setEvents((list) => (list ? [entry, ...list] : list));
    const onEventUpdate = (entry) => setEvents((list) => (list ? list.map((e) => (e.id === entry.id ? entry : e)) : list));
    const onEventDelete = ({ id }) => setEvents((list) => (list ? list.filter((e) => e.id !== id) : list));
    socket.on('update:new', onUpdateNew);
    socket.on('update:edit', onUpdateEdit);
    socket.on('event:new', onEventNew);
    socket.on('event:update', onEventUpdate);
    socket.on('event:delete', onEventDelete);
    return () => {
      socket.off('update:new', onUpdateNew);
      socket.off('update:edit', onUpdateEdit);
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

  // Item pedido (atualizado): "mostra só 4 vídeos mais recentes" —
  // simplificado, sem paginação/"mostrar mais" (não fazia mais
  // sentido pra uma lista fixa de só 4).
  const visibleVideos = useMemo(() => videos?.slice(0, VIDEOS_SHOWN) ?? [], [videos]);

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

      {/* Item pedido: "adicione mais informações de plataforma" */}
      {stats && (
        <div className="inicio-stats-row">
          <div className="inicio-stat-chip"><strong>{stats.memberCount}</strong><span>membros</span></div>
          <div className="inicio-stat-chip"><strong>{stats.postCount}</strong><span>posts</span></div>
          <div className="inicio-stat-chip"><strong>{stats.communityCount}</strong><span>comunidades</span></div>
          <div className="inicio-stat-chip"><strong>{stats.messageCount}</strong><span>mensagens</span></div>
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
          <h2>▶️ Vídeos do MrPinguim</h2>
          <div className="inicio-videos-grid">
            {visibleVideos.map((v) => (
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
                  <span className="update-entry-title">
                    {u.title}
                    {u.version && <span className="update-entry-version">{u.version}</span>}
                  </span>
                  <span className="dim">{new Date(u.createdAt).toLocaleDateString('pt-BR')}</span>
                </div>
                <UpdateEntryBody text={u.description} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
