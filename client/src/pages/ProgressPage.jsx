import { useEffect, useMemo, useState } from 'react';
import AchievementIcon from '../components/AchievementIcon.jsx';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { getRank, listLeaderboard, listAchievements } from '../api/endpoints';
import UserAvatar from '../components/UserAvatar.jsx';
import PageIcon from '../components/PageIcons.jsx';
import { LEVEL_REWARDS } from '../utils/levelRewards';
import { RARITY_LABEL, RARITY_COLOR } from '../utils/achievementRarity';
import { categoryFor, CATEGORY_ORDER } from '../utils/achievementCategory';
import '../styles/progress.css';
import { useLiveRefresh } from '../utils/liveRefresh';

// Progresso: um cabeçalho fixo com o seu nível (sempre visível) e três
// abas — Ranking, Conquistas e Recompensas. A aba atual fica na URL
// (?tab=), então dá pra mandar o link direto pra uma delas.
const TABS = [
  { key: 'ranking', label: 'Ranking', icon: 'trophy' },
  { key: 'conquistas', label: 'Conquistas', icon: 'medal' },
  { key: 'recompensas', label: 'Recompensas', icon: 'gift' },
];

const fmt = (n) => (n ?? 0).toLocaleString('pt-BR');

// Tela estreita (celular): os avatares do pódio ficam menores.
function useNarrow(query = '(max-width: 600px)') {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

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

  // Tempo real (11s): rank e ranking; conquistas já chegam por socket,
  // então só uma ressincronização leve (33s).
  useLiveRefresh(async ({ put }) => {
    await Promise.allSettled([
      getRank().then(put(setRank)),
      listLeaderboard().then((d) => put(setLeaderboard)(d.leaderboard)),
    ]);
  });
  useLiveRefresh(({ put }) => listAchievements().then((d) => put(setAchievements)(d.achievements)), { interval: 33000 });

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
            <PageIcon name={t.icon} size={16} />
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

/* ---------- Peças ---------- */
// Medalhão de metal em 3D (render em public/progresso/medalhao.webp, cinza):
// a cor vem de --tint e o que vai dentro (ícone, número) fica no miolo.
function Medal({ tint, size = 52, className = '', children, ...rest }) {
  return (
    <span className={`pg-medal ${className}`.trim()} style={{ '--tint': tint, '--medal-size': `${size}px` }} {...rest}>
      {children}
    </span>
  );
}

// Anel em volta do avatar: quanto do nível atual já foi.
function LevelRing({ pct, size, children }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="pg-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="pg-ring-track" cx={size / 2} cy={size / 2} r={r} />
        <circle className="pg-ring-fill" cx={size / 2} cy={size / 2} r={r} strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, Math.max(0, pct)) / 100)} />
      </svg>
      {children}
    </div>
  );
}

