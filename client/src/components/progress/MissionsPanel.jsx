import { useCallback, useEffect, useState } from 'react';
import { listMissions, claimMission } from '../../api/endpoints';
import { useSocket } from '../../context/SocketContext.jsx';
import { EmptyState, Ico, Skeleton, Toast } from '../PagesKit.jsx';
import { useLiveRefresh } from '../../utils/liveRefresh';
import { setClaimableMissions } from '../../utils/missionBadge';
import '../../styles/economy.css';

// Missões diárias e semanais (nov/2026: saíram da Economia e viraram a aba
// "Missões" do Progresso). Carrega, atualiza ao vivo (socket) e resgata.
function fmt(n) { return Math.floor(Number(n) || 0).toLocaleString('pt-BR'); }
const DAY_MS = 24 * 60 * 60 * 1000;
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


export default function MissionsPanel() {
  const { socket } = useSocket() || {};
  const [missionData, setMissionData] = useState(null); // { missions, resets, multiplier }
  const [claimingId, setClaimingId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const refreshMissions = useCallback(() => listMissions().then(setMissionData).catch(() => setMissionData((d) => d || { missions: [] })), []);
  useEffect(() => { refreshMissions(); }, [refreshMissions]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  // O progresso chega ao vivo pelo socket (mensagem, reação, call...).
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
    socket.on('missions:update', refreshMissions);
    socket.on('missions:progress', onProgress);
    return () => { socket.off('missions:update', refreshMissions); socket.off('missions:progress', onProgress); };
  }, [socket, refreshMissions]);
  useLiveRefresh(({ put }) => listMissions().then(put(setMissionData)));
  // Mantém a bolinha do menu (missões pra resgatar) igual ao que esta tela mostra.
  useEffect(() => {
    if (missionData) setClaimableMissions((missionData.missions || []).filter((m) => m.completed && !m.claimed).length);
  }, [missionData]);

  const pushNotice = (msg) => { setNotice(msg); setTimeout(() => setNotice(null), 4000); };
  const claimOne = async (m) => {
    setClaimingId(m.id);
    try {
      const r = await claimMission(m.id);
      setMissionData((cur) => cur && { ...cur, missions: cur.missions.map((x) => (x.id === m.id ? { ...x, claimed: true } : x)) });
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

  const missions = missionData?.missions || [];
  const daily = missions.filter((m) => m.period === 'DAILY');
  const weekly = missions.filter((m) => m.period === 'WEEKLY');
  const resetDaily = missionData?.resets?.daily ? untilText(missionData.resets.daily, now) : null;
  const resetWeekly = missionData?.resets?.weekly ? untilText(missionData.resets.weekly, now) : null;
  const missionList = (list, emptyText) => (list.length > 0 ? (
    <div className="eco-mission-list">
      {list.map((m) => <MissionCard key={m.id} m={m} onClaim={claimOne} busy={claimingId === m.id} />)}
    </div>
  ) : <EmptyState compact icon="bolt" title="Nenhuma missão" text={emptyText} />);
  const multiplierNote = missionData?.multiplier > 1
    ? <span>Bônus de apoio ativo: você ganha <b>{String(missionData.multiplier).replace('.', ',')}x</b> das moedas de cada missão.</span>
    : <span>Assinantes ganham <b>1,2x</b> e Super Assinantes <b>1,5x</b> das moedas das missões.</span>;

  return (
    <div className="eco pg-missions">
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
      {notice && <Toast>{notice}</Toast>}
    </div>
  );
}
