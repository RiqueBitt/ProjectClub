import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useVoice } from '../context/VoiceContext.jsx';
import UserAvatar from './UserAvatar.jsx';
import ActivityStatusLine from './ActivityStatusLine.jsx';
import { Ico } from './PagesKit.jsx';
import '../styles/active-now.css';
import { channelPath } from '../utils/prettyLinks';

// "Ativo agora" (igual à coluna da página de Amigos do Discord): amigos
// jogando, ouvindo ou numa call — com botão pra entrar na call junto.
export default function ActiveNowPanel() {
  const friends = useStore((s) => s.friends);
  const activities = useStore((s) => s.activities);
  const presence = useStore((s) => s.presence);
  const channels = useStore((s) => s.channels);
  const categories = useStore((s) => s.categories);
  const voice = useVoice();
  const navigate = useNavigate();
  const roster = voice?.roster || {};

  const list = useMemo(() => {
    const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
    const chById = Object.fromEntries(allChannels.map((c) => [c.id, c]));
    const inVoice = {};
    Object.entries(roster).forEach(([cid, parts]) => {
      if (!chById[cid]) return; // só salas da comunidade (DM não aparece pros outros)
      (parts || []).forEach((p) => { inVoice[p.userId] = { channel: chById[cid], count: parts.length }; });
    });
    return friends.filter((f) => f.status === 'ACCEPTED' && f.user).map((f) => {
      const st = presence[f.user.id]?.status || f.user.status;
      return { user: f.user, activity: activities[f.user.id], voice: inVoice[f.user.id], online: st && st !== 'OFFLINE' && st !== 'INVISIBLE' };
    }).filter((x) => x.online && (x.activity || x.voice))
      .sort((a, b) => (b.voice ? 1 : 0) - (a.voice ? 1 : 0));
  }, [friends, activities, presence, roster, channels, categories]);

  return (
    <aside className="anp" aria-label="Ativo agora">
      <h3>Ativo agora</h3>
      {list.length === 0 ? (
        <div className="anp-empty">
          <strong>Está tranquilo por aqui…</strong>
          <span>Quando um amigo começar a jogar, ouvir música ou entrar numa call, ele aparece aqui.</span>
        </div>
      ) : list.map(({ user, activity, voice: v }) => (
        <div key={user.id} className="anp-card">
          <button type="button" className="anp-head" onClick={(e) => useStore.getState().openMiniProfile?.(user.id, e.currentTarget.getBoundingClientRect())}>
            <UserAvatar user={user} size={34} />
            <span className="anp-names">
              <strong>{user.displayName}</strong>
              {activity && <ActivityStatusLine userId={user.id} />}
            </span>
          </button>
          {v && (
            <div className="anp-voice">
              <Ico name="volume" size={15} />
              <span><b>{v.channel.name}</b><small>{v.count} {v.count === 1 ? 'pessoa' : 'pessoas'} na call</small></span>
              <button type="button" onClick={() => { voice?.joinChannel(null, v.channel.id, v.channel.name, v.channel.type || 'VOICE'); navigate(channelPath(v.channel)); }}>Entrar</button>
            </div>
          )}
        </div>
      ))}
    </aside>
  );
}
