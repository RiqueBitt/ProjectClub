import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useVoice } from '../context/VoiceContext.jsx';
import { useCommunityEvents } from '../utils/useCommunityEvents';
import { activityArtUrl, ACTIVITY_VERB } from '../utils/activityArt';
import { channelPath } from '../utils/prettyLinks';
import { eventPath } from '../utils/prettyPaths';
import UserAvatar from './UserAvatar.jsx';

// "Agora" (visual novo, nov/2026): o topo do painel da direita mostra o que
// está acontecendo na comunidade neste momento — calls com gente dentro,
// quem está jogando o quê e os eventos de hoje/amanhã. A lista de membros
// continua logo abaixo (MembersList.jsx). Some quando não há nada.

const MAX_FACES = 4;
const HOUR = 3600e3;

const names = (list) => {
  const n = list.map((u) => u.displayName || u.username).filter(Boolean);
  if (n.length <= 2) return n.join(' e ');
  return `${n[0]}, ${n[1]} e mais ${n.length - 2}`;
};

function eventWhen(ev, now) {
  if (ev.status === 'ACTIVE') return { text: 'Ao vivo', live: true };
  const d = new Date(ev.startsAt);
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86400e3);
  if (diff === 0) return { text: hm };
  if (diff === 1) return { text: `amanhã ${hm}` };
  return { text: d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') };
}

function Faces({ users }) {
  return (
    <span className="agora-faces" aria-hidden="true">
      {users.slice(0, MAX_FACES).map((u) => <UserAvatar key={u.id} user={u} size={24} />)}
      {users.length > MAX_FACES && <span className="agora-more">+{users.length - MAX_FACES}</span>}
    </span>
  );
}

export default function AgoraPanel() {
  const navigate = useNavigate();
  const voice = useVoice();
  const members = useStore((s) => s.members);
  const presence = useStore((s) => s.presence);
  const activities = useStore((s) => s.activities);
  const channels = useStore((s) => s.channels);
  const categories = useStore((s) => s.categories);
  const { events } = useCommunityEvents();
  const roster = voice?.roster || {};
  const myCall = voice?.call?.channelId || null;

  const { calls, playing, upcoming } = useMemo(() => {
    const userById = Object.fromEntries(members.map((m) => [m.user.id, m.user]));
    const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
    const chById = Object.fromEntries(allChannels.map((c) => [c.id, c]));

    const callList = Object.entries(roster)
      .filter(([cid, parts]) => chById[cid] && (parts || []).length > 0)
      .map(([cid, parts]) => ({
        channel: chById[cid],
        users: parts.map((p) => userById[p.userId] || { id: p.userId, displayName: p.displayName || 'Alguém', avatarUrl: p.avatarUrl }),
        sharing: parts.some((p) => p.screenSharing || p.screen),
      }))
      .sort((a, b) => b.users.length - a.users.length);

    const online = (uid) => {
      const st = presence[uid]?.status || userById[uid]?.status;
      return st && st !== 'OFFLINE' && st !== 'INVISIBLE';
    };
    const groups = new Map();
    Object.entries(activities || {}).forEach(([uid, act]) => {
      if (!act?.name || !userById[uid] || !online(uid)) return;
      const key = `${act.type || 'game'}:${act.name.toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, { activity: act, users: [] });
      groups.get(key).users.push(userById[uid]);
    });
    const playList = [...groups.values()].sort((a, b) => b.users.length - a.users.length).slice(0, 4);

    const now = Date.now();
    const evList = (events || [])
      .filter((e) => e.status === 'ACTIVE' || (e.status !== 'ENDED' && e.startsAt && new Date(e.startsAt).getTime() > now - HOUR && new Date(e.startsAt).getTime() < now + 48 * HOUR))
      .sort((a, b) => (a.status === 'ACTIVE' ? -1 : 0) - (b.status === 'ACTIVE' ? -1 : 0) || new Date(a.startsAt || 0) - new Date(b.startsAt || 0))
      .slice(0, 3);
    return { calls: callList, playing: playList, upcoming: evList };
  }, [members, presence, activities, channels, categories, roster, events]);

  const join = (ch) => {
    voice?.joinChannel(null, ch.id, ch.name, ch.type || 'VOICE');
    navigate(channelPath(ch));
  };

  const empty = calls.length === 0 && playing.length === 0 && upcoming.length === 0;
  const now = Date.now();

  return (
    <section className="agora" aria-label="Agora na comunidade">
      <div className="agora-head">
        <span className="agora-title">Agora</span>
        {!empty && <i className="agora-live" aria-hidden="true" />}
      </div>
      {empty && <p className="agora-empty">Ninguém em call nem jogando agora. Quando a galera chegar, aparece aqui.</p>}

      {calls.length > 0 && (
        <div className="agora-block">
          <div className="agora-label">Em call</div>
          {calls.map(({ channel, users, sharing }) => {
            const here = myCall === channel.id;
            return (
              <div key={channel.id} className="agora-call">
                <button type="button" className="agora-call-name" onClick={() => navigate(channelPath(channel))}>
                  <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span className="truncate">{channel.name}</span>
                  {sharing && <span className="agora-tag">Tela</span>}
                </button>
                <div className="agora-call-row">
                  <Faces users={users} />
                  <span className="agora-sub truncate">{names(users)}</span>
                  {here
                    ? <span className="agora-here">Você está aqui</span>
                    : <button type="button" className="agora-join" onClick={() => join(channel)}>Entrar</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {playing.length > 0 && (
        <div className="agora-block">
          <div className="agora-label">Jogando</div>
          {playing.map(({ activity, users }) => {
            const art = activityArtUrl(activity);
            return (
              <div key={`${activity.type}:${activity.name}`} className="agora-game" title={`${ACTIVITY_VERB[activity.type] || 'Jogando'} ${activity.name}`}>
                {art ? <img className="agora-game-art" src={art} alt="" /> : (
                  <span className="agora-game-art is-glyph" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24"><path d="M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.2 2l1.3-1.5h7l1.3 1.5A3 3 0 0 0 22 15l-.7-6.4a4 4 0 0 0-4-3.6Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                )}
                <span className="agora-game-text">
                  <b className="truncate">{activity.name}</b>
                  <span className="agora-sub truncate">{names(users)}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="agora-block">
          <div className="agora-label">Hoje e amanhã</div>
          {upcoming.map((ev) => {
            const when = eventWhen(ev, now);
            return (
              <button key={ev.id} type="button" className="agora-event" onClick={() => navigate(eventPath(ev))}>
                <span className={`agora-when${when.live ? ' is-live' : ''}`}>{when.text}</span>
                <span className="agora-event-title truncate">{ev.title}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
