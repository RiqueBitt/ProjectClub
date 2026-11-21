import { useEffect, useState } from 'react';
import { getGameLibrary } from '../../api/games';
import { listPublicModpacks, listMyModpacks } from '../../api/endpoints';
import { formatPlaytime, formatLastSession } from '../../components/games/GameLibraryParts.jsx';
import '../../styles/contentx.css';

// Resumo do jogo no topo do gerenciador de Mods: junta numa faixa só o
// tempo de jogo (da Biblioteca), os mods instalados no PC e os modpacks
// (os meus + os públicos desse jogo). Cada cartão leva pra aba certa.
const ICONS = {
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  puzzle: 'M10 3.5a2 2 0 1 1 4 0V5h4v4h1.5a2 2 0 1 1 0 4H18v6h-5v-1.5a2 2 0 1 0-4 0V19H4v-6h1.5a2 2 0 1 0 0-4H4V5h6V3.5Z',
  layers: 'm12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5',
};
function Ico({ name }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>;
}

// Biblioteca carregada uma vez por abertura da página de Mods (todos os jogos).
let libraryPromise = null;
let libraryAt = 0;
function loadLibrary() {
  if (!libraryPromise || Date.now() - libraryAt > 60000) {
    libraryAt = Date.now();
    libraryPromise = getGameLibrary('me').catch(() => { libraryPromise = null; return null; });
  }
  return libraryPromise;
}

export default function GameSummary({ game, installedTotal, onOpenTab, onOpenLibrary }) {
  const [play, setPlay] = useState(undefined); // undefined = carregando, null = sem registro
  const [packs, setPacks] = useState(null); // { mine, public }

  useEffect(() => {
    let alive = true;
    loadLibrary().then((d) => {
      if (!alive) return;
      const appId = Number(game.steamAppId);
      const name = String(game.displayName || '').toLowerCase();
      const found = (d?.games || []).find((g) => (appId && Number(g.steamAppId) === appId) || (name && g.name?.toLowerCase() === name));
      setPlay(found || null);
    });
    if (game.steamAppId) {
      Promise.allSettled([listMyModpacks(game.steamAppId), listPublicModpacks({ steamAppId: game.steamAppId, page: 1 })]).then(([mine, pub]) => {
        if (!alive) return;
        setPacks({
          mine: mine.status === 'fulfilled' ? (mine.value.modpacks || []).length : 0,
          public: pub.status === 'fulfilled' ? (pub.value.total ?? (pub.value.modpacks || []).length) : 0,
        });
      });
    } else setPacks({ mine: 0, public: 0 });
    return () => { alive = false; };
  }, [game.steamAppId, game.displayName]);

  return (
    <div className="cxm-summary" aria-label="Resumo do jogo">
      <button type="button" className="cxm-sum-card" onClick={onOpenLibrary} title="Abrir a Biblioteca de jogos">
        <span className="cxm-sum-ico"><Ico name="clock" /></span>
        <span className="cxm-sum-text">
          <small>Tempo de jogo</small>
          {play === undefined ? <span className="cxf-skel cxm-sum-skel" /> : play ? (
            <>
              <strong>{formatPlaytime(play.totalSeconds)}</strong>
              <em>{play.playingNow ? 'Jogando agora' : `Última vez: ${formatLastSession(play.lastPlayedAt, false)}`}</em>
            </>
          ) : (
            <>
              <strong>Sem registro</strong>
              <em>Conta pelo app de desktop</em>
            </>
          )}
        </span>
      </button>
      <button type="button" className="cxm-sum-card" onClick={() => onOpenTab('installed')}>
        <span className="cxm-sum-ico"><Ico name="puzzle" /></span>
        <span className="cxm-sum-text">
          <small>Mods instalados</small>
          <strong>{installedTotal == null ? '—' : installedTotal}</strong>
          <em>{installedTotal == null ? 'Precisa do app no PC' : installedTotal === 1 ? 'mod neste PC' : 'mods neste PC'}</em>
        </span>
      </button>
      <button type="button" className="cxm-sum-card" onClick={() => onOpenTab('modpacks')}>
        <span className="cxm-sum-ico"><Ico name="layers" /></span>
        <span className="cxm-sum-text">
          <small>Modpacks</small>
          {packs === null ? <span className="cxf-skel cxm-sum-skel" /> : (
            <>
              <strong>{packs.public}</strong>
              <em>{packs.mine > 0 ? `públicos · ${packs.mine} seu(s)` : 'públicos pra esse jogo'}</em>
            </>
          )}
        </span>
      </button>
    </div>
  );
}
