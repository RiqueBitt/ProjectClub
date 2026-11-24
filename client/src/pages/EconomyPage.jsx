import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getMyEconomy, claimDaily, listChests, getMissionSeason, claimSeasonReward } from '../api/endpoints';
import { useAuth } from '../context/AuthContext.jsx';
import WalletCard from '../components/WalletCard.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { EmptyState, Ico, PillTabs, Skeleton, Toast, Unavailable } from '../components/PagesKit.jsx';
import '../styles/hub-tabs.css';
import '../styles/economy.css';
import { useLiveRefresh } from '../utils/liveRefresh';
import '../styles/contentx.css';
import { TrimmedImg } from '../utils/trimImage.jsx';

function fmt(n) { return Math.floor(Number(n) || 0).toLocaleString('pt-BR'); }

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STREAK_GOAL = 5;

// "5h 12min" / "2d 4h" — contagem regressiva até um instante.
function untilText(target, now = Date.now()) {
  const ms = new Date(target).getTime() - now;
  if (!(ms > 0)) return null;
  const d = Math.floor(ms / DAY_MS);
  const h = Math.floor((ms % DAY_MS) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  return h > 0 ? `${h}h ${m}min` : `${Math.max(1, m)}min`;
}

// Saldo em linha (abas que não mostram o cartão).
function Purse({ coins, gems }) {
  return (
    <div className="eco-purse" aria-label={`Seu saldo: ${fmt(coins)} moedas e ${fmt(gems)} gemas`}>
      <span><Ico name="coin" size={18} /><b>{fmt(coins)}</b></span>
      <span><Ico name="gem" size={18} /><b>{fmt(gems)}</b></span>
    </div>
  );
}

// Hub da Economia: cartão da carteira (moedas e gemas), baú diário, missões e atalhos.
// Histórico e Sorteio saíram (nov/2026, pedido do dono).
export default function EconomyPage({ initialTab = 'geral' }) {
  const { socket } = useSocket();
  const { user } = useAuth();
  // ?aba=temporada|geral — usado pela barra de abas da
  // Loja (HubTabs) pra voltar direto pra aba certa da Economia.
  // (Missões foram pro Progresso: ?aba=missoes leva pra lá.)
  const [searchParams] = useSearchParams();
  const abaParam = searchParams.get('aba');
  const validAba = ['geral', 'temporada'].includes(abaParam) ? abaParam : null;
  const [tab, setTab] = useState(() => validAba || initialTab);
  const [eco, setEco] = useState(null);
  const [chests, setChests] = useState([]);
  const [wonChest, setWonChest] = useState(null); // última recompensa, pra mostrar o PNG do baú
  const [notice, setNotice] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { setTab(validAba || initialTab); }, [initialTab, validAba]);

  const refresh = useCallback(() => getMyEconomy().then(setEco).catch((err) => {
    if (err?.response?.status === 503) setUnavailable(true);
  }), []);
  const refreshChests = useCallback(() => listChests().then((d) => setChests(d.chests)).catch(() => {}), []);

  useEffect(() => {
    refresh();
    refreshChests();
  }, [refresh, refreshChests]);
  // Temporada do mês (passe de missões).
  const navigate = useNavigate();
  useEffect(() => { if (abaParam === 'missoes') navigate('/progresso?tab=missoes', { replace: true }); }, [abaParam, navigate]);
  const [season, setSeason] = useState(null);
  const [seasonBusy, setSeasonBusy] = useState('');
  const refreshSeason = useCallback(() => getMissionSeason().then((d) => setSeason(Array.isArray(d?.tiers) ? d : null)).catch(() => {}), []);
  useEffect(() => { refreshSeason(); }, [refreshSeason]);
  // Link direto pro passe sem ser Assinante: manda pra Assinatura.
  useEffect(() => { if (tab === 'temporada' && season && !season.isSupporter) navigate('/assinatura', { replace: true }); }, [tab, season, navigate]);
  const seasonReady = season ? season.tiers.filter((t) => t.unlocked && (!t.claimedFree || (season.isSupporter && !t.claimedPlus))).length : 0;
  const claimSeason = async (level, track) => {
    setSeasonBusy(`${level}:${track}`);
    try {
      const r = await claimSeasonReward(level, track);
      setSeason((s) => s && { ...s, tiers: s.tiers.map((t) => (t.level === level ? { ...t, [track === 'free' ? 'claimedFree' : 'claimedPlus']: true } : t)) });
      if (r.balance) setEco((e) => e && { ...e, coins: r.balance.coins, gems: r.balance.gems });
      const parts = [];
      if (r.reward?.coins) parts.push(`+${fmt(r.reward.coins)} moedas`);
      if (r.reward?.gems) parts.push(`+${fmt(r.reward.gems)} gemas`);
      pushNotice(`Nível ${level} da temporada: ${parts.join(', ')}`);
    } catch (err) { pushNotice(err.response?.data?.error || 'Não deu pra resgatar.'); refreshSeason(); }
    setSeasonBusy('');
  };

  // Passe: ao abrir, a trilha já rola até o primeiro prêmio que dá pra resgatar
  // (ou até o nível atual), em vez de começar sempre no nível 1.
  const trackRef = useRef(null);
  const seasonKey = season ? `${season.key}:${season.isSupporter}` : '';
  useEffect(() => {
    const track = trackRef.current;
    if (tab !== 'temporada' || !track) return;
    const target = track.querySelector('[data-focus="1"]');
    if (target) track.scrollLeft = Math.max(0, target.offsetLeft - track.offsetLeft - 96);
  }, [tab, seasonKey]);

  // Relógio das contagens regressivas (baú e reset das missões).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // Staff edita os baús e a tela atualiza sozinha.
  useEffect(() => {
    if (!socket) return undefined;
    socket.on('chests:update', refreshChests);
    return () => { socket.off('chests:update', refreshChests); };
  }, [socket, refreshChests]);

  // Tempo real: saldo, baús e missões, em silêncio.
  useLiveRefresh(async ({ put }) => {
    await Promise.allSettled([
      getMyEconomy().then(put(setEco)),
      listChests().then((d) => put(setChests)(d.chests)),
    ]);
  }, { enabled: !unavailable });

  const pushNotice = (msg) => { setNotice(msg); setTimeout(() => setNotice(null), 4000); };

  const tabs = [
    { id: 'geral', label: 'Visão geral', icon: 'grid' },
    // Economia + Loja unificadas: a Loja é uma aba desta área, logo à
    // esquerda do Passe (abre a página da Loja com a mesma barra de abas
    // no topo — ver components/HubTabs.jsx). Compras continuam validadas
    // só no servidor (shopController), nada mudou nas regras.
    { id: 'loja', label: 'Loja', icon: 'store' },
    // Fase 8: Loja dos criadores (página própria, mesma barra de abas).
    { id: 'criadores', label: 'Criadores', icon: 'sparkles' },
    // Passe do clube: exclusivo de Assinantes (botão dourado). Quem não assina
    // vai direto pra Loja → Assinatura.
    { id: 'temporada', label: 'Passe do clube', icon: 'crown', count: season?.isSupporter ? (seasonReady || undefined) : undefined, className: 'pk-tab-gold' },
  ];

  const tabBar = (
    <div className="hub-tabs-bar">
      <PillTabs
        tabs={tabs} value={tab} label="Seções da Economia" className="small hub-tabs"
        onChange={(id) => {
          if (id === 'loja') navigate('/loja');
          else if (id === 'criadores') navigate('/loja/criadores');
          else if (id === 'temporada' && season && !season.isSupporter) navigate('/assinatura');
          else setTab(id);
        }}
      />
    </div>
  );

  if (unavailable) return <Unavailable icon="coin" />;
  if (!eco) {
    return (
      <div className="hub-frame eco-frame">
        {tabBar}
        <div className="pk-page eco"><div className="pk-inner">
          <div className="eco-top"><Skeleton rows={1} height={300} /><Skeleton rows={1} height={300} /></div>
          <Skeleton rows={1} height={220} />
        </div></div>
      </div>
    );
  }

  const goal = Number(eco.streakRequired) || DEFAULT_STREAK_GOAL;
  const nextDailyAt = eco.nextDailyAt || (eco.lastDailyAt ? new Date(new Date(eco.lastDailyAt).getTime() + DAY_MS) : null);
  const canClaim = !nextDailyAt || new Date(nextDailyAt).getTime() <= now;
  const streak = Math.min(Number(eco.dailyStreak) || 0, goal);
  const daysToMega = Math.max(0, goal - streak);
  const gallery = chests.filter((c) => c.imageClosed);

  const claim = async () => {
    setClaiming(true);
    try {
      const r = await claimDaily();
      setWonChest({
        name: r.chestName, imageOpened: r.chestImageOpened,
        coins: r.coins, megaAwarded: r.megaAwarded, megaGems: r.megaGems,
      });
      if (!r.chestImageOpened) pushNotice(`Baú ${r.chestName}: +${fmt(r.coins)} moedas${r.megaAwarded ? ` e +${r.megaGems} gemas` : ''}!`);
      refresh();
    } catch (err) {
      pushNotice(err.response?.data?.error || 'Não foi possível resgatar.');
    } finally {
      setClaiming(false);
    }
  };

  const wait = !canClaim && nextDailyAt ? untilText(nextDailyAt, now) : null;
  // Nível do passe pra onde a trilha rola ao abrir.
  const focusLevel = season
    ? (season.tiers.find((t) => t.unlocked && (!t.claimedFree || (season.isSupporter && !t.claimedPlus)))?.level || Math.max(1, season.level))
    : 0;

  return (
    <div className="hub-frame eco-frame">
      {tabBar}
      <div className="pk-page eco">
        <div className="pk-inner">

          {tab === 'geral' && (
            <>
              <section className="eco-top">
                {/* O cartão é o destaque: fica solto no "chão" da página, sem moldura. */}
                <div className="eco-stage">
                  <WalletCard user={user} coins={eco.coins} gems={eco.gems} level={eco.accountLevel} variant={eco.cardStyle} />
                  <div className="eco-stage-links">
                    <Link to="/progresso" className="eco-quiet"><Ico name="trophy" size={15} /> Ver ranking</Link>
                    {eco.cardStyles?.length > 1 && (
                      <Link to="/loja?secao=cartao" className="eco-quiet"><Ico name="palette" size={15} /> Trocar o estilo do cartão</Link>
                    )}
                  </div>
                </div>

                <div className="eco-daily">
                  <header className="eco-daily-head">
                    <div className="eco-daily-title">
                      <h2>Baú diário</h2>
                      <span className={`eco-status${canClaim ? ' is-ready' : ''}`}>
                        {canClaim ? 'Disponível' : <><Ico name="clock" size={14} /> {wait ? `Volta em ${wait}` : 'Volta amanhã'}</>}
                      </span>
                    </div>
                    <p>Um baú por dia. No {goal}º dia seguido vem o Mega Baú, com gemas.</p>
                  </header>

                  <ol
                    className="eco-streak" style={{ '--eco-days': goal, '--eco-fill': goal > 1 ? Math.max(0, Math.min(1, (streak - 1) / (goal - 1))) : 0 }}
                    aria-label={`Sequência atual: ${eco.dailyStreak} de ${goal} dias`}
                  >
                    {Array.from({ length: goal }).map((_, i) => {
                      const done = i < streak;
                      const isMega = i === goal - 1;
                      const isNext = i === streak && canClaim;
                      return (
                        <li key={i} className={`${done ? 'done' : ''}${isMega ? ' mega' : ''}${isNext ? ' next' : ''}`}>
                          <span className="eco-streak-node">
                            {done ? <Ico name="check" size={16} strokeWidth={2.6} /> : isMega ? <Ico name="gem" size={18} /> : i + 1}
                          </span>
                          <small>{isMega ? 'Mega Baú' : isNext ? 'Hoje' : `Dia ${i + 1}`}</small>
                        </li>
                      );
                    })}
                  </ol>

                  <div className="eco-claim">
                    <button className="pk-btn primary lg eco-claim-btn" disabled={!canClaim || claiming} onClick={claim}>
                      <Ico name={canClaim ? 'chest' : 'check'} size={19} />
                      {claiming ? 'Abrindo...' : canClaim ? 'Resgatar baú diário' : 'Já resgatado hoje'}
                    </button>
                    <p className="eco-claim-note">
                      {daysToMega <= 1
                        ? <>O próximo resgate abre o <b>Mega Baú</b>, com 1 a 6 gemas.</>
                        : <>Faltam <b>{daysToMega} dias</b> para o Mega Baú. Mais de 48h sem resgatar zera a sequência.</>}
                    </p>
                  </div>
                </div>
              </section>

              <Link to="/progresso?tab=missoes" className="eco-panel eco-today eco-missions-moved">
                <Ico name="bolt" size={18} />
                <span><strong>Missões</strong> agora ficam no <strong>Progresso</strong>.</span>
                <span className="eco-quiet">Ver missões ›</span>
              </Link>

              <section className="eco-chests">
                <header className="eco-panel-head">
                  <h2>Baús possíveis{gallery.length > 0 && <small>{gallery.length}</small>}</h2>
                  <p className="eco-panel-sub">Cada resgate abre um destes, com moedas.</p>
                </header>
                {gallery.length > 0 && (
                  <div className="daily-chest-gallery eco-chest-grid">
                    {gallery.map((c) => (
                      <div key={c.id} className="daily-chest-gallery-item eco-chest" title={c.name}>
                        <TrimmedImg src={c.imageClosed} alt={c.name} />
                        <span>{c.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {tab === 'temporada' && (
            !season ? <Skeleton rows={3} height={120} /> : (
              <div className="eco-season">
                <header className="eco-tabhead">
                  <div>
                    <h1>{season.name}</h1>
                    <p>Termina em {untilText(season.endsAt, now)}. Missão diária vale <b>{season.pointsPerMission.daily}</b> pontos; semanal, <b>{season.pointsPerMission.weekly}</b>.</p>
                  </div>
                  <Purse coins={eco.coins} gems={eco.gems} />
                </header>
                <section className="eco-panel eco-season-head">
                  <strong className="eco-season-now">Nível {season.level}<small>de {season.maxLevel}</small></strong>
                  <div className="eco-season-meter">
                    <div className="eco-season-bar" aria-label={`${season.points % season.levelPoints} de ${season.levelPoints} pontos para o próximo nível`}>
                      <i style={{ width: `${season.level >= season.maxLevel ? 100 : ((season.points % season.levelPoints) / season.levelPoints) * 100}%` }} />
                    </div>
                    <small>{fmt(season.points)} pontos{season.level < season.maxLevel ? `, faltam ${season.levelPoints - (season.points % season.levelPoints)} para o nível ${season.level + 1}` : '. Nível máximo!'}</small>
                  </div>
                </section>
                {!season.isSupporter && (
                  <div className="eco-mult" role="note"><Ico name="crown" size={16} /><span>A <b>faixa de apoio</b> (mais moedas e gemas em todos os níveis) é para Assinantes.</span></div>
                )}
                <div className="eco-season-track" ref={trackRef}>
                  <div className="eco-season-legend" aria-hidden="true"><span>Grátis</span><span>Apoio</span></div>
                  {season.tiers.map((t) => {
                    const cell = (track) => {
                      const r = t[track];
                      const claimed = track === 'free' ? t.claimedFree : t.claimedPlus;
                      const locked = !t.unlocked || (track === 'plus' && !season.isSupporter);
                      return (
                        <div className={`eco-season-cell ${track}${claimed ? ' is-claimed' : ''}${locked ? ' is-locked' : ''}`}>
                          <span className="eco-season-reward">
                            {r.coins > 0 && <span><Ico name="coin" size={15} />{fmt(r.coins)}</span>}
                            {r.gems > 0 && <span className="gem"><Ico name="gem" size={15} />{fmt(r.gems)}</span>}
                          </span>
                          {claimed ? <span className="eco-season-done"><Ico name="check" size={14} strokeWidth={2.4} /> Resgatado</span>
                            : locked ? <span className="eco-season-lock">{track === 'plus' && t.unlocked ? 'Assinante' : `Nível ${t.level}`}</span>
                              : <button type="button" className="pk-btn sm primary" disabled={!!seasonBusy} onClick={() => claimSeason(t.level, track)}>{seasonBusy === `${t.level}:${track}` ? '…' : 'Resgatar'}</button>}
                        </div>
                      );
                    };
                    return (
                      <div key={t.level} data-focus={t.level === focusLevel ? '1' : undefined} className={`eco-season-tier${t.level % 5 === 0 ? ' milestone' : ''}${t.unlocked ? ' unlocked' : ''}`}>
                        <span className="eco-season-n">{t.level}</span>
                        {cell('free')}
                        {cell('plus')}
                      </div>
                    );
                  })}
                </div>
                <p className="pk-muted">Faixa de cima: grátis pra todo mundo. Faixa de baixo: apoio. Os pontos zeram quando a temporada muda; resgate antes de acabar.</p>
              </div>
            )
          )}

        </div>

        <Toast>{notice}</Toast>

      {wonChest?.imageOpened && (
        <div className="chest-reveal-overlay eco-reveal-backdrop" onClick={() => setWonChest(null)}>
          <div className="chest-reveal-card eco-reveal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Recompensa do baú">
            <div className="eco-reveal-glow" aria-hidden="true" />
            {/* Baú sem a borda transparente das imagens (utils/trimImage) — ele é o destaque do card. */}
            <TrimmedImg className="chest-reveal-img" src={wonChest.imageOpened} alt={wonChest.name} />
            <span className="pk-eyebrow">Você abriu</span>
            <h3>Baú {wonChest.name}!</h3>
            <div className="chest-reveal-rewards eco-reveal-rewards">
              <span className="pk-chip tint" style={{ '--tint': 'var(--yellow)' }}><Ico name="coin" size={14} /> +{fmt(wonChest.coins)} moedas</span>
              {wonChest.megaAwarded && <span className="pk-chip tint eco-mega"><Ico name="gem" size={14} /> Sequência completa: +{wonChest.megaGems} gemas!</span>}
            </div>
            <button className="pk-btn primary lg" onClick={() => setWonChest(null)}>Show!</button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
