import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useSocket } from '../context/SocketContext.jsx';
import { listUpdates, listEvents, listYoutubeVideos, getPlatformStats, getUserProfile } from '../api/endpoints';
import { useAuth } from '../context/AuthContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import AnunciosPage from './AnunciosPage.jsx';
import EventsCalendar from '../components/EventsCalendar.jsx';
import { useMarkSectionSeen } from '../utils/sectionBadges';
import { renderRichContent } from '../utils/richTextRender.jsx';
import { proxyImage } from '../utils/imageProxy';
import inicioIcon from '../assets/icons/logo-project-club.png';
import { useLiveRefresh, sameData } from '../utils/liveRefresh';
import { bootSection, onBootSection, bootstrapActive } from '../utils/bootstrap';
import ArenaPromo from '../cards/ArenaPromo.jsx';
import MinecraftStatusCard from '../components/MinecraftStatusCard.jsx';
import { isFeatureEnabled } from '../utils/features';
import { channelPath, eventPath } from '../utils/prettyLinks';
import { useCommunityHome, HomeCommunityMain, HomeCommunitySide } from '../components/community/HomeCommunity.jsx';

// Item pedido: mostra só os 4 vídeos mais recentes do canal.
const VIDEOS_SHOWN = 6;
const UPDATE_COLLAPSED_LINES = 6;


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
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.6l1.3 2.65 2.9.42-2.1 2.05.5 2.9L12 14.25l-2.6 1.37.5-2.9-2.1-2.05 2.9-.42z',
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
  const [stats, setStats] = useState(null);
  const [me, setMe] = useState(null);
  // A Central mostra as Novidades (anúncios) e o calendário de eventos: abrir
  // a página apaga a bolinha "novo" das duas.
  useMarkSectionSeen('eventos');
  // Fase 4: temporada, metas coletivas, post da semana, aniversários, Clubes.
  const communityHome = useCommunityHome();

  useEffect(() => {
    listUpdates().then((d) => setUpdates(d.updates)).catch(() => setUpdates([]));
    // Eventos: reaproveita o pacote de abertura se ele acabou de chegar (utils/bootstrap.js).
    (bootSection('events') || listEvents()).then((d) => setEvents(d.events)).catch(() => setEvents([]));
    listYoutubeVideos().then((d) => setVideos(d.videos)).catch(() => setVideos([]));
    getPlatformStats().then(setStats).catch(() => setStats(null));
    // Perfil completo traz o progresso do nível (levelProgress).
    if (user?.id) getUserProfile(user.id).then((d) => setMe(d)).catch(() => setMe(null));
  }, [user?.id]);

  // Tempo real (22s): posts em destaque e progresso do nível;
  // novidades/eventos/vídeos já chegam por socket, então só uma
  // ressincronização leve (33s).
  useLiveRefresh(async (ctx) => {
    const { put } = ctx;
    await Promise.allSettled([
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


  const visibleVideos = useMemo(() => videos?.slice(0, VIDEOS_SHOWN) ?? [], [videos]);

  const allChannels = useMemo(() => [...channels, ...categories.flatMap((c) => c.channels || [])], [channels, categories]);

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
  // "Acontecendo agora": só quando tem evento ao vivo.
  const liveEvent = upcomingEvents.find((e) => e.status === 'ACTIVE');
  const peopleInCalls = liveCalls.reduce((n, c) => n + c.people.length, 0);

  const disabledSystems = useStore((st) => st.disabledSystems) || [];

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



      {isFeatureEnabled('cardsWar') && (!disabledSystems.includes('cartas') || user?.platformRole === 'ADMIN') && <ArenaPromo />}

      {isFeatureEnabled('minecraftHome') && <MinecraftStatusCard />}

      <div className="home-grid">
        <div className="home-main">
          {/* Evento ao vivo: só aparece enquanto um evento está acontecendo, em cima das Novidades. */}
          {liveEvent && (
            <section className="home-now" aria-label="Acontecendo agora">
              <p className="home-label">Acontecendo agora</p>
              <button type="button" className="home-now-card home-now-event is-live" onClick={() => navigate(eventPath(liveEvent))}>
                <span className="home-now-top">
                  <span className="home-now-live">Ao vivo</span>
                  <strong className="truncate">{liveEvent.title}</strong>
                </span>
                <span className="home-now-sub">
                  {(liveEvent.rsvp?.counts?.GOING || 0)} confirmado{(liveEvent.rsvp?.counts?.GOING || 0) === 1 ? '' : 's'}
                </span>
                <span className="home-now-cta">Entrar</span>
              </button>
            </section>
          )}
          {/* Novidades da staff com banner e texto, direto aqui (antes era uma aba). */}
          <section className="home-section home-news">
            <AnunciosPage embedded />
          </section>
          <HomeCommunityMain home={communityHome} />

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
          <Section
            icon="calendar" title="Calendário de eventos" className="home-card"
            action={<button type="button" className="home-link" onClick={() => navigate('/comunidade/eventos')}>Ver todos</button>}
          >
            <EventsCalendar events={events} />
          </Section>
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
