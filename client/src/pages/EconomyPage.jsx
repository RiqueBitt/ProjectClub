import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMyEconomy, claimDaily, listChests } from '../api/endpoints';
import { useSocket } from '../context/SocketContext.jsx';
import { Ico, PageHero, Skeleton, Toast, Unavailable } from '../components/PagesKit.jsx';
import '../styles/economy.css';
import { useLiveRefresh } from '../utils/liveRefresh';

function fmt(n) { return Math.floor(Number(n) || 0).toLocaleString('pt-BR'); }

const DAY_MS = 24 * 60 * 60 * 1000;
const STREAK_GOAL = 5;

// "Volta em 5h 12min" — só texto, calculado da última coleta.
function timeLeft(lastDailyAt) {
  const ms = new Date(lastDailyAt).getTime() + DAY_MS - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

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

  // Tempo real (11s): saldo/sequência e baús, em silêncio.
  useLiveRefresh(async ({ put }) => {
    await Promise.allSettled([
      getMyEconomy().then(put(setEco)),
      listChests().then((d) => put(setChests)(d.chests)),
    ]);
  }, { enabled: !unavailable });

  const pushNotice = (msg) => { setNotice(msg); setTimeout(() => setNotice(null), 4000); };

  if (unavailable) return <Unavailable icon="coin" />;
  if (!eco) {
    return (
      <div className="pk-page eco"><div className="pk-inner">
        <Skeleton rows={1} height={128} />
        <div className="eco-layout"><Skeleton rows={1} height={300} /><Skeleton rows={1} height={300} /></div>
      </div></div>
    );
  }

  const canClaim = !eco.lastDailyAt || (Date.now() - new Date(eco.lastDailyAt).getTime()) >= DAY_MS;
  const streak = Math.min(Number(eco.dailyStreak) || 0, STREAK_GOAL);
  const gallery = chests.filter((c) => c.imageClosed);

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
    <div className="pk-page eco">
      <div className="pk-inner">
        <PageHero
          icon="coin" eyebrow="Sua carteira" title="Economia"
          desc="Ganhe moedas todo dia e gaste em casas, móveis e figurinhas. Gemas vêm das sequências completas."
          aside={(
            <div className="eco-balances">
              <div className="eco-balance coins">
                <span className="eco-balance-icon"><Ico name="coin" size={22} /></span>
                <div><small>Moedas</small><strong>{fmt(eco.coins)}</strong></div>
              </div>
              <div className="eco-balance gems">
                <span className="eco-balance-icon"><Ico name="gem" size={22} /></span>
                <div><small>Gemas</small><strong>{fmt(eco.gems)}</strong></div>
              </div>
            </div>
          )}
        />

        <div className="eco-layout">
          <section className="pk-card eco-daily">
            <div className="eco-daily-head">
              <span className="eco-daily-badge"><Ico name="gift" size={24} /></span>
              <div>
                <h2>Recompensa diária</h2>
                <p className="pk-muted">Resgate uma vez por dia. Mantenha a sequência por 5 dias seguidos para ganhar um Mega Baú de gemas.</p>
              </div>
            </div>

            <div className="eco-streak" aria-label={`Sequência atual: ${eco.dailyStreak} de ${STREAK_GOAL} dias`}>
              <div className="eco-streak-top">
                <span><Ico name="flame" size={16} /> Sequência atual</span>
                <strong>{eco.dailyStreak}/{STREAK_GOAL} dias</strong>
              </div>
              <ol className="eco-streak-days">
                {Array.from({ length: STREAK_GOAL }).map((_, i) => {
                  const done = i < streak;
                  const isMega = i === STREAK_GOAL - 1;
                  return (
                    <li key={i} className={`${done ? 'done' : ''} ${isMega ? 'mega' : ''} ${i === streak && canClaim ? 'next' : ''}`}>
                      <span className="eco-streak-node">
                        {done ? <Ico name="check" size={16} strokeWidth={2.4} /> : isMega ? <Ico name="gem" size={16} /> : i + 1}
                      </span>
                      <small>{isMega ? 'Mega Baú' : `Dia ${i + 1}`}</small>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="eco-claim">
              <button className="pk-btn primary lg eco-claim-btn" disabled={!canClaim || claiming} onClick={claim}>
                <Ico name={canClaim ? 'chest' : 'check'} size={19} />
                {claiming ? 'Abrindo...' : canClaim ? 'Resgatar baú diário' : 'Já resgatado hoje'}
              </button>
              {!canClaim && eco.lastDailyAt && timeLeft(eco.lastDailyAt) && (
                <span className="eco-claim-wait"><Ico name="clock" size={15} /> Próximo baú em {timeLeft(eco.lastDailyAt)}</span>
              )}
            </div>
          </section>

          <section className="pk-card eco-chests">
            <h2 className="pk-section-title"><Ico name="chest" /> Baús possíveis <small>{gallery.length > 0 ? `· ${gallery.length}` : ''}</small></h2>
            {gallery.length > 0 ? (
              <div className="daily-chest-gallery eco-chest-grid">
                {gallery.map((c) => (
                  <div key={c.id} className="daily-chest-gallery-item eco-chest" title={c.name}>
                    <img src={c.imageClosed} alt={c.name} />
                    <span>{c.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="pk-muted">Cada resgate abre um baú aleatório com moedas e, às vezes, tickets.</p>
            )}
          </section>
        </div>

        <section>
          <h2 className="pk-section-title"><Ico name="sparkles" /> Onde usar suas moedas</h2>
          <div className="eco-links">
            <Link to="/casas" className="eco-link">
              <span className="eco-link-icon"><Ico name="house" size={20} /></span>
              <div><strong>Casas</strong><small>Compre uma casa e decore com móveis.</small></div>
              <Ico name="right" size={18} />
            </Link>
            <Link to="/figurinhas" className="eco-link">
              <span className="eco-link-icon"><Ico name="sticker" size={20} /></span>
              <div><strong>Figurinhas</strong><small>Abra cápsulas e complete o álbum.</small></div>
              <Ico name="right" size={18} />
            </Link>
          </div>
        </section>
      </div>

      <Toast>{notice}</Toast>

      {wonChest?.imageOpened && (
        <div className="chest-reveal-overlay eco-reveal-backdrop" onClick={() => setWonChest(null)}>
          <div className="chest-reveal-card eco-reveal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Recompensa do baú">
            <div className="eco-reveal-glow" aria-hidden="true" />
            <img className="chest-reveal-img" src={wonChest.imageOpened} alt={wonChest.name} />
            <span className="pk-eyebrow">Você abriu</span>
            <h3>Baú {wonChest.name}!</h3>
            <div className="chest-reveal-rewards eco-reveal-rewards">
              <span className="pk-chip tint" style={{ '--tint': 'var(--yellow)' }}><Ico name="coin" size={14} /> +{fmt(wonChest.coins)} moedas</span>
              {wonChest.tickets > 0 && <span className="pk-chip brand"><Ico name="star" size={14} /> +{wonChest.tickets} tickets</span>}
              {wonChest.megaAwarded && <span className="pk-chip tint eco-mega"><Ico name="gem" size={14} /> Sequência completa: +{wonChest.megaGems} gemas!</span>}
            </div>
            <button className="pk-btn primary lg" onClick={() => setWonChest(null)}>Show!</button>
          </div>
        </div>
      )}
    </div>
  );
}
