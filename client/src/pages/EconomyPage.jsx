import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getMyEconomy, claimDaily, listChests, listMissions, claimMission, getMissionSeason, claimSeasonReward } from '../api/endpoints';
import { useAuth } from '../context/AuthContext.jsx';
import WalletCard from '../components/WalletCard.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { EmptyState, Ico, PillTabs, Skeleton, Toast, Unavailable } from '../components/PagesKit.jsx';
import '../styles/hub-tabs.css';
import '../styles/economy.css';
import { useLiveRefresh } from '../utils/liveRefresh';
import { setClaimableMissions } from '../utils/missionBadge';
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

// Ícone de cada tipo de missão (traço, sem emoji).
const MISSION_ICON = {
  MESSAGES: 'chat', REACTIONS: 'heart', VOICE_MINUTES: 'volume', FORUM_POSTS: 'news',
  FORUM_COMMENTS: 'pen', SHOP_VISIT: 'store', DAILY_CHEST: 'chest',
};

function RewardChips({ m }) {
  return (
    <span className="eco-rewards">
      {m.rewardCoins > 0 && (
        <span className="eco-reward coins" title={m.finalCoins > m.rewardCoins ? `${fmt(m.rewardCoins)} + bônus de apoio` : undefined}>
          <Ico name="coin" size={14} />{fmt(m.finalCoins || m.rewardCoins)}{m.finalCoins > m.rewardCoins && <em className="eco-bonus">bônus</em>}
        </span>
      )}
      {m.rewardGems > 0 && <span className="eco-reward gems"><Ico name="gem" size={14} />{fmt(m.rewardGems)}</span>}
      {m.rewardXp > 0 && <span className="eco-reward xp">{fmt(m.rewardXp)} XP</span>}
      {m.rewardItem && (
        <span className="eco-reward item" title={m.rewardItem.days ? `${m.rewardItem.name} por ${m.rewardItem.days} dias` : m.rewardItem.name}>
          <Ico name="gift" size={13} strokeWidth={2} /><span className="truncate">{m.rewardItem.name}</span>{m.rewardItem.days ? <em>{m.rewardItem.days}d</em> : null}
        </span>
      )}
    </span>
  );
}

