import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMyEconomy, claimDaily, listChests, listMissions, claimMission, getEconomyHistory, getMissionSeason, claimSeasonReward } from '../api/endpoints';
import { useSocket } from '../context/SocketContext.jsx';
import { EmptyState, Ico, PageHero, PillTabs, Skeleton, Toast, Unavailable } from '../components/PagesKit.jsx';
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
const HISTORY_ICON = { DAILY: 'chest', MISSION: 'bolt', SHOP: 'store', ADMIN: 'shield', LEVEL: 'trophy' };

function RewardChips({ m }) {
  return (
    <span className="eco-rewards">
      {m.rewardCoins > 0 && (
        <span className="eco-reward coins" title={m.finalCoins > m.rewardCoins ? `${fmt(m.rewardCoins)} + bônus de apoio` : undefined}>
          <Ico name="coin" size={13} strokeWidth={2} />{fmt(m.finalCoins || m.rewardCoins)}{m.finalCoins > m.rewardCoins && <em className="eco-bonus">bônus</em>}
        </span>
      )}
      {m.rewardGems > 0 && <span className="eco-reward gems"><Ico name="gem" size={13} strokeWidth={2} />{fmt(m.rewardGems)}</span>}
      {m.rewardXp > 0 && <span className="eco-reward xp"><Ico name="star" size={13} strokeWidth={2} />{fmt(m.rewardXp)} XP</span>}
      {m.rewardItem && (
        <span className="eco-reward item" title={m.rewardItem.days ? `${m.rewardItem.name} por ${m.rewardItem.days} dias` : m.rewardItem.name}>
          <Ico name="gift" size={13} strokeWidth={2} />{m.rewardItem.name}{m.rewardItem.days ? ` · ${m.rewardItem.days}d` : ''}
        </span>
      )}
    </span>
  );
}

