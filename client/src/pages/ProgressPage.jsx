import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { getRank, listLeaderboard, listAchievements } from '../api/endpoints';
import UserAvatar from '../components/UserAvatar.jsx';
import PageIcon from '../components/PageIcons.jsx';
import { LEVEL_REWARDS } from '../utils/levelRewards';
import { RARITY_LABEL, RARITY_COLOR } from '../utils/achievementRarity';
import { categoryFor, CATEGORY_ORDER } from '../utils/achievementCategory';
import { proxyImage } from '../utils/imageProxy';
import defaultAchievementIcon from '../assets/icons/nav-achievements.png';
import '../styles/progress.css';

// Progresso: um cabeçalho fixo com o seu nível (sempre visível) e três
// abas — Ranking, Conquistas e Recompensas. A aba atual fica na URL
// (?tab=), então dá pra mandar o link direto pra uma delas.
const TABS = [
  { key: 'ranking', label: 'Ranking', icon: 'trophy' },
  { key: 'conquistas', label: 'Conquistas', icon: 'medal' },
  { key: 'recompensas', label: 'Recompensas', icon: 'gift' },
];

const fmt = (n) => (n ?? 0).toLocaleString('pt-BR');

export default function ProgressPage() {
  const { user } = useAuth();
  const { socket } = useSocket() || {};
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'ranking';
  const setTab = (key) => setParams(key === 'ranking' ? {} : { tab: key }, { replace: true });

  const [rank, setRank] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [achievements, setAchievements] = useState(null);

  const refreshAchievements = () => listAchievements().then((d) => setAchievements(d.achievements)).catch(() => setAchievements([]));
  useEffect(() => {
    getRank().then(setRank).catch(() => setRank(false));
    listLeaderboard().then((d) => setLeaderboard(d.leaderboard)).catch(() => setLeaderboard([]));
    refreshAchievements();
  }, []);

  // Conquista desbloqueada ou catálogo editado pela staff: atualiza sozinho.
  useEffect(() => {
    if (!socket) return;
    socket.on('achievement:unlocked', refreshAchievements);
    socket.on('achievement:catalog-update', refreshAchievements);
    return () => {
      socket.off('achievement:unlocked', refreshAchievements);
      socket.off('achievement:catalog-update', refreshAchievements);
    };
  }, [socket]);

  const level = user?.accountLevel ?? rank?.level ?? 1;
  const unlocked = achievements?.filter((a) => a.unlocked).length ?? 0;
  const rewardsUnlocked = LEVEL_REWARDS.filter((r) => level >= r.level).length;
  const counts = { conquistas: achievements ? `${unlocked}/${achievements.length}` : null, recompensas: `${rewardsUnlocked}/${LEVEL_REWARDS.length}` };

  return (
    <div className="pg">
      <ProgressHero user={user} rank={rank} level={level} unlocked={unlocked} totalAchievements={achievements?.length} />

      <div className="pg-tabs" role="tablist" aria-label="Seções do progresso">
        {TABS.map((t) => (
          <button
            key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            className={`pg-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}
          >
            <PageIcon name={t.icon} size={17} />
            {t.label}
            {counts[t.key] && <span className="pg-tab-count">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      {tab === 'ranking' && <Ranking leaderboard={leaderboard} me={user} rank={rank} />}
      {tab === 'conquistas' && <Achievements achievements={achievements} />}
      {tab === 'recompensas' && <Rewards level={level} rank={rank} />}
    </div>
  );
}

/* ---------- Cabeçalho com o seu nível ---------- */
function ProgressHero({ user, rank, level, unlocked, totalAchievements }) {
  const pct = rank?.isMaxLevel ? 100 : (rank?.progress ?? 0);
  return (
    <section className="pg-hero">
      <div className="pg-hero-main">
        <div className="pg-hero-avatar">
          <UserAvatar user={user} size={84} />
          <span className="pg-hero-level" aria-label={`Nível ${level}`}>{level}</span>
        </div>
        <div className="pg-hero-text">
          <span className="pg-hero-eyebrow">Seu progresso</span>
          <h1 className="truncate">{user?.displayName}</h1>
          <div className="pg-hero-chips">
            {rank?.levelTitle && <span className="pg-chip brand"><PageIcon name="star" size={14} /> {rank.levelTitle}</span>}
            {rank?.levelName && <span className="pg-chip">{rank.levelName}</span>}
          </div>
        </div>
      </div>

      <div className="pg-hero-xp">
        <div className="pg-hero-xp-row">
          <strong>{rank ? (rank.isMaxLevel ? 'Nível máximo!' : `Nível ${level} → ${rank.nextLevel}`) : 'Carregando…'}</strong>
          {rank && !rank.isMaxLevel && <span>{fmt(rank.xpInLevel)} / {fmt(rank.xpNeeded)} XP</span>}
        </div>
        <div className="pg-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
        {rank && !rank.isMaxLevel && <p>Faltam <strong>{fmt(Math.max(0, rank.xpNeeded - rank.xpInLevel))} XP</strong> para o próximo nível. Conversar, postar e participar de eventos rende XP.</p>}
      </div>

      <dl className="pg-hero-stats">
        <div><dt><PageIcon name="trophy" size={15} /> Posição</dt><dd>{rank?.position ? `#${fmt(rank.position)}` : '—'}</dd></div>
        <div><dt><PageIcon name="bolt" size={15} /> XP total</dt><dd>{rank ? fmt(rank.xp) : '—'}</dd></div>
        <div><dt><PageIcon name="medal" size={15} /> Conquistas</dt><dd>{totalAchievements != null ? `${unlocked}/${totalAchievements}` : '—'}</dd></div>
      </dl>
    </section>
  );
}

/* ---------- Ranking ---------- */
function Ranking({ leaderboard, me, rank }) {
  if (leaderboard === null) return <Loading />;
  if (leaderboard.length === 0) return <Empty icon="trophy" title="Ninguém no ranking ainda" text="Converse e participe da comunidade para aparecer aqui." />;

  const top = leaderboard.filter((u) => !u.outsideTop50);
  const podium = top.slice(0, 3);
  const rest = top.slice(3);
  const meOutside = leaderboard.find((u) => u.outsideTop50);
  // Pódio na ordem visual 2º · 1º · 3º.
  const order = [podium[1], podium[0], podium[2]].filter(Boolean);

  return (
    <div className="pg-ranking">
      <div className="pg-podium">
        {order.map((u) => {
          const place = podium.indexOf(u) + 1;
          return (
            <div key={u.id} className={`pg-podium-spot place-${place}${u.id === me?.id ? ' is-me' : ''}`}>
              <div className="pg-podium-avatar">
                <UserAvatar user={u} size={place === 1 ? 76 : 60} />
                <span className="pg-podium-place">{place}</span>
              </div>
              <strong className="truncate">{u.displayName}</strong>
              <span className="pg-podium-meta">Nv. {u.accountLevel} · {fmt(u.accountXp)} XP</span>
              <div className="pg-podium-block" />
            </div>
          );
        })}
      </div>

      {rest.length > 0 && (
        <ol className="pg-list" start={4}>
          {rest.map((u, i) => <RankRow key={u.id} u={u} pos={i + 4} isMe={u.id === me?.id} />)}
        </ol>
      )}
      {meOutside && (
        <>
          <div className="pg-list-gap" aria-hidden="true">•••</div>
          <ol className="pg-list"><RankRow u={meOutside} pos={rank?.position} isMe /></ol>
        </>
      )}
    </div>
  );
}

function RankRow({ u, pos, isMe }) {
  return (
    <li className={`pg-row${isMe ? ' is-me' : ''}`}>
      <span className="pg-row-pos">#{pos}</span>
      <UserAvatar user={u} size={36} />
      <span className="pg-row-name truncate">{u.displayName}{isMe && <span className="pg-you">você</span>}</span>
      <span className="pg-row-level">Nv. {u.accountLevel}</span>
      <span className="pg-row-xp">{fmt(u.accountXp)} XP</span>
    </li>
  );
}

/* ---------- Conquistas ---------- */
const STATUS_FILTERS = [
  { key: 'ALL', label: 'Todas' },
  { key: 'UNLOCKED', label: 'Desbloqueadas' },
  { key: 'LOCKED', label: 'Em andamento' },
];
const RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'];

function Achievements({ achievements }) {
  const [status, setStatus] = useState('ALL');
  const [rarity, setRarity] = useState('ALL');

  const grouped = useMemo(() => {
    if (!achievements) return [];
    const by = {};
    for (const a of achievements) {
      if (status === 'UNLOCKED' && !a.unlocked) continue;
      if (status === 'LOCKED' && a.unlocked) continue;
      if (rarity !== 'ALL' && a.rarity !== rarity) continue;
      (by[categoryFor(a.progressType)] ||= []).push(a);
    }
    // Dentro de cada categoria: as mais perto de completar primeiro, desbloqueadas no fim.
    const score = (a) => (a.unlocked ? 2 : 1 - (a.progress || 0) / (a.target || 1));
    return CATEGORY_ORDER.filter((c) => by[c]?.length).map((c) => [c, by[c].sort((x, y) => score(x) - score(y))]);
  }, [achievements, status, rarity]);

  if (achievements === null) return <Loading />;
  if (achievements.length === 0) return <Empty icon="medal" title="Nenhuma conquista cadastrada" text="Assim que a equipe criar conquistas, elas aparecem aqui." />;

  const byRarity = Object.fromEntries(RARITIES.map((r) => [r, achievements.filter((a) => a.rarity === r)]));

  return (
    <div className="pg-ach">
      <div className="pg-rarity-summary">
        {RARITIES.map((r) => {
          const list = byRarity[r];
          if (!list.length) return null;
          const done = list.filter((a) => a.unlocked).length;
          return (
            <button
              key={r} type="button" className={`pg-rarity${rarity === r ? ' active' : ''}`}
              style={{ '--rarity': RARITY_COLOR[r] }} onClick={() => setRarity(rarity === r ? 'ALL' : r)}
              aria-pressed={rarity === r}
            >
              <span className="pg-rarity-name">{RARITY_LABEL[r]}</span>
              <span className="pg-rarity-count">{done}<small>/{list.length}</small></span>
              <span className="pg-mini-bar"><span style={{ width: `${(done / list.length) * 100}%` }} /></span>
            </button>
          );
        })}
      </div>

      <div className="pg-filters">
        {STATUS_FILTERS.map((f) => (
          <button key={f.key} type="button" className={`pg-filter${status === f.key ? ' active' : ''}`} onClick={() => setStatus(f.key)}>{f.label}</button>
        ))}
        {rarity !== 'ALL' && (
          <button type="button" className="pg-filter clear" onClick={() => setRarity('ALL')}>
            {RARITY_LABEL[rarity]} <PageIcon name="close" size={14} />
          </button>
        )}
      </div>

      {grouped.length === 0 && <Empty icon="search" title="Nada com esses filtros" text="Tente outra combinação de filtros." />}

      {grouped.map(([category, items]) => (
        <section key={category} className="pg-ach-group">
          <h2>{category} <span>{items.filter((a) => a.unlocked).length}/{items.length}</span></h2>
          <div className="pg-ach-grid">
            {items.map((a) => {
              const pct = a.unlocked ? 100 : Math.min(100, Math.floor(((a.progress || 0) / (a.target || 1)) * 100));
              return (
                <article key={a.id} className={`pg-ach-card${a.unlocked ? ' done' : ''}`} style={{ '--rarity': RARITY_COLOR[a.rarity] }}>
                  <div className="pg-ach-icon">
                    <img src={proxyImage(a.iconUrl) || defaultAchievementIcon} alt="" loading="lazy" />
                    {!a.unlocked && <span className="pg-ach-lock"><PageIcon name="lock" size={12} strokeWidth={2.2} /></span>}
                  </div>
                  <div className="pg-ach-body">
                    <div className="pg-ach-top">
                      <h3>{a.name}</h3>
                      <span className="pg-ach-rarity">{RARITY_LABEL[a.rarity]}</span>
                    </div>
                    <p>{a.description}</p>
                    {a.unlocked ? (
                      <span className="pg-ach-date"><PageIcon name="check" size={14} strokeWidth={2.4} /> {a.unlockedAt ? `Desbloqueada em ${new Date(a.unlockedAt).toLocaleDateString('pt-BR')}` : 'Desbloqueada'}</span>
                    ) : (
                      <div className="pg-ach-progress">
                        <span className="pg-mini-bar"><span style={{ width: `${pct}%` }} /></span>
                        <span>{fmt(a.progress)}/{fmt(a.target)}</span>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---------- Recompensas (trilha por nível) ---------- */
function Rewards({ level, rank }) {
  const sorted = [...LEVEL_REWARDS].sort((a, b) => a.level - b.level);
  const nextReward = sorted.find((r) => level < r.level);
  return (
    <div className="pg-rewards">
      {nextReward && (
        <div className="pg-next-reward">
          <span className="pg-next-icon"><PageIcon name="gift" size={22} /></span>
          <div>
            <span className="pg-hero-eyebrow">Próxima recompensa</span>
            <strong>{nextReward.title}</strong>
            <p>Faltam {nextReward.level - level} {nextReward.level - level === 1 ? 'nível' : 'níveis'} (nível {nextReward.level}){rank && !rank.isMaxLevel ? ` · ${rank.progress}% do nível atual` : ''}.</p>
          </div>
        </div>
      )}
      <ol className="pg-track">
        {sorted.map((r) => {
          const done = level >= r.level;
          return (
            <li key={r.level} className={`pg-track-item${done ? ' done' : ''}${r === nextReward ? ' next' : ''}`}>
              <span className="pg-track-node">{done ? <PageIcon name="check" size={16} strokeWidth={2.4} /> : <PageIcon name="lock" size={14} />}</span>
              <div className="pg-track-card">
                <div className="pg-track-head">
                  <span className="pg-track-emoji" aria-hidden="true">{r.icon}</span>
                  <h3>{r.title}</h3>
                  <span className="pg-chip">Nível {r.level}</span>
                </div>
                <p>{r.description}</p>
                <span className={`pg-track-state${done ? ' ok' : ''}`}>{done ? 'Liberada' : `Libera no nível ${r.level}`}</span>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="pg-note">Novas recompensas são adicionadas conforme a comunidade cresce.</p>
    </div>
  );
}

function Loading() {
  return <div className="pg-loading" aria-busy="true"><span /><span /><span /></div>;
}

function Empty({ icon, title, text }) {
  return (
    <div className="pg-empty">
      <span className="pg-empty-icon"><PageIcon name={icon} size={28} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
