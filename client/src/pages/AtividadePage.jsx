import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useSocket } from '../context/SocketContext.jsx';
import { getActivityFeed, toggleActivityCheer } from '../api/social';
import { useLiveRefresh, sameData } from '../utils/liveRefresh';
import { activityArtUrl, ACTIVITY_VERB } from '../utils/activityArt';
import { RARITY_COLOR, RARITY_LABEL } from '../utils/achievementRarity';
import { requestOpenModpack } from './mods/modpackShared.js';
import { proxyImage } from '../utils/imageProxy';
import UserAvatar from '../components/UserAvatar.jsx';
import '../styles/socialx.css';

// Página "Atividade": linha do tempo dos amigos (jogando agora, posts no
// Feed, modpacks, conquistas e níveis). Atualiza sozinha (live refresh +
// sockets) e deixa dar "Parabéns" nos momentos dos amigos.

const FILTERS = [
  { key: 'all', label: 'Tudo', icon: 'spark' },
  { key: 'post', label: 'Posts', icon: 'post' },
  { key: 'modpack', label: 'Modpacks', icon: 'box' },
  { key: 'achievement', label: 'Conquistas', icon: 'trophy' },
  { key: 'level', label: 'Níveis', icon: 'star' },
];

const PATHS = {
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  post: 'M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h6',
  box: 'M12 3 3 7.5 12 12l9-4.5L12 3ZM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  star: 'm12 3 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8L12 3Z',
  game: 'M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.2 2l1.3-1.5h7l1.3 1.5A3 3 0 0 0 22 15l-.7-6.4a4 4 0 0 0-4-3.6Z',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  app: 'M3 5h18v12H3zM8 21h8M12 17v4',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  party: 'M4 20 9 7l8 8-13 5ZM14 4l.5 2M19 9l2-.5M17 3l-1.5 3M20 6l-3 1.5',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3',
  comment: 'M4 5h16v11H8l-4 4V5Z',
  up: 'M12 5 5 13h4.5v6h5v-6H19L12 5Z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
};
function Ico({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

function timeAgo(date) {
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  return new Date(date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function elapsed(startedAt) {
  if (!startedAt) return null;
  const mins = Math.max(0, Math.floor((Date.now() - startedAt) / 60000));
  if (mins < 1) return 'agora mesmo';
  if (mins < 60) return `há ${mins} min`;
  return `há ${Math.floor(mins / 60)}h ${mins % 60}min`;
}
function dayLabel(date) {
  const d = new Date(date);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === y.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

export default function AtividadePage() {
  const navigate = useNavigate();
  const { socket } = useSocket() || {};
  const friends = useStore((s) => s.friends);
  const activities = useStore((s) => s.activities);
  const [data, setData] = useState(null); // { items, now, nextBefore, friendCount }
  const [extra, setExtra] = useState([]); // páginas a mais ("Carregar mais")
  const [nextBefore, setNextBefore] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(false);
  const [, tick] = useState(0);

  const load = () => getActivityFeed()
    .then((d) => { setData((prev) => (sameData(prev, d) ? prev : d)); setError(false); if (!extra.length) setNextBefore(d.nextBefore); })
    .catch(() => { setError(true); setData((prev) => prev || { items: [], now: [], nextBefore: null, friendCount: 0 }); });

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tempo real: refaz a primeira página em silêncio a cada ~22s.
  useLiveRefresh(({ put }) => getActivityFeed().then(put(setData)), { enabled: data !== null, interval: 22000 });

  // Amigo comemorou / postou: atualiza na hora.
  useEffect(() => {
    if (!socket) return undefined;
    const refresh = () => load();
    socket.on('activity:celebrate', refresh);
    socket.on('post:new', refresh);
    return () => { socket.off('activity:celebrate', refresh); socket.off('post:new', refresh); };
  }, [socket]); // eslint-disable-line react-hooks/exhaustive-deps

  // "há X min" andando sozinho.
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);

  // Jogando agora: o que o servidor mandou + o que chega ao vivo por socket.
  // Com o socket conectado, o store é a fonte certa (chega na hora);
  // sem ele, usa a lista que veio do servidor.
  const socketLive = !!socket?.connected;
  const playing = useMemo(() => {
    const map = new Map();
    for (const n of data?.now || []) map.set(n.user.id, { user: n.user, activity: n.activity });
    if (socketLive) {
      for (const f of friends || []) {
        if (f.status !== 'ACCEPTED' || !f.user) continue;
        const live = activities[f.user.id];
        if (live) map.set(f.user.id, { user: map.get(f.user.id)?.user || f.user, activity: live });
        else map.delete(f.user.id);
      }
    }
    return [...map.values()].filter((p) => p.activity?.name);
  }, [data, friends, activities, socketLive]);

  const allItems = useMemo(() => {
    const seen = new Set();
    return [...(data?.items || []), ...extra].filter((i) => (seen.has(i.key) ? false : seen.add(i.key)));
  }, [data, extra]);
  const items = filter === 'all' ? allItems : allItems.filter((i) => i.type === filter);

  const groups = useMemo(() => {
    const out = [];
    for (const it of items) {
      const label = dayLabel(it.at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(it); else out.push({ label, items: [it] });
    }
    return out;
  }, [items]);

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await getActivityFeed({ before: nextBefore });
      setExtra((prev) => [...prev, ...d.items]);
      setNextBefore(d.nextBefore);
    } catch { /* tenta de novo no próximo clique */ }
    setLoadingMore(false);
  };

  const cheer = async (item) => {
    const optimistic = (it) => (it.key === item.key
      ? { ...it, cheers: { ...it.cheers, mine: !it.cheers.mine, count: it.cheers.count + (it.cheers.mine ? -1 : 1) } }
      : it);
    setData((d) => (d ? { ...d, items: d.items.map(optimistic) } : d));
    setExtra((list) => list.map(optimistic));
    try {
      const r = await toggleActivityCheer(item.key);
      const fix = (it) => (it.key === item.key ? { ...it, cheers: { ...it.cheers, mine: r.mine, count: r.count } } : it);
      setData((d) => (d ? { ...d, items: d.items.map(fix) } : d));
      setExtra((list) => list.map(fix));
    } catch { load(); }
  };

  const noFriends = data && data.friendCount === 0;

  return (
    <div className="sx-page">
      <div className="sx-inner">
        <header className="sx-hero">
          <span className="sx-head-icon"><Ico name="spark" size={26} /></span>
          <div className="sx-head-text">
            <h1>Atividade</h1>
            <p>O que seus amigos andam fazendo: jogos, posts, modpacks, conquistas e níveis.</p>
          </div>
          {data && !noFriends && (
            <div className="sx-head-stats">
              <span className="sx-stat"><b>{playing.length}</b> jogando agora</span>
              <span className="sx-stat"><b>{data.friendCount}</b> amigo{data.friendCount === 1 ? '' : 's'}</span>
            </div>
          )}
        </header>

        {playing.length > 0 && (
          <section className="sx-now" aria-label="Jogando agora">
            <h2 className="sx-section-title"><span className="sx-live-dot" aria-hidden="true" /> Agora</h2>
            <div className="sx-now-row">
              {playing.map(({ user, activity }) => {
                const art = activityArtUrl(activity);
                const wide = art?.startsWith('/api/proxy/steam/');
                return (
                  <button key={user.id} type="button" className="sx-now-card" onClick={() => useStore.getState().openProfile(user.id)}>
                    <span className={`sx-now-art${wide ? ' is-wide' : ''}`}>
                      {art ? <img src={art.startsWith('/') || art.startsWith('data:') ? art : proxyImage(art)} alt="" loading="lazy" />
                        : <span className="sx-now-art-empty"><Ico name={activity.type === 'spotify' ? 'music' : activity.type === 'app' ? 'app' : 'game'} size={26} /></span>}
                    </span>
                    <span className="sx-now-info">
                      <UserAvatar user={user} size={28} />
                      <span className="sx-now-text">
                        <span className="sx-now-name">{user.displayName}</span>
                        <span className="sx-now-what">{ACTIVITY_VERB[activity.type] || 'Jogando'} <b>{activity.name}</b></span>
                        {elapsed(activity.startedAt) && <span className="sx-now-time">{activity.type === 'spotify' && activity.detail ? activity.detail : elapsed(activity.startedAt)}</span>}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {!noFriends && (
          <div className="sx-tabs" role="tablist" aria-label="Filtrar atividade">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={`sx-tab${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
                <Ico name={f.icon} size={15} /> <span>{f.label}</span>
              </button>
            ))}
          </div>
        )}

        {data === null && (
          <div className="sx-timeline">
            {[0, 1, 2, 3].map((i) => <div key={i} className="sx-skel sx-skel-item" />)}
          </div>
        )}

        {noFriends && (
          <div className="sx-empty">
            <span className="sx-empty-icon"><Ico name="users" size={26} /></span>
            <h3>Sua linha do tempo está vazia</h3>
            <p>Adicione amigos para ver o que eles estão jogando, postando e conquistando.</p>
            <button type="button" className="sx-btn primary" onClick={() => navigate('/dms')}>Encontrar amigos</button>
          </div>
        )}

        {data && !noFriends && items.length === 0 && (
          <div className="sx-empty">
            <span className="sx-empty-icon"><Ico name={FILTERS.find((f) => f.key === filter)?.icon || 'spark'} size={26} /></span>
            <h3>{error ? 'Não deu pra carregar agora' : 'Nada por aqui ainda'}</h3>
            <p>{error ? 'Tentamos de novo sozinhos em instantes.' : 'Quando seus amigos postarem, publicarem modpacks ou subirem de nível, aparece aqui.'}</p>
          </div>
        )}

        {groups.map((g) => (
          <section key={g.label} className="sx-day">
            <h2 className="sx-day-title">{g.label}</h2>
            <div className="sx-timeline">
              {g.items.map((it) => <ActivityItem key={it.key} item={it} onCheer={() => cheer(it)} navigate={navigate} />)}
            </div>
          </section>
        ))}

        {nextBefore && items.length > 0 && (
          <div className="sx-more">
            <button type="button" className="sx-btn ghost" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Carregando...' : 'Carregar mais'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

const VERB = {
  post: (it) => <>publicou em <b>{it.post.community?.name || 'Fórum'}</b></>,
  modpack: (it) => <>{it.updated ? 'atualizou o modpack' : 'publicou um modpack'} de <b>{it.modpack.gameName}</b></>,
  achievement: () => <>desbloqueou uma conquista</>,
  level: () => <>subiu de nível</>,
};
const TYPE_ICON = { post: 'post', modpack: 'box', achievement: 'trophy', level: 'star' };

function ActivityItem({ item, onCheer, navigate }) {
  const accent = item.type === 'achievement' ? RARITY_COLOR[item.achievement.rarity] || RARITY_COLOR.COMMON : item.type === 'level' ? '#ffb02e' : null;
  const openUser = () => useStore.getState().openProfile(item.user.id);
  return (
    <article className={`sx-item sx-item-${item.type}${item.celebrated ? ' is-celebrated' : ''}`} style={accent ? { '--sx-accent': accent } : undefined}>
      <span className="sx-item-rail" aria-hidden="true"><Ico name={TYPE_ICON[item.type]} size={14} /></span>
      <div className="sx-item-main">
        <header className="sx-item-head">
          <button type="button" className="sx-item-user" onClick={openUser}>
            <UserAvatar user={item.user} size={32} />
          </button>
          <span className="sx-item-line">
            <button type="button" className="sx-item-name" onClick={openUser}>{item.user.displayName}</button>{' '}
            <span className="sx-item-verb">{VERB[item.type](item)}</span>
          </span>
          <time className="sx-item-time" dateTime={item.at}>{timeAgo(item.at)}</time>
        </header>

        {item.type === 'post' && (
          <button type="button" className="sx-item-body sx-post" onClick={() => navigate(`/posts/${item.post.id}`)}>
            {item.post.type === 'IMAGE' && item.post.imageUrl && <img className="sx-post-img" src={proxyImage(item.post.imageUrl)} alt="" loading="lazy" />}
            <span className="sx-post-text">
              <span className="sx-post-title">{item.post.title}</span>
              {item.post.excerpt && <span className="sx-post-excerpt">{item.post.excerpt}</span>}
              <span className="sx-meta">
                <span><Ico name="up" size={13} /> {item.post.score}</span>
                <span><Ico name="comment" size={13} /> {item.post.commentCount}</span>
              </span>
            </span>
          </button>
        )}

        {item.type === 'modpack' && (
          <div className="sx-item-body sx-mp">
            <img className="sx-mp-cover" src={item.modpack.coverUrl ? proxyImage(item.modpack.coverUrl) : `/api/proxy/steam/${item.modpack.steamAppId}/header`} alt="" loading="lazy" />
            <span className="sx-mp-text">
              <span className="sx-post-title">{item.modpack.name}</span>
              <span className="sx-meta">
                <span><Ico name="download" size={13} /> {item.modpack.downloadCount}</span>
                <span><Ico name="heart" size={13} /> {item.modpack.likeCount}</span>
              </span>
            </span>
            <button type="button" className="sx-btn primary sm" onClick={() => { requestOpenModpack(item.modpack.steamAppId, item.modpack.id); navigate('/jogos/mods'); }}>
              Ver modpack
            </button>
          </div>
        )}

        {item.type === 'achievement' && (
          <div className="sx-item-body sx-ach">
            <span className="sx-ach-icon">
              {item.achievement.iconUrl ? <img src={proxyImage(item.achievement.iconUrl)} alt="" /> : <Ico name="trophy" size={24} />}
            </span>
            <span className="sx-ach-text">
              <span className="sx-post-title">{item.achievement.name}</span>
              <span className="sx-post-excerpt">{item.achievement.description}</span>
            </span>
            <span className="sx-rarity">{RARITY_LABEL[item.achievement.rarity] || 'Comum'}</span>
          </div>
        )}

        {item.type === 'level' && (
          <div className="sx-item-body sx-level">
            <span className="sx-level-num"><Ico name="star" size={18} /> {item.level.level}</span>
            <span className="sx-ach-text">
              <span className="sx-post-title">Nível {item.level.level}</span>
              <span className="sx-post-excerpt">Mais um degrau na comunidade!</span>
            </span>
          </div>
        )}

        <footer className="sx-item-foot">
          <button type="button" className={`sx-cheer${item.cheers.mine ? ' is-on' : ''}`} aria-pressed={item.cheers.mine} onClick={onCheer}>
            <Ico name={item.cheers.mine ? 'party' : 'heart'} size={15} />
            {item.cheers.mine ? 'Você deu parabéns' : 'Parabéns'}
            {item.cheers.count > 0 && <span className="sx-cheer-count">{item.cheers.count}</span>}
          </button>
          {item.cheers.users?.length > 0 && (
            <span className="sx-faces" aria-hidden="true">
              {item.cheers.users.map((u) => <UserAvatar key={u.id} user={u} size={20} />)}
            </span>
          )}
          {item.celebrated && <span className="sx-celebrated"><Ico name="party" size={13} /> Comemorando</span>}
        </footer>
      </div>
    </article>
  );
}