// Uma missão = uma linha: o que fazer, quanto falta, o que ganha e o botão.
// As colunas se alinham entre as linhas (grade da lista — ver economy.css).
function MissionCard({ m, onClaim, busy, compact }) {
  const pct = m.target > 0 ? Math.min(100, Math.round((m.progress / m.target) * 100)) : 0;
  const state = m.claimed ? 'claimed' : m.completed ? 'ready' : 'open';
  return (
    <div className={`eco-mission ${state}${compact ? ' compact' : ''}`}>
      <span className="eco-mission-icon"><Ico name={m.claimed ? 'check' : (MISSION_ICON[m.type] || 'bolt')} size={18} strokeWidth={m.claimed ? 2.4 : 1.8} /></span>
      <div className="eco-mission-body">
        <strong className="truncate">{m.title}</strong>
        {!compact && m.description && <p>{m.description}</p>}
      </div>
      <div className="eco-mission-progress">
        <div
          className={`eco-bar cxm-bar${state === 'ready' ? ' is-ready' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={m.target} aria-valuenow={m.progress}
          aria-label={`${m.title}: ${m.progress} de ${m.target}`}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <small>{fmt(m.progress)}/{fmt(m.target)}{m.unit ? ` ${m.unit}` : ''}</small>
      </div>
      <RewardChips m={m} />
      <div className="eco-mission-action">
        {state === 'ready' && (
          <button type="button" className="pk-btn primary sm eco-mission-claim" disabled={busy} onClick={() => onClaim(m)}>
            {busy ? '...' : 'Resgatar'}
          </button>
        )}
        {state === 'claimed' && <span className="eco-mission-done">Resgatada</span>}
      </div>
    </div>
  );
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
  // ?aba=temporada|missoes|geral — usado pela barra de abas da
  // Loja (HubTabs) pra voltar direto pra aba certa da Economia.
  const [searchParams] = useSearchParams();
  const abaParam = searchParams.get('aba');
  const validAba = ['geral', 'missoes', 'temporada'].includes(abaParam) ? abaParam : null;
  const [tab, setTab] = useState(() => validAba || initialTab);
  const [eco, setEco] = useState(null);
  const [chests, setChests] = useState([]);
  const [missionData, setMissionData] = useState(null); // { missions, resets }
  const [wonChest, setWonChest] = useState(null); // última recompensa, pra mostrar o PNG do baú
  const [notice, setNotice] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimingId, setClaimingId] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { setTab(validAba || initialTab); }, [initialTab, validAba]);

  const refresh = useCallback(() => getMyEconomy().then(setEco).catch((err) => {
    if (err?.response?.status === 503) setUnavailable(true);
  }), []);
  const refreshChests = useCallback(() => listChests().then((d) => setChests(d.chests)).catch(() => {}), []);
  const refreshMissions = useCallback(() => listMissions().then(setMissionData).catch(() => {}), []);

  useEffect(() => {
    refresh();
    refreshChests();
    refreshMissions();
  }, [refresh, refreshChests, refreshMissions]);
  // Temporada do mês (passe de missões).
  const navigate = useNavigate();
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

  // Staff edita baús/missões e a tela atualiza sozinha; o progresso das
  // missões chega ao vivo pelo socket (mensagem, reação, call...).
  useEffect(() => {
    if (!socket) return undefined;
    const onProgress = (p) => {
      setMissionData((cur) => {
        if (!cur) return cur;
        let changed = false;
        const missions = cur.missions.map((m) => {
          if (m.id !== p.missionId) return m;
          changed = true;
          return { ...m, progress: Math.max(m.progress, p.progress), completed: m.completed || !!p.completed };
        });
        return changed ? { ...cur, missions } : cur;
      });
    };
    socket.on('chests:update', refreshChests);
    socket.on('missions:update', refreshMissions);
    socket.on('missions:progress', onProgress);
    return () => {
      socket.off('chests:update', refreshChests);
      socket.off('missions:update', refreshMissions);
      socket.off('missions:progress', onProgress);
    };
  }, [socket, refreshChests, refreshMissions]);

  // Tempo real: saldo, baús e missões, em silêncio.
  useLiveRefresh(async ({ put }) => {
    await Promise.allSettled([
      getMyEconomy().then(put(setEco)),
      listChests().then((d) => put(setChests)(d.chests)),
      listMissions().then(put(setMissionData)),
    ]);
  }, { enabled: !unavailable });

  const pushNotice = (msg) => { setNotice(msg); setTimeout(() => setNotice(null), 4000); };

  // Mantém o badge do menu (missões pra resgatar) igual ao que esta tela mostra.
  useEffect(() => {
    if (missionData) setClaimableMissions((missionData.missions || []).filter((m) => m.completed && !m.claimed).length);
  }, [missionData]);

  const allMissions = missionData?.missions || [];
  const readyCount = allMissions.filter((m) => m.completed && !m.claimed).length;
  const tabs = [
    { id: 'geral', label: 'Visão geral', icon: 'grid' },
    { id: 'missoes', label: 'Missões', icon: 'bolt', count: readyCount },
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
  const missions = allMissions;
  const daily = missions.filter((m) => m.period === 'DAILY');
  const weekly = missions.filter((m) => m.period === 'WEEKLY');
  const doneToday = daily.filter((m) => m.claimed).length;

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
      refreshMissions();
    } catch (err) {
      pushNotice(err.response?.data?.error || 'Não foi possível resgatar.');
    } finally {
      setClaiming(false);
    }
  };

  const claimOne = async (m) => {
    setClaimingId(m.id);
    try {
      const r = await claimMission(m.id);
      setMissionData((cur) => cur && { ...cur, missions: cur.missions.map((x) => (x.id === m.id ? { ...x, claimed: true } : x)) });
      refreshSeason();
      if (r.balance) setEco((e) => e && { ...e, coins: r.balance.coins, gems: r.balance.gems, accountLevel: r.balance.accountLevel, accountXp: r.balance.accountXp });
      const parts = [];
      if (r.reward?.coins) parts.push(`+${fmt(r.reward.coins)} moedas`);
      if (r.reward?.gems) parts.push(`+${fmt(r.reward.gems)} gemas`);
      if (r.reward?.xp) parts.push(`+${fmt(r.reward.xp)} XP`);
      if (r.reward?.item) parts.push(r.reward.item.already ? `"${r.reward.item.name}" (você já tinha)` : `"${r.reward.item.name}"${r.reward.item.expiresAt ? ` até ${new Date(r.reward.item.expiresAt).toLocaleDateString('pt-BR')}` : ''}`);
      if (r.reward?.multiplier > 1) parts.push(`bônus ${String(r.reward.multiplier).replace('.', ',')}x de apoio`);
      if (r.reward?.seasonPoints) parts.push(`+${r.reward.seasonPoints} pontos de temporada`);
      pushNotice(`${m.title}: ${parts.join(', ') || 'resgatada'}${r.levelUp ? ` · Nível ${r.levelUp.newLevel}!` : ''}`);
    } catch (err) {
      pushNotice(err.response?.data?.error || 'Não foi possível resgatar a missão.');
      refreshMissions();
    } finally {
      setClaimingId(null);
    }
  };

  const resetDaily = missionData?.resets?.daily ? untilText(missionData.resets.daily, now) : null;
  const resetWeekly = missionData?.resets?.weekly ? untilText(missionData.resets.weekly, now) : null;

  const missionList = (list, emptyText, compact = false) => (list.length > 0 ? (
    <div className="eco-mission-list">
      {list.map((m) => <MissionCard key={m.id} m={m} onClaim={claimOne} busy={claimingId === m.id} compact={compact} />)}
    </div>
  ) : <EmptyState compact icon="bolt" title="Nenhuma missão" text={emptyText} />);

  const wait = !canClaim && nextDailyAt ? untilText(nextDailyAt, now) : null;
  // Nível do passe pra onde a trilha rola ao abrir.
  const focusLevel = season
    ? (season.tiers.find((t) => t.unlocked && (!t.claimedFree || (season.isSupporter && !t.claimedPlus)))?.level || Math.max(1, season.level))
    : 0;
  const multiplierNote = missionData?.multiplier > 1
    ? <span>Bônus de apoio ativo: você ganha <b>{String(missionData.multiplier).replace('.', ',')}x</b> das moedas de cada missão.</span>
    : <span>Assinantes ganham <b>1,2x</b> e Super Assinantes <b>1,5x</b> das moedas das missões.</span>;

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

              <section className="eco-panel eco-today">
                <header className="eco-panel-head">
                  <h2>Missões de hoje{daily.length > 0 && <small>{doneToday} de {daily.length}</small>}</h2>
                  <div className="eco-panel-meta">
                    {resetDaily && <span className="eco-reset"><Ico name="clock" size={14} /> Novas em {resetDaily}</span>}
                    <button type="button" className="pk-btn sm" onClick={() => setTab('missoes')}>Ver todas</button>
                  </div>
                </header>
                {!missionData ? <Skeleton rows={3} height={52} /> : daily.length > 0
                  ? missionList(daily.slice(0, 4), '', true)
                  : <EmptyState compact icon="bolt" title="Sem missões hoje" text="A equipe ainda não criou missões diárias." />}
              </section>

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

          {tab === 'missoes' && (
            <>
              <header className="eco-tabhead">
                <div>
                  <h1>Missões</h1>
                  <p>O progresso conta sozinho enquanto você usa o Project Club.</p>
                </div>
                <Purse coins={eco.coins} gems={eco.gems} />
              </header>
              {!missionData ? <Skeleton rows={4} height={64} /> : (
                <div className="eco-missions">
                  <div className="eco-mult" role="note"><Ico name="crown" size={16} />{multiplierNote}</div>
                  <section className="eco-panel">
                    <header className="eco-panel-head">
                      <h2>Diárias</h2>
                      {resetDaily && <span className="eco-reset"><Ico name="clock" size={14} /> Renova em {resetDaily}</span>}
                    </header>
                    {missionList(daily, 'A equipe ainda não criou missões diárias.')}
                  </section>
                  <section className="eco-panel">
                    <header className="eco-panel-head">
                      <h2>Semanais</h2>
                      {resetWeekly && <span className="eco-reset"><Ico name="clock" size={14} /> Renova em {resetWeekly}</span>}
                    </header>
                    {missionList(weekly, 'A equipe ainda não criou missões semanais.')}
                  </section>
                  <p className="pk-muted eco-missions-note">Contam: mensagens nos canais, reações em mensagens de outras pessoas, tempo em call com mais alguém, posts e comentários no Fórum. Os horários são de Brasília.</p>
                </div>
              )}
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
