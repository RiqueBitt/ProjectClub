import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useLiveRefresh } from '../../utils/liveRefresh';
import { getGameLibrary } from '../../api/games';
import { GlIcon, GameRow, LockedLibrary, EmptyLibrary, formatHoursShort } from './GameLibraryParts.jsx';
import { libraryPath } from '../../utils/prettyLinks';

// Seção "Jogos" do perfil completo (UserProfileModal): totais, jogando
// agora e os jogos mais recentes; "Ver biblioteca" abre a página inteira.
// Respeita UserSettings.gamesVisibility (o servidor decide).
export default function ProfileGamesSection({ userId }) {
  const navigate = useNavigate();
  const closeProfile = useStore((s) => s.closeProfile);
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    if (!userId) return undefined;
    getGameLibrary(userId).then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setData({ failed: true }); });
    return () => { alive = false; };
  }, [userId]);

  useLiveRefresh(({ put }) => getGameLibrary(userId).then(put(setData)), { enabled: !!data && !data.failed, interval: 45000, key: `profile-games:${userId}` });

  if (!userId || !data || data.failed) return null;
  // Perfil de outra pessoa sem nenhum jogo: não ocupa espaço à toa.
  if (data.visible && !data.isMe && (data.games || []).length === 0) return null;

  const openLibrary = () => {
    closeProfile();
    navigate(data.isMe ? '/jogos/biblioteca' : libraryPath(userId));
  };
  const recent = (data.recent || []).slice(0, 3);

  return (
    <section className="pf-onepage-section pf-onepage-games gl-profile" aria-label="Jogos">
      <h3 className="pf-onepage-title"><GlIcon name="gamepad" size={16} /> Jogos</h3>
      <div className="gl-profile-card">
        {!data.visible ? (
          <LockedLibrary name={data.user?.displayName} visibility={data.visibility} />
        ) : (data.games || []).length === 0 ? (
          <EmptyLibrary isMe={data.isMe} name={data.user?.displayName} />
        ) : (
          <>
            <div className="gl-profile-head">
              <div className="gl-profile-stats">
                <span className="gl-chip"><b>{data.totals?.games ?? 0}</b> {data.totals?.games === 1 ? 'jogo' : 'jogos'}</span>
                <span className="gl-chip"><GlIcon name="clock" size={13} /> <b>{formatHoursShort(data.totals?.seconds)}</b> jogadas</span>
                {data.nowPlaying && <span className="gl-chip is-live"><span className="gl-dot" /> Jogando {data.nowPlaying.name}</span>}
              </div>
              <button type="button" className="gl-link-btn" onClick={openLibrary}>
                Ver biblioteca <GlIcon name="arrow" size={14} />
              </button>
            </div>
            <div className="gl-list is-compact">
              {recent.map((g) => <GameRow key={g.gameKey} game={g} compact />)}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
