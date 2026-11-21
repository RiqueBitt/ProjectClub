import { useEffect, useState } from 'react';
import { PfCard } from '../modals/profileParts.jsx';
import { GameCapsule } from '../games/GameLibraryParts.jsx';
import { getGameLibrary } from '../../api/games';
import { getProfileExtras } from '../../api/endpoints';
import { useStore } from '../../store/useStore';
import { WishItemArt } from './ProfileExtras.jsx';

// Painel lateral da DM: Coleção de jogos e Lista de desejos (igual ao Discord).
export default function DMExtraCards({ userId }) {
  const [games, setGames] = useState(null);
  const [wish, setWish] = useState(null);
  useEffect(() => {
    let alive = true;
    setGames(null); setWish(null);
    getGameLibrary(userId, { limit: 12 }).then((d) => alive && setGames((d.games || []).slice(0, 12))).catch(() => alive && setGames([]));
    getProfileExtras(userId).then((d) => alive && setWish(d.wishlist || null)).catch(() => {});
    return () => { alive = false; };
  }, [userId]);
  const open = () => useStore.getState().openProfile(userId);
  return (
    <>
      {games?.length > 0 && (
        <PfCard icon="grid" title="Coleção de jogos" count={games.length}>
          <div className="dmx-games">
            {games.slice(0, 8).map((g) => (
              <span key={g.gameKey} className="dmx-game" title={g.name}><GameCapsule game={g} size="sm" /></span>
            ))}
          </div>
        </PfCard>
      )}
      {wish?.length > 0 && (
        <PfCard icon="sparkle" title="Lista de desejos" count={wish.length} action={<button type="button" className="pf-link" onClick={open}>Ver tudo</button>}>
          <div className="dmx-wish">
            {wish.slice(0, 3).map((it) => <span key={`${it.kind}:${it.id}`} title={it.name}><WishItemArt item={it} /></span>)}
          </div>
        </PfCard>
      )}
    </>
  );
}