/* ---------- Cabeçalho com o seu nível ---------- */
// Uma faixa só: quem é você, os três números e a barra até o próximo nível.
function ProgressHero({ user, rank, level, unlocked, totalAchievements }) {
  const pct = rank?.isMaxLevel ? 100 : (rank?.progress ?? 0);
  const left = rank && !rank.isMaxLevel ? Math.max(0, rank.xpNeeded - rank.xpInLevel) : 0;
  return (
    <section className="pg-hero">
      <div className="pg-id">
        <div className="pg-id-avatar">
          <LevelRing pct={pct} size={80}><UserAvatar user={user} size={64} /></LevelRing>
          <Medal tint="var(--brand)" size={32} className="pg-id-level" aria-label={`Nível ${level}`}><b>{level}</b></Medal>
        </div>
        <div className="pg-id-text">
          <h1 className="truncate">{user?.displayName}</h1>
          <p className="pg-id-sub truncate">{[rank?.levelTitle, `Nível ${level}`].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      <dl className="pg-stats">
        <div><dt><PageIcon name="trophy" size={14} /> Posição</dt><dd>{rank?.position ? `#${fmt(rank.position)}` : '—'}</dd></div>
        <div><dt><PageIcon name="bolt" size={14} /> XP total</dt><dd>{rank ? fmt(rank.xp) : '—'}</dd></div>
        <div><dt><PageIcon name="medal" size={14} /> Conquistas</dt><dd>{totalAchievements != null ? `${unlocked}/${totalAchievements}` : '—'}</dd></div>
      </dl>

      <div className="pg-xp">
        {rank && !rank.isMaxLevel && (
          <div className="pg-xp-ends" aria-hidden="true"><span>Nível {level}</span><span>Nível {rank.nextLevel}</span></div>
        )}
        <div className="pg-bar big" role="progressbar" aria-label="Progresso até o próximo nível" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="pg-xp-row">
          {!rank && <span>Carregando…</span>}
          {rank && rank.isMaxLevel && <strong>Nível máximo</strong>}
          {rank && !rank.isMaxLevel && (
            <>
              <span>Faltam <strong>{fmt(left)} XP</strong> para o nível {rank.nextLevel}</span>
              <span className="pg-xp-num">{fmt(rank.xpInLevel)} / {fmt(rank.xpNeeded)} XP</span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------- Ranking ---------- */
const PLACE_LABEL = { 1: '1º lugar', 2: '2º lugar', 3: '3º lugar' };

function Ranking({ leaderboard, me, rank }) {
  const narrow = useNarrow();
  if (leaderboard === null) return <Loading />;
  if (leaderboard.length === 0) return <Empty icon="trophy" title="Ninguém no ranking ainda" text="Converse e participe da comunidade para aparecer aqui." />;

  const top = leaderboard.filter((u) => !u.outsideTop50);
  const podium = top.slice(0, 3);
  const rest = top.slice(3);
  const meOutside = leaderboard.find((u) => u.outsideTop50);
  const topXp = Math.max(1, podium[0]?.accountXp || 1);
  // No código (e pra quem usa leitor de tela) a ordem é 1º, 2º, 3º; quem põe
  // cada um em cima do seu bloco é o CSS (.place-1/2/3).
  return (
    <div className="pg-ranking">
      {/* Pódio em 3D: os blocos são um render (tools/progresso-3d) e os
          avatares ficam em pé em cima de cada um. */}
      <ol className="pg-podium" aria-label="Pódio">
        <li className="pg-podium-art" aria-hidden="true" />
        {podium.map((u, i) => {
          const place = i + 1;
          const size = narrow ? (place === 1 ? 54 : 44) : (place === 1 ? 76 : 60);
          return (
            <li key={u.id} className={`pg-podium-spot place-${place}${u.id === me?.id ? ' is-me' : ''}`}>
              <strong className="truncate"><span className="pg-sr">{PLACE_LABEL[place]}: </span>{u.displayName}</strong>
              <span className="pg-podium-meta"><span className="pg-podium-lvl">Nv. {u.accountLevel} · </span>{fmt(u.accountXp)} XP</span>
              <div className="pg-podium-avatar"><UserAvatar user={u} size={size} /></div>
            </li>
          );
        })}
      </ol>

      {rest.length > 0 && (
        <ol className="pg-list" start={4}>
          {rest.map((u, i) => <RankRow key={u.id} u={u} pos={i + 4} isMe={u.id === me?.id} topXp={topXp} />)}
        </ol>
      )}
      {meOutside && (
        <>
          <div className="pg-list-gap" aria-hidden="true">···</div>
          <ol className="pg-list"><RankRow u={meOutside} pos={rank?.position} isMe topXp={topXp} /></ol>
        </>
      )}
    </div>
  );
}

// A faixa clarinha atrás de cada linha mostra o XP da pessoa perto do 1º lugar.
function RankRow({ u, pos, isMe, topXp }) {
  const share = Math.min(100, Math.max(0, ((u.accountXp || 0) / (topXp || 1)) * 100));
  return (
    <li className={`pg-row${isMe ? ' is-me' : ''}`} style={{ '--share': `${share.toFixed(1)}%` }}>
      <span className="pg-row-pos">{pos ?? '—'}</span>
      <UserAvatar user={u} size={34} />
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
      // Secretas ficam juntas (mesmo depois de desbloqueadas).
      (by[categoryFor(a.hidden ? 'SECRET' : a.progressType)] ||= []).push(a);
    }
    // Dentro de cada categoria: as mais perto de completar primeiro, desbloqueadas no fim.
    const score = (a) => (a.unlocked ? 2 : 1 - (a.progress || 0) / (a.target || 1));
    return CATEGORY_ORDER.filter((c) => by[c]?.length).map((c) => [c, by[c].sort((x, y) => score(x) - score(y))]);
  }, [achievements, status, rarity]);

  if (achievements === null) return <Loading />;
  if (achievements.length === 0) return <Empty icon="medal" title="Nenhuma conquista cadastrada" text="Assim que a equipe criar conquistas, elas aparecem aqui." />;

  const byRarity = Object.fromEntries(RARITIES.map((r) => [r, achievements.filter((a) => a.rarity === r)]));

  const doneAll = achievements.filter((a) => a.unlocked).length;
  const pctAll = Math.round((doneAll / achievements.length) * 100);

  return (
    <div className="pg-ach">
      <div className="pg-ach-summary">
        <Medal tint="var(--pg-gold)" size={54}><PageIcon name="medal" size={24} /></Medal>
        <div className="pg-ach-summary-text">
          <strong>{doneAll} de {achievements.length} conquistas</strong>
          <span className="pg-bar" role="progressbar" aria-label="Conquistas desbloqueadas" aria-valuenow={pctAll} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pctAll}%` }} /></span>
        </div>
        <span className="pg-ach-summary-pct">{pctAll}%</span>
      </div>

      <div className="pg-filters">
        <div className="pg-seg" role="group" aria-label="Mostrar">
          {STATUS_FILTERS.map((f) => (
            <button key={f.key} type="button" className={`pg-filter${status === f.key ? ' active' : ''}`} aria-pressed={status === f.key} onClick={() => setStatus(f.key)}>{f.label}</button>
          ))}
        </div>
        <div className="pg-rarities" role="group" aria-label="Raridade">
          {RARITIES.map((r) => {
            const list = byRarity[r];
            if (!list.length) return null;
            const done = list.filter((a) => a.unlocked).length;
            return (
              <button
                key={r} type="button" className={`pg-rarity${rarity === r ? ' active' : ''}`}
                style={{ '--rarity': RARITY_COLOR[r] }} onClick={() => setRarity(rarity === r ? 'ALL' : r)}
                aria-pressed={rarity === r} title={rarity === r ? 'Mostrar todas as raridades' : `Só ${RARITY_LABEL[r]}`}
              >
                <span className="pg-rarity-dot" aria-hidden="true" />
                <span className="pg-rarity-name">{RARITY_LABEL[r]}</span>
                <span className="pg-rarity-count">{done}/{list.length}</span>
              </button>
            );
          })}
        </div>
      </div>

      {grouped.length === 0 && <Empty icon="search" title="Nada com esses filtros" text="Tente outra combinação de filtros." />}

      {grouped.map(([category, items]) => (
        <section key={category} className="pg-ach-group">
          <h2>{category}<span>{items.filter((a) => a.unlocked).length}/{items.length}</span></h2>
          <div className="pg-ach-grid">
            {items.map((a) => {
              const pct = a.unlocked ? 100 : Math.min(100, Math.floor(((a.progress || 0) / (a.target || 1)) * 100));
              return (
                <article key={a.id} className={`pg-ach-card${a.unlocked ? ' done' : ''}${a.hidden && !a.unlocked ? ' secret' : ''}`} style={{ '--rarity': RARITY_COLOR[a.rarity] }}>
                  <div className="pg-ach-icon">
                    <Medal tint={a.unlocked ? 'var(--rarity)' : 'var(--pg-locked)'} size={54}>
                      {a.hidden && !a.unlocked
                        ? <span className="pg-ach-secret" aria-label="Conquista secreta">?</span>
                        : <AchievementIcon achievement={a} size={28} tile={false} locked={!a.unlocked} />}
                    </Medal>
                    {!a.unlocked && <span className="pg-ach-lock"><PageIcon name="lock" size={11} strokeWidth={2.4} /></span>}
                  </div>
                  <div className="pg-ach-body">
                    <div className="pg-ach-top">
                      <h3>{a.name}</h3>
                      <span className="pg-ach-rarity"><span className="pg-rarity-dot" aria-hidden="true" />{RARITY_LABEL[a.rarity]}</span>
                    </div>
                    <p>{a.description}</p>
                    {a.hidden && !a.unlocked ? (
                      <span className="pg-ach-date muted">Secreta: descubra como desbloquear</span>
                    ) : a.unlocked ? (
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
// Em cima, o caminho até a próxima recompensa (do nível da anterior até o
// dela); embaixo, a trilha com todas.
function Rewards({ level, rank }) {
  const sorted = [...LEVEL_REWARDS].sort((a, b) => a.level - b.level);
  const nextReward = sorted.find((r) => level < r.level);
  // Quanto falta pra próxima: do nível da recompensa anterior (ou do 1) até o dela.
  const prevLevel = [...sorted].reverse().find((r) => level >= r.level)?.level ?? 1;
  const span = nextReward ? Math.max(1, nextReward.level - prevLevel) : 1;
  const walked = nextReward ? Math.min(span, (level - prevLevel) + ((rank && !rank.isMaxLevel ? rank.progress : 0) / 100)) : span;
  const pctNext = Math.round((walked / span) * 100);
  return (
    <div className="pg-rewards">
      {nextReward && (
        <div className="pg-next">
          <Medal tint="var(--brand)" size={54}><PageIcon name="gift" size={24} /></Medal>
          <div className="pg-next-text">
            <span className="pg-next-label">Próxima recompensa</span>
            <strong>{nextReward.title}</strong>
            <span className="pg-bar" role="progressbar" aria-label="Caminho até a próxima recompensa" aria-valuenow={pctNext} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pctNext}%` }} /></span>
            <span className="pg-next-ends"><span>Você está no nível {level}</span><span>Nível {nextReward.level}</span></span>
          </div>
        </div>
      )}
      <ol className="pg-track">
        {sorted.map((r) => {
          const done = level >= r.level;
          const isNext = r === nextReward;
          const missing = r.level - level;
          return (
            <li key={r.level} className={`pg-track-item${done ? ' done' : ''}${isNext ? ' next' : ''}`}>
              <Medal tint={done ? 'var(--green)' : isNext ? 'var(--brand)' : 'var(--pg-locked)'} size={38} className="pg-track-node">
                {done ? <PageIcon name="check" size={17} strokeWidth={2.6} /> : <PageIcon name="lock" size={15} strokeWidth={2.2} />}
              </Medal>
              <div className="pg-track-card">
                <div className="pg-track-head">
                  <span className="pg-track-emoji" aria-hidden="true">{r.icon}</span>
                  <h3>{r.title}</h3>
                  <span className="pg-track-level">Nível {r.level}</span>
                </div>
                <p>{r.description}</p>
                <span className={`pg-track-state${done ? ' ok' : ''}`}>
                  {done && 'Liberada'}
                  {!done && isNext && (missing === 1 ? 'Falta 1 nível' : `Faltam ${missing} níveis`)}
                  {!done && !isNext && `Libera no nível ${r.level}`}
                </span>
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
