import { useEffect, useState } from 'react';
import SystemUnavailable from '../components/SystemUnavailable.jsx';
import { getMyEconomy, claimDaily, listChests } from '../api/endpoints';
import { useSocket } from '../context/SocketContext.jsx';

function fmt(n) { return Math.floor(Number(n) || 0).toLocaleString('pt-BR'); }

export default function EconomyPage() {
  const { socket } = useSocket();
  const [eco, setEco] = useState(null);
  const [chests, setChests] = useState([]);
  const [wonChest, setWonChest] = useState(null); // { name, imageOpened } — última recompensa, pra mostrar o PNG do baú
  const [notice, setNotice] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const refresh = () => getMyEconomy().then(setEco).catch((err) => {
    if (err?.response?.status === 503) setUnavailable(true);
  });
  const refreshChests = () => listChests().then((d) => setChests(d.chests)).catch(() => {});
  useEffect(() => {
    refresh();
    refreshChests();
  }, []);

  // Staff edita um baú (imagem, chances, moedas...) e a galeria daqui
  // atualiza sozinha, sem precisar recarregar a página.
  useEffect(() => {
    if (!socket) return undefined;
    socket.on('chests:update', refreshChests);
    return () => socket.off('chests:update', refreshChests);
  }, [socket]);

  const pushNotice = (msg) => { setNotice(msg); setTimeout(() => setNotice(null), 4000); };

  if (unavailable) return <SystemUnavailable icon="💰" />;
  if (!eco) return <div className="economy-page"><p className="dim">Carregando...</p></div>;

  const canClaim = !eco.lastDailyAt || (Date.now() - new Date(eco.lastDailyAt).getTime()) >= 24 * 60 * 60 * 1000;

  const claim = async () => {
    setClaiming(true);
    try {
      const r = await claimDaily();
      setWonChest({
        name: r.chestName, imageOpened: r.chestImageOpened,
        coins: r.coins, tickets: r.tickets, megaAwarded: r.megaAwarded, megaGems: r.megaGems,
      });
      refresh();
    } catch (err) {
      pushNotice(err.response?.data?.error || 'Não foi possível resgatar.');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="economy-page">
      <div className="economy-header">
        <h1>💰 Economia</h1>
        <div className="economy-balance-row">
          <span className="economy-balance-chip">🪙 {fmt(eco.coins)} moedas</span>
          <span className="economy-balance-chip">💎 {fmt(eco.gems)} gemas</span>
        </div>
      </div>

      {notice && <div className="economy-notice">{notice}</div>}

      <div className="settings-grid">
        <div className="settings-block">
          <h4>🎁 Recompensa diária</h4>
          <p className="dim">Resgate uma vez por dia. Mantenha a sequência por 5 dias seguidos para ganhar um Mega Baú de gemas.</p>
          <p>Sequência atual: <b>{eco.dailyStreak}/5</b> dias</p>

          <button className="btn-primary" disabled={!canClaim || claiming} onClick={claim}>
            {claiming ? 'Abrindo...' : canClaim ? 'Resgatar baú diário' : 'Já resgatado hoje'}
          </button>

          {chests.some((c) => c.imageClosed) && (
            <div className="daily-chest-gallery">
              <div className="dim" style={{ fontSize: 12, width: '100%', marginBottom: 4 }}>Baús possíveis:</div>
              {chests.filter((c) => c.imageClosed).map((c) => (
                <div key={c.id} className="daily-chest-gallery-item" title={c.name}>
                  <img src={c.imageClosed} alt={c.name} />
                  <span>{c.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {wonChest?.imageOpened && (
        <div className="chest-reveal-overlay" onClick={() => setWonChest(null)}>
          <div className="chest-reveal-card" onClick={(e) => e.stopPropagation()}>
            <img className="chest-reveal-img" src={wonChest.imageOpened} alt={wonChest.name} />
            <h3>Baú {wonChest.name}!</h3>
            <div className="chest-reveal-rewards">
              <span>+{fmt(wonChest.coins)} moedas</span>
              {wonChest.tickets > 0 && <span>+{wonChest.tickets} tickets</span>}
              {wonChest.megaAwarded && <span>🎁 Sequência completa: +{wonChest.megaGems} gemas!</span>}
            </div>
            <button className="btn-primary" onClick={() => setWonChest(null)}>Show!</button>
          </div>
        </div>
      )}
    </div>
  );
}