function MissionCard({ m, onClaim, busy, compact }) {
  const pct = m.target > 0 ? Math.min(100, Math.round((m.progress / m.target) * 100)) : 0;
  const state = m.claimed ? 'claimed' : m.completed ? 'ready' : 'open';
  return (
    <div className={`eco-mission ${state}${compact ? ' compact' : ''}`}>
      <span className="eco-mission-icon"><Ico name={m.claimed ? 'check' : (MISSION_ICON[m.type] || 'bolt')} size={compact ? 18 : 20} strokeWidth={m.claimed ? 2.4 : 1.8} /></span>
      <div className="eco-mission-body">
        <div className="eco-mission-top">
          <strong className="truncate">{m.title}</strong>
          <RewardChips m={m} />
        </div>
        {!compact && m.description && <p>{m.description}</p>}
        <div className="eco-mission-progress">
          <div
            className={`eco-bar cxm-bar${state === 'ready' ? ' is-ready' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={m.target} aria-valuenow={m.progress}
            aria-label={`${m.title}: ${m.progress} de ${m.target}`}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <small>{fmt(m.progress)}/{fmt(m.target)}{m.unit ? ` ${m.unit}` : ''}</small>
        </div>
      </div>
      {state === 'ready' && (
        <button type="button" className="pk-btn primary eco-mission-claim" disabled={busy} onClick={() => onClaim(m)}>
          <Ico name="gift" size={16} /> {busy ? '...' : 'Resgatar'}
        </button>
      )}
      {state === 'claimed' && <span className="eco-mission-done">Resgatada</span>}
    </div>
  );
}

// Hub da Economia: saldo, baú diário, missões, histórico e atalhos.
export default function EconomyPage({ initialTab = 'geral' }) {
  const { socket } = useSocket();
  const [tab, setTab] = useState(initialTab);
  const [eco, setEco] = useState(null);
  const [chests, setChests] = useState([]);
  const [missionData, setMissionData] = useState(null); // { missions, resets }
  const [history, setHistory] = useState(null); // { transactions, hasMore }
  const [loadingMore, setLoadingMore] = useState(false);
  const [wonChest, setWonChest] = useState(null); // última recompensa, pra mostrar o PNG do baú
  const [notice, setNotice] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimingId, setClaimingId] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const refresh = useCallback(() => getMyEconomy().then(setEco).catch((err) => {
    if (err?.response?.status === 503) setUnavailable(true);
  }), []);
  const refreshChests = useCallback(() => listChests().then((d) => setChests(d.chests)).catch(() => {}), []);
  const refreshMissions = useCallback(() => listMissions().then(setMissionData).catch(() => {}), []);
  const refreshHistory = useCallback(() => getEconomyHistory({ limit: 30 }).then(setHistory).catch(() => setHistory((h) => h || { transactions: [], hasMore: false })), []);

  useEffect(() => {
    refresh();
    refreshChests();
    refreshMissions();
  }, [refresh, refreshChests, refreshMissions]);
  useEffect(() => { if (tab === 'historico') refreshHistory(); }, [tab, refreshHistory]);
  // Temporada do mês (passe de missões).
  const [season, setSeason] = useState(null);
  const [seasonBusy, setSeasonBusy] = useState('');
  const refreshSeason = useCallback(() => getMissionSeason().then((d) => setSeason(Array.isArray(d?.tiers) ? d : null)).catch(() => {}), []);
  useEffect(() => { refreshSeason(); }, [refreshSeason]);
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

  if (unavailable) return <Unavailable icon="coin" />;
  if (!eco) {
    return (
      <div className="pk-page eco"><div className="pk-inner">
        <Skeleton rows={1} height={128} />
        <div className="eco-layout"><Skeleton rows={1} height={300} /><Skeleton rows={1} height={300} /></div>
      </div></div>
    );
  }

  const goal = Number(eco.streakRequired) || DEFAULT_STREAK_GOAL;
  const nextDailyAt = eco.nextDailyAt || (eco.lastDailyAt ? new Date(new Date(eco.lastDailyAt).getTime() + DAY_MS) : null);
  const canClaim = !nextDailyAt || new Date(nextDailyAt).getTime() <= now;
  const streak = Math.min(Number(eco.dailyStreak) || 0, goal);
  const daysToMega = Math.max(0, goal - streak);
  const gallery = chests.filter((c) => c.imageClosed);
  const missions = missionData?.missions || [];
  const daily = missions.filter((m) => m.period === 'DAILY');
  const weekly = missions.filter((m) => m.period === 'WEEKLY');
  const readyCount = missions.filter((m) => m.completed && !m.claimed).length;
  const doneToday = daily.filter((m) => m.claimed).length;

  const claim = async () => {
    setClaiming(true);
    try {
      const r = await claimDaily();
      setWonChest({
        name: r.chestName, imageOpened: r.chestImageOpened,
        coins: r.coins, tickets: r.tickets, megaAwarded: r.megaAwarded, megaGems: r.megaGems,
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
      if (tab === 'historico') refreshHistory();
    } catch (err) {
      pushNotice(err.response?.data?.error || 'Não foi possível resgatar a missão.');
      refreshMissions();
    } finally {
      setClaimingId(null);
    }
  };

  const loadMoreHistory = async () => {
    const list = history?.transactions || [];
    if (!list.length) return;
    setLoadingMore(true);
    try {
      const d = await getEconomyHistory({ limit: 30, before: list[list.length - 1].createdAt });
      setHistory({ transactions: [...list, ...d.transactions], hasMore: d.hasMore });
    } catch { /* tenta de novo no próximo clique */ } finally { setLoadingMore(false); }
  };

  const tabs = [
    { id: 'geral', label: 'Visão geral', icon: 'grid' },
    { id: 'missoes', label: 'Missões', icon: 'bolt', count: readyCount },
    { id: 'temporada', label: 'Temporada', icon: 'crown', count: seasonReady || undefined },
    { id: 'historico', label: 'Histórico', icon: 'clock' },
  ];

  const resetDaily = missionData?.resets?.daily ? untilText(missionData.resets.daily, now) : null;
  const resetWeekly = missionData?.resets?.weekly ? untilText(missionData.resets.weekly, now) : null;

  const missionList = (list, emptyText) => (list.length > 0 ? (
    <div className="eco-mission-list">
      {list.map((m) => <MissionCard key={m.id} m={m} onClaim={claimOne} busy={claimingId === m.id} />)}
    </div>
  ) : <EmptyState compact icon="bolt" title="Nenhuma missão" text={emptyText} />);

  return (
    <div className="pk-page eco">
      <div className="pk-inner">
        <PageHero
          icon="coin" eyebrow="Sua carteira" title="Economia"
          desc="Ganhe moedas com o baú diário e as missões, e gaste na Loja. Gemas vêm das sequências completas e das missões semanais."
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

        <PillTabs tabs={tabs} value={tab} onChange={setTab} label="Seções da Economia" className="eco-tabs" />

        {tab === 'geral' && (
          <>
            <div className="eco-layout">
              <section className="pk-card eco-daily">
                <div className="eco-daily-head">
                  <span className="eco-daily-badge"><Ico name="gift" size={24} /></span>
                  <div>
                    <h2>Recompensa diária</h2>
                    <p className="pk-muted">Resgate uma vez por dia. Mantenha a sequência por {goal} dias seguidos para ganhar um Mega Baú de gemas.</p>
                  </div>
                </div>

                <div className="eco-streak" aria-label={`Sequência atual: ${eco.dailyStreak} de ${goal} dias`}>
                  <div className="eco-streak-top">
                    <span><Ico name="flame" size={16} /> Sequência atual</span>
                    <strong>{eco.dailyStreak}/{goal} dias</strong>
                  </div>
                  <ol className="eco-streak-days" style={{ '--eco-days': goal }}>
                    {Array.from({ length: goal }).map((_, i) => {
                      const done = i < streak;
                      const isMega = i === goal - 1;
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
                  <p className="eco-streak-hint">
                    {daysToMega <= 1
                      ? <><Ico name="gem" size={14} /> O próximo resgate abre o <b>Mega Baú</b> (1 a 6 gemas)!</>
                      : <>Faltam <b>{daysToMega} dias</b> para o Mega Baú. Ficar mais de 48h sem resgatar zera a sequência.</>}
                  </p>
                </div>

                <div className="eco-claim">
                  <button className="pk-btn primary lg eco-claim-btn" disabled={!canClaim || claiming} onClick={claim}>
                    <Ico name={canClaim ? 'chest' : 'check'} size={19} />
                    {claiming ? 'Abrindo...' : canClaim ? 'Resgatar baú diário' : 'Já resgatado hoje'}
                  </button>
                  {!canClaim && nextDailyAt && untilText(nextDailyAt, now) && (
                    <span className="eco-claim-wait"><Ico name="clock" size={15} /> Próximo baú em {untilText(nextDailyAt, now)}</span>
                  )}
                </div>
              </section>

              <section className="pk-card eco-today">
                <div className="eco-card-head">
                  <h2 className="pk-section-title"><Ico name="bolt" /> Missões de hoje <small>{daily.length > 0 ? `· ${doneToday}/${daily.length}` : ''}</small></h2>
                  <button type="button" className="pk-btn ghost sm" onClick={() => setTab('missoes')}>Ver todas</button>
                </div>
                {!missionData ? <Skeleton rows={3} height={52} /> : daily.length > 0 ? (
                  <div className="eco-mission-list">
                    {daily.slice(0, 4).map((m) => <MissionCard key={m.id} m={m} onClaim={claimOne} busy={claimingId === m.id} compact />)}
                  </div>
                ) : <EmptyState compact icon="bolt" title="Sem missões hoje" text="A equipe ainda não criou missões diárias." />}
                {resetDaily && <p className="eco-reset"><Ico name="clock" size={14} /> Novas missões em {resetDaily}</p>}
              </section>
            </div>

            <section className="pk-card eco-chests">
              <h2 className="pk-section-title"><Ico name="chest" /> Baús possíveis <small>{gallery.length > 0 ? `· ${gallery.length}` : ''}</small></h2>
              {gallery.length > 0 ? (
                <div className="daily-chest-gallery eco-chest-grid">
                  {gallery.map((c) => (
                    <div key={c.id} className="daily-chest-gallery-item eco-chest" title={c.name}>
                      <TrimmedImg src={c.imageClosed} alt={c.name} />
                      <span>{c.name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="pk-muted">Cada resgate abre um baú aleatório com moedas e, às vezes, tickets.</p>
              )}
            </section>

            <section>
              <h2 className="pk-section-title"><Ico name="sparkles" /> Atalhos</h2>
              <div className="eco-links">
                <Link to="/loja" className="eco-link">
                  <span className="eco-link-icon"><Ico name="store" size={20} /></span>
                  <div><strong>Loja</strong><small>Molduras, efeitos de perfil e coleções.</small></div>
                  <Ico name="right" size={18} />
                </Link>
                <button type="button" className="eco-link" onClick={() => setTab('missoes')}>
                  <span className="eco-link-icon"><Ico name="bolt" size={20} /></span>
                  <div><strong>Missões</strong><small>{readyCount > 0 ? `${readyCount} recompensa${readyCount > 1 ? 's' : ''} para resgatar.` : 'Tarefas diárias e semanais com prêmios.'}</small></div>
                  <Ico name="right" size={18} />
                </button>
                <Link to="/progresso" className="eco-link">
                  <span className="eco-link-icon"><Ico name="trophy" size={20} /></span>
                  <div><strong>Ranking</strong><small>Nível {fmt(eco.accountLevel)} · veja sua posição.</small></div>
                  <Ico name="right" size={18} />
                </Link>
              </div>
            </section>
          </>
        )}

        {tab === 'missoes' && (
          !missionData ? <Skeleton rows={4} height={86} /> : (
            <div className="eco-missions">
              <div className="eco-mult" role="note">
                <Ico name="crown" size={16} />
                {missionData.multiplier > 1
                  ? <span>Bônus de apoio ativo: você ganha <b>{String(missionData.multiplier).replace('.', ',')}x</b> das moedas de cada missão.</span>
                  : <span>Assinantes ganham <b>1,2x</b> e Super Assinantes <b>1,5x</b> das moedas das missões.</span>}
              </div>
              <section>
                <div className="eco-card-head">
                  <h2 className="pk-section-title"><Ico name="bolt" /> Diárias</h2>
                  {resetDaily && <span className="eco-reset"><Ico name="clock" size={14} /> Renova em {resetDaily}</span>}
                </div>
                {missionList(daily, 'A equipe ainda não criou missões diárias.')}
              </section>
              <section>
                <div className="eco-card-head">
                  <h2 className="pk-section-title"><Ico name="star" /> Semanais</h2>
                  {resetWeekly && <span className="eco-reset"><Ico name="clock" size={14} /> Renova em {resetWeekly}</span>}
                </div>
                {missionList(weekly, 'A equipe ainda não criou missões semanais.')}
              </section>
              <p className="pk-muted eco-missions-note">O progresso conta sozinho: mensagens nos canais, reações em mensagens de outras pessoas, tempo em call com mais alguém, posts e comentários no Fórum. Horário de Brasília.</p>
            </div>
          )
        )}

        {tab === 'temporada' && (
          !season ? <Skeleton rows={3} height={120} /> : (
            <div className="eco-season">
              <section className="pk-card eco-season-head">
                <div>
                  <h2>{season.name}</h2>
                  <p className="pk-muted">Termina em {untilText(season.endsAt, now)} · missão diária dá <b>{season.pointsPerMission.daily}</b> pontos, semanal dá <b>{season.pointsPerMission.weekly}</b>.</p>
                </div>
                <div className="eco-season-level">
                  <strong>Nível {season.level}<small>/{season.maxLevel}</small></strong>
                  <div className="eco-season-bar" aria-label={`${season.points % season.levelPoints} de ${season.levelPoints} pontos para o próximo nível`}>
                    <i style={{ width: `${season.level >= season.maxLevel ? 100 : ((season.points % season.levelPoints) / season.levelPoints) * 100}%` }} />
                  </div>
                  <small className="pk-muted">{fmt(season.points)} pontos{season.level < season.maxLevel ? ` · faltam ${season.levelPoints - (season.points % season.levelPoints)} pro nível ${season.level + 1}` : ' · nível máximo!'}</small>
                </div>
              </section>
              {!season.isSupporter && (
                <div className="eco-mult" role="note"><Ico name="crown" size={16} /><span>A <b>faixa de apoio</b> (mais moedas e gemas em todos os níveis) é para Assinantes.</span></div>
              )}
              <div className="eco-season-track">
                {season.tiers.map((t) => {
                  const cell = (track) => {
                    const r = t[track];
                    const claimed = track === 'free' ? t.claimedFree : t.claimedPlus;
                    const locked = !t.unlocked || (track === 'plus' && !season.isSupporter);
                    return (
                      <div className={`eco-season-cell ${track}${claimed ? ' is-claimed' : ''}${locked ? ' is-locked' : ''}`}>
                        <span className="eco-season-reward">
                          {r.coins > 0 && <span><Ico name="coin" size={13} strokeWidth={2} />{fmt(r.coins)}</span>}
                          {r.gems > 0 && <span className="gem"><Ico name="gem" size={13} strokeWidth={2} />{fmt(r.gems)}</span>}
                        </span>
                        {claimed ? <span className="eco-season-done"><Ico name="check" size={14} /> Resgatado</span>
                          : locked ? <span className="eco-season-lock">{track === 'plus' && t.unlocked ? 'Assinante' : `Nível ${t.level}`}</span>
                            : <button type="button" className="pk-btn sm primary" disabled={!!seasonBusy} onClick={() => claimSeason(t.level, track)}>{seasonBusy === `${t.level}:${track}` ? '…' : 'Resgatar'}</button>}
                      </div>
                    );
                  };
                  return (
                    <div key={t.level} className={`eco-season-tier${t.level % 5 === 0 ? ' milestone' : ''}${t.unlocked ? ' unlocked' : ''}`}>
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

        {tab === 'historico' && (
          !history ? <Skeleton rows={6} height={58} /> : history.transactions.length === 0 ? (
            <EmptyState icon="clock" title="Nada por aqui ainda" text="Baús, missões e compras na Loja aparecem aqui a partir de agora." />
          ) : (
            <section className="pk-card eco-history">
              <ul>
                {history.transactions.map((t) => (
                  <li key={t.id}>
                    <span className={`eco-history-icon k-${String(t.kind).toLowerCase()}`}><Ico name={HISTORY_ICON[t.kind] || 'coin'} size={18} /></span>
                    <div className="eco-history-text">
                      <strong className="truncate">{t.label}</strong>
                      <small>{new Date(t.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                    </div>
                    <span className="eco-history-deltas">
                      {t.coins !== 0 && <span className={t.coins > 0 ? 'plus' : 'minus'}><Ico name="coin" size={13} strokeWidth={2} />{t.coins > 0 ? '+' : '−'}{fmt(Math.abs(t.coins))}</span>}
                      {t.gems !== 0 && <span className={t.gems > 0 ? 'plus gem' : 'minus gem'}><Ico name="gem" size={13} strokeWidth={2} />{t.gems > 0 ? '+' : '−'}{fmt(Math.abs(t.gems))}</span>}
                      {t.xp > 0 && <span className="plus xp">+{fmt(t.xp)} XP</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {history.hasMore && (
                <button type="button" className="pk-btn ghost eco-history-more" disabled={loadingMore} onClick={loadMoreHistory}>
                  {loadingMore ? 'Carregando...' : 'Ver mais'}
                </button>
              )}
            </section>
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
