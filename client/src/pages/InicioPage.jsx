import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useSocket } from '../context/SocketContext.jsx';
import { listUpdates, listEvents, listYoutubeVideos, listFeaturedPosts, getPlatformStats, votePost, getUserProfile } from '../api/endpoints';
import { useAuth } from '../context/AuthContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { PostCard } from './CommunitiesPage.jsx';
import { renderRichContent } from '../utils/richTextRender.jsx';
import { proxyImage } from '../utils/imageProxy';
import { hour12Option } from '../utils/formatTime';
import inicioIcon from '../assets/icons/logo-project-club.png';
import { useLiveRefresh, sameData } from '../utils/liveRefresh';
import { bootSection, onBootSection, bootstrapActive } from '../utils/bootstrap';
import ArenaPromo from '../cards/ArenaPromo.jsx';
import MinecraftStatusCard from '../components/MinecraftStatusCard.jsx';
import { isFeatureEnabled } from '../utils/features';
import { channelPath, postPath, eventPath } from '../utils/prettyLinks';
import { api } from '../api/client';
import { setEventRsvp } from '../api/social';
import { useCommunityHome, HomeCommunityMain, HomeCommunitySide } from '../components/community/HomeCommunity.jsx';

const EVENT_STATUS_LABEL = { UPCOMING: 'Em breve', ACTIVE: 'Ativo', ENDED: 'Encerrado' };
// Item pedido: mostra só os 4 vídeos mais recentes do canal.
const VIDEOS_SHOWN = 6;
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
// Saudação pela hora local.
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Boa madrugada';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

// "há 2 h", "há 3 dias"…
function timeAgo(iso) {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}
// Texto puro (sem marcação) pra prévia de um anúncio.
const plainSnippet = (text, max = 140) => {
  const t = String(text || '').replace(/[*_~`>#|[\]()]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const fmtNum = (n) => (typeof n === 'number' ? n.toLocaleString('pt-BR') : '—');

// Ícones SVG (traço) das seções e atalhos — sem emoji.
const HOME_ICONS = {
  chat: 'M4 5h16v11H8l-4 4V5Z',
  voice: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3',
  feed: 'M5 4h14v16H5zM9 8h6M9 12h6M9 16h3',
  social: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 19v-1a4 4 0 0 0-3-3.87M15.5 4.13a3 3 0 0 1 0 5.74',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  fire: 'M12 3s5 4.5 5 9.5A5 5 0 0 1 7 12.5C7 10 9 8.5 9 8.5s0 2.5 2 3.5c0-4 1-9 1-9Z',
  play: 'M7 5v14l11-7L7 5Z',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2V5Zm13 4h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5',
  arrow: 'M9 6l6 6-6 6',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12',
  check: 'M20 6 9 17l-5-5',
};
function HomeIcon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={HOME_ICONS[name]} />
    </svg>
  );
}

function Section({ icon, title, action, children, className = '' }) {
  return (
    <section className={`home-section ${className}`}>
      <header className="home-section-head">
        <h2><HomeIcon name={icon} size={17} /> {title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }) {
  return <p className="home-empty">{children}</p>;
}

export default function InicioPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const community = useStore((s) => s.community);
  const members = useStore((s) => s.members);
  const presence = useStore((s) => s.presence);
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const voice = useVoice();
  const { socket } = useSocket() || {};

  const [updates, setUpdates] = useState(null);
  const [events, setEvents] = useState(null);
  const [videos, setVideos] = useState(null);
  const [featuredPosts, setFeaturedPosts] = useState(null);
  const [stats, setStats] = useState(null);
  const [me, setMe] = useState(null);
  // Anúncios da staff (aba Anúncios da Central): o mais recente aparece em "Acontecendo agora".
  const [announcements, setAnnouncements] = useState(null);
  // Fase 4: temporada, metas coletivas, post da semana, aniversários, Clubes.
  const communityHome = useCommunityHome();

  useEffect(() => {
    listUpdates().then((d) => setUpdates(d.updates)).catch(() => setUpdates([]));
    // Eventos: reaproveita o pacote de abertura se ele acabou de chegar (utils/bootstrap.js).
    (bootSection('events') || listEvents()).then((d) => setEvents(d.events)).catch(() => setEvents([]));
    listYoutubeVideos().then((d) => setVideos(d.videos)).catch(() => setVideos([]));
    listFeaturedPosts().then((d) => setFeaturedPosts(d.posts)).catch(() => setFeaturedPosts([]));
    getPlatformStats().then(setStats).catch(() => setStats(null));
    api.get('/anuncios').then((r) => setAnnouncements(r.data?.announcements || [])).catch(() => setAnnouncements([]));
    // Perfil completo traz o progresso do nível (levelProgress).
    if (user?.id) getUserProfile(user.id).then((d) => setMe(d)).catch(() => setMe(null));
  }, [user?.id]);

  // Tempo real (22s): posts em destaque e progresso do nível;
  // novidades/eventos/vídeos já chegam por socket, então só uma
  // ressincronização leve (33s).
  useLiveRefresh(async (ctx) => {
    const { put } = ctx;
    await Promise.allSettled([
      listFeaturedPosts().then((d) => put(setFeaturedPosts)(d.posts)),
      user?.id ? getUserProfile(user.id).then(put(setMe)) : null,
    ]);
  }, { interval: 22000 });
  // Números da plataforma (4 contagens no banco, incluindo TODAS as
  // mensagens): mudam devagar e ninguém precisa deles ao segundo — 2 min.
  useLiveRefresh(({ put }) => getPlatformStats().then(put(setStats)), { interval: 120000 });
  useLiveRefresh(async (ctx) => {
    const { put } = ctx;
    await Promise.allSettled([
      listUpdates().then((d) => put(setUpdates)(d.updates)),
      // Eventos chegam pela atualização global (pacote de abertura) quando ela está ativa.
      bootstrapActive() ? null : listEvents().then((d) => put(setEvents)(d.events)),
      listYoutubeVideos().then((d) => put(setVideos)(d.videos)),
    ]);
  }, { interval: 33000, realtimeInterval: 120000 });

  useEffect(() => onBootSection('events', (d) => { if (d?.events) setEvents((prev) => (sameData(prev, d.events) ? prev : d.events)); }), []);

  useEffect(() => {
    if (!socket) return;
    const onUpdateNew = (entry) => setUpdates((list) => (list ? [entry, ...list] : list));
    const onUpdateEdit = (entry) => setUpdates((list) => (list ? list.map((u) => (u.id === entry.id ? entry : u)) : list));
    const onEventNew = (entry) => setEvents((list) => (list ? [entry, ...list] : list));
    const onEventUpdate = (entry) => setEvents((list) => (list ? list.map((e) => (e.id === entry.id ? entry : e)) : list));
    const onEventDelete = ({ id }) => setEvents((list) => (list ? list.filter((e) => e.id !== id) : list));
    const onAnnouncements = () => api.get('/anuncios').then((r) => setAnnouncements(r.data?.announcements || [])).catch(() => {});
    socket.on('announcements:update', onAnnouncements);
    socket.on('update:new', onUpdateNew);
    socket.on('update:edit', onUpdateEdit);
    socket.on('event:new', onEventNew);
    socket.on('event:update', onEventUpdate);
    socket.on('event:delete', onEventDelete);
    return () => {
      socket.off('announcements:update', onAnnouncements);
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

  const visibleVideos = useMemo(() => videos?.slice(0, VIDEOS_SHOWN) ?? [], [videos]);

  const allChannels = useMemo(() => [...channels, ...categories.flatMap((c) => c.channels || [])], [channels, categories]);
  const firstText = allChannels.find((c) => c.name?.toLowerCase().includes('geral') && !['VOICE', 'STAGE'].includes(c.type))
    || allChannels.find((c) => !['VOICE', 'STAGE'].includes(c.type));

  // Quem está online (sem contar quem está invisível/offline).
  const online = useMemo(() => members
    .map((m) => ({ ...m.user, live: presence[m.user.id]?.status || m.user.status }))
    .filter((u) => u.live && u.live !== 'OFFLINE' && u.live !== 'INVISIBLE'), [members, presence]);

  // Salas de voz com gente dentro agora.
  const liveCalls = useMemo(() => allChannels
    .filter((c) => ['VOICE', 'STAGE'].includes(c.type))
    .map((c) => ({ channel: c, people: (voice?.roster?.[c.id] || []).map((p) => members.find((m) => m.user.id === p.userId)?.user).filter(Boolean) }))
    .filter((c) => c.people.length > 0), [allChannels, voice?.roster, members]);

  const level = me?.user?.accountLevel ?? user?.accountLevel ?? 1;
  const progress = me?.levelProgress ?? 0;
  const upcomingEvents = (events || []).filter((e) => e.status !== 'ENDED')
    .sort((a, b) => new Date(a.startsAt || 0) - new Date(b.startsAt || 0));
  // "Acontecendo agora": o evento ao vivo (ou o próximo) e o último anúncio.
  const liveEvent = upcomingEvents.find((e) => e.status === 'ACTIVE');
  const spotlightEvent = liveEvent || upcomingEvents[0] || null;
  const latestAnnouncement = (announcements || [])[0] || null;
  const peopleInCalls = liveCalls.reduce((n, c) => n + c.people.length, 0);

  // "Eu vou" direto da lista (clicar de novo desfaz).
  const toggleGoing = async (ev) => {
    const rsvp = ev.rsvp || { counts: { GOING: 0, MAYBE: 0, NO: 0 }, mine: null };
    const next = rsvp.mine === 'GOING' ? null : 'GOING';
    const counts = { ...rsvp.counts };
    if (rsvp.mine) counts[rsvp.mine] = Math.max(0, (counts[rsvp.mine] || 0) - 1);
    if (next) counts[next] = (counts[next] || 0) + 1;
    const patch = (r) => setEvents((list) => (list ? list.map((e) => (e.id === ev.id ? { ...e, rsvp: r } : e)) : list));
    patch({ ...rsvp, counts, mine: next });
    try {
      const r = await setEventRsvp(ev.id, next);
      if (r?.rsvp) patch({ ...r.rsvp, mine: r.mine !== undefined ? r.mine : next });
    } catch { patch(rsvp); }
  };

  const disabledSystems = useStore((st) => st.disabledSystems) || [];
  const shortcuts = [
    firstText && { icon: 'chat', label: 'Conversar', hint: `#${firstText.name}`, to: channelPath(firstText) },
    { icon: 'feed', label: 'Fórum', hint: 'Posts e temas', to: '/comunidades' },
    { icon: 'social', label: 'Amigos', hint: 'Amigos e mensagens', to: '/dms' },
    { icon: 'star', label: 'Progresso', hint: 'Ranks e conquistas', to: '/progresso' },
  ].filter(Boolean);

  return (
    <div className="home">
      <header
        className={`home-hero${community.bannerUrl ? ' has-banner' : ''}`}
        style={community.bannerUrl ? { '--home-banner': `url(${JSON.stringify(proxyImage(community.bannerUrl))})` } : undefined}
      >
        <div className="home-hero-inner">
          <img className="home-hero-icon" src={community.iconUrl ? proxyImage(community.iconUrl) : inicioIcon} alt="" />
          <div className="home-hero-text">
            <p className="home-hero-hello">{greeting()}, {user?.displayName || 'membro'}</p>
            <h1>{community.name || 'Project Club'}</h1>
          </div>
          {stats && (
            <dl className="home-hero-stats">
              <div><dt>membros</dt><dd>{fmtNum(stats.memberCount)}</dd></div>
              <div><dt>online</dt><dd>{fmtNum(online.length)}</dd></div>
              <div><dt>em call</dt><dd>{fmtNum(peopleInCalls)}</dd></div>
            </dl>
          )}
        </div>
      </header>

      {(spotlightEvent || latestAnnouncement) && (
        <section className="home-now" aria-label="Acontecendo agora">
          <p className="home-label">{liveEvent ? 'Acontecendo agora' : 'Fique por dentro'}</p>
          <div className="home-now-grid">
            {spotlightEvent && (
              <button type="button" className={`home-now-card home-now-event${liveEvent ? ' is-live' : ''}`} onClick={() => navigate(eventPath(spotlightEvent))}>
                <span className="home-now-top">
                  {liveEvent ? <span className="home-now-live">Ao vivo</span> : <span className="home-now-soon">Próximo evento</span>}
                  <strong className="truncate">{spotlightEvent.title}</strong>
                </span>
                <span className="home-now-sub">
                  {spotlightEvent.startsAt && !liveEvent ? `${formatEventDate(spotlightEvent.startsAt)} · ` : ''}
                  {(spotlightEvent.rsvp?.counts?.GOING || 0)} confirmado{(spotlightEvent.rsvp?.counts?.GOING || 0) === 1 ? '' : 's'}
                </span>
                <span className="home-now-cta">{liveEvent ? 'Entrar' : 'Ver evento'}</span>
              </button>
            )}
            {latestAnnouncement && (
              <button type="button" className="home-now-card home-now-ann" onClick={() => navigate('/anuncios')}>
                <span className="home-now-top">
                  <HomeIcon name="megaphone" size={16} />
                  <strong className="truncate">{latestAnnouncement.title || 'Último anúncio'}</strong>
                  <time dateTime={latestAnnouncement.createdAt}>{timeAgo(latestAnnouncement.createdAt)}</time>
                </span>
                <span className="home-now-sub home-now-snippet">{plainSnippet(latestAnnouncement.body)}</span>
              </button>
            )}
          </div>
        </section>
      )}

      <nav className="home-shortcuts is-compact" aria-label="Atalhos">
        {shortcuts.map((s) => (
          <button key={s.to} type="button" className="home-shortcut" onClick={() => navigate(s.to)}>
            <span className="home-shortcut-icon"><HomeIcon name={s.icon} size={20} /></span>
            <span className="home-shortcut-text">
              <strong>{s.label}</strong>
              <span className="truncate">{s.hint}</span>
            </span>
            <HomeIcon name="arrow" size={16} />
          </button>
        ))}
      </nav>

      {isFeatureEnabled('cardsWar') && (!disabledSystems.includes('cartas') || user?.platformRole === 'ADMIN') && <ArenaPromo />}

      {isFeatureEnabled('minecraftHome') && <MinecraftStatusCard />}

      <div className="home-grid">
        <div className="home-main">
          <HomeCommunityMain home={communityHome} />
          <Section
            icon="calendar" title="Próximos eventos"
            action={<button type="button" className="home-link" onClick={() => navigate('/comunidade/eventos')}>Ver todos</button>}
          >
            {events === null && <Empty>Carregando…</Empty>}
            {events !== null && upcomingEvents.length === 0 && <Empty>Nenhum evento agendado. Fique de olho: quando a equipe criar um, ele aparece aqui.</Empty>}
            {upcomingEvents.length > 0 && (
              <ul className="home-evlist">
                {upcomingEvents.slice(0, 5).map((ev) => {
                  const d = ev.startsAt ? new Date(ev.startsAt) : null;
                  const going = ev.rsvp?.counts?.GOING || 0;
                  const mine = ev.rsvp?.mine === 'GOING';
                  return (
                    <li key={ev.id} className="home-ev">
                      <span className={`home-ev-date${ev.status === 'ACTIVE' ? ' is-live' : ''}`} aria-hidden="true">
                        {ev.status === 'ACTIVE' ? <b>Ao vivo</b> : d ? <><b>{String(d.getDate()).padStart(2, '0')}</b>{d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</> : <b>—</b>}
                      </span>
                      <button type="button" className="home-ev-main" onClick={() => navigate(eventPath(ev))}>
                        <strong className="truncate">{ev.title}</strong>
                        <span className="truncate">
                          {d ? d.toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: hour12Option() }) : EVENT_STATUS_LABEL[ev.status]}
                          {` · ${going} vão`}
                        </span>
                      </button>
                      <button type="button" className={`home-ev-go${mine ? ' on' : ''}`} aria-pressed={mine} onClick={() => toggleGoing(ev)}>
                        {mine && <HomeIcon name="check" size={13} />} Vou
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            icon="fire" title="Em alta no Fórum"
            action={<button type="button" className="home-link" onClick={() => navigate('/comunidades')}>Ver Fórum</button>}
          >
            {featuredPosts === null && <Empty>Carregando…</Empty>}
            {featuredPosts?.length === 0 && <Empty>Ainda não tem posts em destaque este mês. Que tal publicar o primeiro?</Empty>}
            {featuredPosts?.length > 0 && (
              <div className="home-posts">
                {featuredPosts.map((post) => (
                  <PostCard key={post.id} post={post} onVote={onVotePost} onOpen={() => navigate(postPath(post))} />
                ))}
              </div>
            )}
          </Section>

          {videos?.length > 0 && (
            <Section icon="play" title="Vídeos do MrPinguim">
              <div className="home-videos">
                {visibleVideos.map((v) => (
                  <a key={v.videoId} className="home-video" href={v.url} target="_blank" rel="noreferrer">
                    <span className="home-video-thumb">
                      <img src={v.thumbnailUrl} alt="" loading="lazy" />
                      <span className="home-video-play"><HomeIcon name="play" size={18} /></span>
                    </span>
                    <span className="home-video-title">{v.title}</span>
                  </a>
                ))}
              </div>
            </Section>
          )}
        </div>

        <aside className="home-side">
          <HomeCommunitySide home={communityHome} />
          <Section icon="voice" title="Em chamada agora" className="home-card">
            {liveCalls.length === 0 && <Empty>Ninguém em chamada. Entre numa sala e chame o pessoal.</Empty>}
            {liveCalls.map(({ channel, people }) => (
              <button key={channel.id} type="button" className="home-call" onClick={() => navigate(channelPath(channel))}>
                <span className="home-call-name"><span className="home-live-dot" /> <span className="truncate">{channel.name}</span></span>
                <span className="home-avatars">
                  {people.slice(0, 5).map((p) => <UserAvatar key={p.id} user={p} size={26} />)}
                  {people.length > 5 && <span className="home-avatars-more">+{people.length - 5}</span>}
                </span>
              </button>
            ))}
          </Section>

          <Section icon="social" title={`Online agora · ${online.length}`} className="home-card">
            {online.length === 0 && <Empty>Ninguém online no momento.</Empty>}
            <div className="home-online">
              {online.slice(0, 18).map((u) => (
                <button
                  key={u.id} type="button" className="home-online-person" title={u.displayName}
                  onClick={(e) => useStore.getState().openMiniProfile(u.id, e.currentTarget.getBoundingClientRect(), 'left')}
                >
                  <UserAvatar user={u} size={38} />
                  <span className="truncate">{u.displayName}</span>
                </button>
              ))}
            </div>
            {online.length > 18 && <p className="home-muted">e mais {online.length - 18}</p>}
          </Section>

          <Section icon="star" title="Seu progresso" className="home-card" action={<button type="button" className="home-link" onClick={() => navigate('/progresso')}>Abrir</button>}>
            <div className="home-level">
              <span className="home-level-badge">Nível {level}</span>
              <span className="home-muted">{progress}% para o próximo</span>
            </div>
            <div className="home-level-bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${progress}%` }} />
            </div>
          </Section>

          <Section icon="news" title="Atualizações" className="home-card">
            {updates === null && <Empty>Carregando…</Empty>}
            {updates?.length === 0 && <Empty>Nenhuma atualização publicada ainda.</Empty>}
            <div className="home-updates">
              {(updates || []).slice(0, 4).map((u) => (
                <article key={u.id} className="home-update">
                  <header>
                    <h3>{u.title}</h3>
                    {u.version && <span className="home-pill">{u.version}</span>}
                    <time dateTime={u.createdAt}>{new Date(u.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</time>
                  </header>
                  <UpdateEntryBody text={u.description} />
                </article>
              ))}
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}
