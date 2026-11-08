import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UserAvatar from '../components/UserAvatar.jsx';
import { listMissions, claimMission } from '../api/endpoints';
import { CardView, Icon, UI, RARITY_ORDER } from './CardView.jsx';
import BotPortrait from './BotPortrait.jsx';
import { UserPicker } from './Trades.jsx';
import {
  cardsStartPve, cardsMatch, cardsChallenge, cardsAcceptChallenge, cardsDeclineChallenge, cardsHistory,
  cardsCampaign, cardsStartCampaign, cardsQueue, cardsLeaveQueue, cardsLive, cardsBrawl, cardsStartBrawl, cardsStartTutorial, cardsChest, cardsOpenChest, cardsPass, errMsg,
} from './api';
import { sfx } from './sfx';

// Início da Arena: destaque com sua melhor carta, temporada, partida rápida,
// missões, campanha, bots, amigos jogando agora e histórico.

const BOT_LOOK = {
  FACIL: { name: 'Aprendiz Pip', color: '#4cc76b', desc: 'Bom para aprender. Comete erros e usa cartas simples.' },
  MEDIO: { name: 'Duelista Nora', color: '#3b8bff', desc: 'Joga com calma e faz boas trocas. Usa cartas Raras.' },
  DIFICIL: { name: 'Mestre Kael', color: '#b55cff', desc: 'Pensa uma jogada à frente. Cartas até Lendárias, nível 3.' },
  LENDARIO: { name: 'Arquimaga Vex', color: '#ffb020', desc: 'O maior desafio: cartas Míticas no nível máximo.' },
};

function fmtLeft(ms) {
  if (ms <= 0) return 'agora';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((ms % 3600000) / 60000)}min`;
}

function DivisionBadge({ division, size = 48 }) {
  return (
    <span className="tcg-div" style={{ '--c': division.color, width: size, height: size }} title={division.label}>
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} aria-hidden="true"><path d="M12 2l7 3v6c0 5-3 9-7 11-4-2-7-6-7-11V5z" fill="currentColor" opacity=".25" stroke="currentColor" strokeWidth="1.6" /><path d="M12 7l1.6 3.3 3.6.5-2.6 2.5.6 3.6L12 15.2 8.8 16.9l.6-3.6-2.6-2.5 3.6-.5z" fill="currentColor" /></svg>
    </span>
  );
}

function QuickMatch({ onStart, onClose, onBot }) {
  const [since] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState('');
  const [waiting, setWaiting] = useState(1);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const tick = async () => {
      try {
        const r = await cardsQueue();
        if (!alive.current) return;
        if (r.status === 'MATCHED') { sfx('turn'); onStart(await cardsMatch(r.matchId)); return; }
        setWaiting(r.waiting || 1);
      } catch (e) { if (alive.current) setErr(errMsg(e)); }
    };
    tick();
    const t = setInterval(() => { setNow(Date.now()); tick(); }, 2000);
    return () => { alive.current = false; clearInterval(t); cardsLeaveQueue().catch(() => {}); };
  }, [onStart]);
  const secs = Math.floor((now - since) / 1000);
  return (
    <div className="tcg-modal" role="dialog" aria-label="Procurando partida">
      <div className="tcg-queue">
        <div className="tcg-queue-radar" aria-hidden="true"><i /><i /><i /><Icon d={UI.sword} size={34} /></div>
        <h2>Procurando oponente…</h2>
        <p>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} · {waiting} na fila</p>
        <small className="tcg-dim">Juntamos jogadores com rating parecido. Quanto mais tempo, maior a margem.</small>
        {err && <p className="tcg-error">{err}</p>}
        <div className="tcgp-actions">
          {secs > 40 && <button type="button" className="tcg-btn" onClick={() => { onClose(); onBot(); }}>Jogar contra bot</button>}
          <button type="button" className="tcg-btn ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function StageModal({ stage, onClose, onPlay, busy }) {
  return (
    <div className="tcg-modal" role="dialog" aria-label={stage.name} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tcg-stage-box">
        <BotPortrait name={stage.botName} size={110} />
        <div>
          <em className="tcg-stage-n">Fase {stage.index + 1} · {stage.difficultyLabel}</em>
          <h2>{stage.name}</h2>
          <p className="tcg-stage-story">{stage.story}</p>
          <p className="tcg-dim">Oponente: <b>{stage.botName}</b> · {stage.heroHp} de vida</p>
          <p className="tcg-stage-reward"><Icon d={UI.coin} size={16} />{stage.rewardCoins} moedas{stage.rewardCard ? ` + carta ${stage.rewardCard.name}` : ''} {stage.status === 'DONE' && <span className="tcg-dim">(já recebido)</span>}</p>
          <div className="tcgp-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="tcg-btn primary" disabled={busy} onClick={onPlay}><Icon d={UI.sword} />{stage.status === 'DONE' ? 'Jogar de novo' : 'Lutar'}</button>
            <button type="button" className="tcg-btn ghost" onClick={onClose}>Fechar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function timeLeft(end, now) {
  const ms = Math.max(0, new Date(end).getTime() - now);
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((ms % 3600000) / 60000)}min`;
}

// Draft, Chefão e Liga: só aparecem com o modo ligado no painel da staff.
const CHALLENGE_MODES = [['draft', 'is-draft', UI.wand, 'Draft', 'Escolha 1 de 3 cartas e chegue a 7 vitórias'], ['boss', 'is-boss', UI.flag, 'Chefão semanal', 'A comunidade toda contra um chefe gigante'], ['league', 'is-league', UI.trophy, 'Liga de clãs', 'Suas vitórias somam pontos para o seu clã']];

export default function ArenaHome({ home, me, cards, onStartMatch, onReload, onWatch, onReplay, onOpenRoom }) {
  const navigate = useNavigate();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [history, setHistory] = useState([]);
  const [picking, setPicking] = useState(false);
  const [sent, setSent] = useState('');
  const [queueing, setQueueing] = useState(false);
  const [missions, setMissions] = useState(null);
  const [campaign, setCampaign] = useState(null);
  const [stage, setStage] = useState(null);
  const [live, setLive] = useState([]);
  const [brawl, setBrawl] = useState(null);
  const [chest, setChest] = useState(null);
  const [passInfo, setPassInfo] = useState(null);
  const [chestGot, setChestGot] = useState(null);
  const [now, setNow] = useState(Date.now());

  const loadMissions = () => listMissions().then((d) => setMissions((d.missions || []).filter((m) => m.type.startsWith('CARDS_')))).catch(() => setMissions([]));
  useEffect(() => {
    cardsHistory().then((d) => setHistory(d.matches)).catch(() => {});
    cardsCampaign().then(setCampaign).catch(() => {});
    cardsBrawl().then(setBrawl).catch(() => {});
    cardsChest().then((d) => setChest(d.chest)).catch(() => {});
    if (home.enabled?.pass) cardsPass().then((d) => setPassInfo(d.pass)).catch(() => {});
    const loadLive = () => cardsLive().then((d) => setLive(d.matches)).catch(() => {});
    loadLive();
    loadMissions();
    const t = setInterval(() => setNow(Date.now()), 60000);
    const l = setInterval(loadLive, 20000);
    return () => { clearInterval(t); clearInterval(l); };
  }, []);

  const best = useMemo(() => [...cards].filter((c) => c.quantity > 0).sort((a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity) || b.power - a.power)[0], [cards]);
  const start = async (difficulty) => {
    setBusy(difficulty); setErr('');
    try { onStartMatch(await cardsStartPve(difficulty)); } catch (e) { setErr(errMsg(e)); } finally { setBusy(''); }
  };
  const startStage = async (st) => {
    setBusy(st.id); setErr('');
    try { onStartMatch(await cardsStartCampaign(st.id)); } catch (e) { setErr(errMsg(e)); setStage(null); } finally { setBusy(''); }
  };
  const challenge = async (u) => {
    setErr(''); setSent('');
    try { await cardsChallenge(u.id); setSent(`Desafio enviado para ${u.displayName}. Assim que aceitar, a partida começa.`); setPicking(false); onReload(); } catch (e) { setErr(errMsg(e)); }
  };
  const accept = async (id) => {
    setErr('');
    try { onStartMatch(await cardsAcceptChallenge(id)); } catch (e) { setErr(errMsg(e)); onReload(); }
  };
  const claim = async (m) => {
    try { await claimMission(m.id); sfx('heal'); loadMissions(); onReload(); } catch (e) { setErr(errMsg(e)); }
  };
  const onQueueStart = useCallback((m) => { setQueueing(false); onStartMatch(m); }, [onStartMatch]);

  const p = home.player;
  const season = home.season;
  const span = season.next ? season.next.min - season.division.min : 1;
  const prog = season.next ? Math.max(0, Math.min(1, (season.rating - season.division.min) / span)) : 1;

  return (
    <div className="tcg-play">
      {err && <p className="tcg-error">{err}</p>}
      {sent && <p className="tcg-ok">{sent}</p>}
      {season.lastReward && (
        <div className="tcg-resume is-season">
          <DivisionBadge division={home.meta.divisions.find((d) => d.key === season.lastReward.division) || season.division} size={36} />
          <span>Temporada {season.lastReward.season} encerrada na divisão <b>{season.lastReward.label}</b>! Você recebeu {season.lastReward.coins} moedas{season.lastReward.gems ? ` e ${season.lastReward.gems} gemas` : ''}.</span>
        </div>
      )}

      {/* Destaque */}
      <section className="tcg-spot">
        <div className="tcg-spot-card">
          {best ? <CardView card={best} size="lg" className="tcg-spot-float" /> : <div className="tcg-spot-empty"><Icon d={UI.pack} size={46} /><span>Pegue o pacote inicial para começar</span></div>}
        </div>
        <div className="tcg-spot-main">
          <span className="tcg-spot-hi">Olá, <b data-no-translate>{me.displayName}</b></span>
          <div className="tcg-season">
            <DivisionBadge division={season.division} />
            <div className="tcg-season-info">
              <strong>{season.division.label} <em>{season.rating}</em></strong>
              <span className="tcg-bar"><i style={{ width: `${prog * 100}%`, background: season.division.color }} /></span>
              <small>{season.next ? `${season.next.min - season.rating} para ${season.next.label}` : 'Divisão máxima!'} · Temporada termina em {fmtLeft(new Date(season.endsAt).getTime() - now)}</small>
            </div>
          </div>
          <div className="tcg-spot-stats">
            <span><b>{p.wins + p.pvpWins}</b>vitórias</span>
            <span><b>{season.wins}V/{season.losses}D</b>na temporada</span>
            <span><b>{p.streak}</b>sequência</span>
            <span><b>{home.collection.distinct}</b>cartas</span>
          </div>
          <div className="tcg-spot-actions">
            <button type="button" className="tcg-btn primary tcg-btn-xl" disabled={!home.enabled.pvp} onClick={() => setQueueing(true)}><Icon d={UI.sword} size={20} />Partida rápida</button>
            <button type="button" className="tcg-btn tcg-btn-xl" onClick={() => document.getElementById('tcg-campaign')?.scrollIntoView({ behavior: 'smooth' })}><Icon d={UI.flag} size={18} />Campanha</button>
          </div>
        </div>
      </section>

      <section className="tcg-modes" aria-label="Criar batalha">
        <button type="button" className="tcg-mode is-duel" onClick={() => onOpenRoom?.({ initialFormat: '1V1' })}>
          <span className="tcg-mode-icon"><Icon d={UI.sword} size={26} /></span>
          <b>Criar batalha</b><small>Gere um link e chame alguém pelo chat ou DM</small>
        </button>
        <button type="button" className="tcg-mode is-duo" onClick={() => onOpenRoom?.({ initialFormat: '2V2' })}>
          <span className="tcg-mode-icon"><Icon d={UI.users} size={26} /></span>
          <b>2 vs 2</b><small>Monte uma dupla: herói e campo compartilhados</small>
        </button>
        <button type="button" className="tcg-mode is-custom" onClick={() => onOpenRoom?.({ initialCustom: true })}>
          <span className="tcg-mode-icon"><Icon d={UI.wand} size={26} /></span>
          <b>Personalizada</b><small>Suas regras: vida, energia, baralhos… (sem recompensa)</small>
        </button>
      </section>
      {CHALLENGE_MODES.some(([k]) => home.enabled?.[k]) && <section className="tcg-modes is-challenges" aria-label="Desafios">
        {CHALLENGE_MODES.filter(([k]) => home.enabled?.[k]).map(([k, cls, icon, title, desc]) => (
          <button key={k} type="button" className={`tcg-mode ${cls}`} onClick={() => { try { sessionStorage.setItem('pc-cards-chal', k); } catch { /* ignora */ } navigate('/cartas?aba=desafios'); }}>
            <span className="tcg-mode-icon"><Icon d={icon} size={26} /></span>
            <b>{title}</b><small>{desc}</small>
          </button>
        ))}
      </section>}

      <section className="tcg-daily">
        <div className="tcg-daily-item is-streak" title="A primeira partida de cada dia dá moedas — e o bônus cresce a cada dia seguido.">
          <span className="tcg-daily-icon">🔥</span>
          <span><b>{home.player.streakDays || 0} dia(s) seguidos</b><small>{home.player.lastPlayDay === todayKey() ? 'Sequência garantida hoje' : 'Jogue hoje para ganhar o bônus'}</small></span>
        </div>
        {chest && (
          <div className={`tcg-daily-item is-chest${chest.ready ? ' is-ready' : ''}`}>
            <span className="tcg-daily-icon">{chest.ready ? '🎁' : '📦'}</span>
            <span>
              <b>Baú de vitórias</b>
              <small>{chest.ready ? `${chest.ready} baú(s) prontos!` : chest.earned >= chest.max ? 'Baús de hoje abertos — volte amanhã' : `${chest.wins % chest.every}/${chest.every} vitórias para o próximo`}</small>
              <i className="tcg-daily-bar"><em style={{ width: `${chest.earned >= chest.max ? 100 : ((chest.wins % chest.every) / chest.every) * 100}%` }} /></i>
            </span>
            {chest.ready > 0 && <button type="button" className="tcg-btn primary tcg-btn-sm" onClick={async () => { try { const r = await cardsOpenChest(); sfx('pack'); setChestGot(r.reward); setChest(r.chest); onReload?.(); } catch (e) { setErr(errMsg(e)); } }}>Abrir</button>}
          </div>
        )}
        {passInfo && (
          <div className="tcg-daily-item is-pass">
            <span className="tcg-daily-icon">🏆</span>
            <span>
              <b>Passe · nível {passInfo.level}</b>
              <small>{passInfo.levels.filter((l) => l.unlocked && !l.claimed).length ? `${passInfo.levels.filter((l) => l.unlocked && !l.claimed).length} prêmio(s) para pegar` : `${passInfo.intoLevel}/${passInfo.perLevel} XP`}</small>
              <i className="tcg-daily-bar"><em style={{ width: `${(passInfo.intoLevel / passInfo.perLevel) * 100}%` }} /></i>
            </span>
            <button type="button" className="tcg-btn tcg-btn-sm" onClick={() => navigate('/cartas?aba=passe')}>Ver</button>
          </div>
        )}
      </section>
      {chestGot && (
        <div className="tcg-modal" onClick={() => setChestGot(null)}>
          <div className="tcgpass-got" onClick={(e) => e.stopPropagation()}>
            <h3>Baú aberto!</h3>
            <p>+{chestGot.coins} moedas</p>
            <div className="tcgpass-cards">{chestGot.cards.map((c, i) => <CardView key={i} card={c} size="sm" tilt={false} />)}</div>
            <button type="button" className="tcg-btn primary" onClick={() => setChestGot(null)}>Legal!</button>
          </div>
        </div>
      )}

      <section className="tcg-events">
        {brawl && (
          <div className="tcg-brawl">
            <span className="tcg-brawl-badge"><Icon d={UI.trophy} size={14} />Briga da semana</span>
            <h3>{brawl.brawl.label}</h3>
            <p>{brawl.brawl.desc}</p>
            <div className="tcg-brawl-foot">
              <span className="tcg-dim">{brawl.wonThisWeek ? '✔ Prêmio da semana garantido' : <>1ª vitória: <b className="tcg-gold">+{brawl.reward.coins}</b> moedas e <b className="tcg-gem-t">+{brawl.reward.gems}</b> gemas</>} · termina em {timeLeft(brawl.brawl.endsAt, now)}</span>
              <button type="button" className="tcg-btn primary" disabled={!!busy} onClick={async () => { setBusy('brawl'); setErr(''); try { onStartMatch(await cardsStartBrawl()); } catch (e) { setErr(errMsg(e)); } finally { setBusy(''); } }}><Icon d={UI.sword} />Jogar briga</button>
            </div>
          </div>
        )}
        {!home.player.tutorialDone && (
          <div className="tcg-tutorial">
            <BotPortrait name="Treinador Theo" size={56} />
            <div>
              <h3>Aprenda a jogar</h3>
              <p>Uma partida guiada contra o Treinador Theo: custo, ataque, Guarda, feitiços e poder do herói. {home.extras?.tutorialCoins ? <>Ganhe <b className="tcg-gold">+{home.extras.tutorialCoins}</b> moedas ao concluir.</> : null}</p>
            </div>
            <button type="button" className="tcg-btn primary" disabled={!!busy} onClick={async () => { setBusy('tut'); setErr(''); try { onStartMatch(await cardsStartTutorial()); } catch (e) { setErr(errMsg(e)); } finally { setBusy(''); } }}>Começar</button>
          </div>
        )}
      </section>

      {home.activeMatch && (
        <div className="tcg-resume">
          <span><Icon d={UI.sword} size={18} />Você tem uma partida {home.activeMatch.format === '2V2' ? '2 vs 2' : home.activeMatch.mode === 'PVP' ? 'PvP' : 'contra bot'}{home.activeMatch.custom ? ' personalizada' : ''} em andamento.</span>
          <button type="button" className="tcg-btn primary" onClick={async () => { try { onStartMatch(await cardsMatch(home.activeMatch.id)); } catch (e) { setErr(errMsg(e)); } }}>Continuar</button>
        </div>
      )}
      {home.challenges.filter((c) => c.incoming).map((c) => (
        <div key={c.id} className="tcg-resume is-challenge">
          <UserAvatar user={c.from || {}} size={30} />
          <span><b data-no-translate>{c.from?.displayName}</b> desafiou você para um duelo!</span>
          <button type="button" className="tcg-btn ghost" onClick={() => cardsDeclineChallenge(c.id).then(onReload)}>Recusar</button>
          <button type="button" className="tcg-btn primary" onClick={() => accept(c.id)}>Aceitar</button>
        </div>
      ))}

      {/* Missões */}
      {missions?.length > 0 && (
        <>
          <div className="tcg-h3-row"><h3 className="tcg-h3">Missões da Guerra das Cartas</h3><button type="button" className="tcg-link" onClick={() => navigate('/economia')}>Ver todas as missões</button></div>
          <div className="tcg-missions">
            {missions.map((m) => (
              <div key={m.id} className={`tcg-mission${m.completed ? ' is-done' : ''}${m.claimed ? ' is-claimed' : ''}`}>
                <span className="tcg-mission-period">{m.period === 'WEEKLY' ? 'Semanal' : 'Diária'}</span>
                <strong>{m.title}</strong>
                <small>{m.description}</small>
                <span className="tcg-bar"><i style={{ width: `${(m.progress / m.target) * 100}%` }} /></span>
                <div className="tcg-mission-foot">
                  <span>{m.progress}/{m.target}</span>
                  <span className="tcg-mission-reward"><Icon d={UI.coin} size={13} />{m.rewardCoins}{m.rewardGems ? <> · <Icon d={UI.gem} size={13} />{m.rewardGems}</> : null}</span>
                  {m.completed && !m.claimed && <button type="button" className="tcg-btn primary tcg-btn-sm" onClick={() => claim(m)}>Resgatar</button>}
                  {m.claimed && <span className="tcg-dim">Resgatada</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Campanha */}
      {campaign?.stages?.length > 0 && (
        <>
          <h3 className="tcg-h3" id="tcg-campaign">Campanha <small className="tcg-dim">{Math.min(campaign.progress, campaign.stages.length)}/{campaign.stages.length} fases</small></h3>
          <div className="tcg-map">
            {campaign.stages.map((st, i) => (
              <div key={st.id} className={`tcg-map-node is-${st.status.toLowerCase()}`}>
                {i > 0 && <span className="tcg-map-path" aria-hidden="true" />}
                <button type="button" disabled={st.status === 'LOCKED'} onClick={() => setStage(st)} aria-label={`Fase ${i + 1}: ${st.name}`}>
                  <BotPortrait name={st.botName} size={64} />
                  {st.status === 'DONE' && <span className="tcg-map-check"><Icon d={UI.check} size={14} /></span>}
                  {st.status === 'LOCKED' && <span className="tcg-map-lock" aria-hidden="true"><Icon d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z" size={18} /></span>}
                </button>
                <strong>{st.name}</strong>
                <small>{st.difficultyLabel}</small>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Bots */}
      <h3 className="tcg-h3">Treino contra bots</h3>
      <div className="tcg-bots">
        {home.meta.difficulties.map((d) => {
          const look = BOT_LOOK[d.key] || {};
          return (
            <div key={d.key} className="tcg-bot" style={{ '--c': look.color }}>
              <BotPortrait name={look.name} size={76} />
              <strong>{look.name}</strong>
              <em>{d.label}</em>
              <p>{look.desc}</p>
              <span className="tcg-bot-meta"><Icon d={UI.heart} size={13} fill />{d.heroHp} de vida · <Icon d={UI.coin} size={13} />+{home.rewards[d.key]}</span>
              <button type="button" className="tcg-btn primary" disabled={!!busy || !home.enabled.pve} onClick={() => start(d.key)}>{busy === d.key ? 'Preparando…' : 'Jogar'}</button>
            </div>
          );
        })}
      </div>
      <p className="tcg-dim tcg-note">Partidas com recompensa hoje: {p.rewardsToday}/{home.rewards.dailyRewardedMatches}. Sequência de vitórias dá bônus de moedas.</p>

      {/* PvP */}
      <h3 className="tcg-h3">Desafiar amigos</h3>
      {!home.enabled.pvp ? <p className="tcg-empty">Partidas PvP estão desativadas.</p> : picking ? (
        <div>
          <div className="tcg-section-head"><p>Quem você quer desafiar? O desafio vale por 5 minutos.</p><button type="button" className="tcg-btn ghost" onClick={() => setPicking(false)}>Voltar</button></div>
          <UserPicker meId={me.id} actionLabel="Desafiar" onPick={challenge} />
        </div>
      ) : (
        <div className="tcg-pvp">
          <div>
            <p>Duelo ao vivo com turnos de {home.rules.turnSeconds}s. Vale para a temporada e dá <b>+{home.rewards.pvpWin}</b> moedas por vitória.</p>
            {home.challenges.filter((c) => !c.incoming).map((c) => (
              <p key={c.id} className="tcg-dim">Aguardando <b data-no-translate>{c.to?.displayName}</b> aceitar… <button type="button" className="tcg-link" onClick={() => cardsDeclineChallenge(c.id).then(onReload)}>cancelar</button></p>
            ))}
          </div>
          <button type="button" className="tcg-btn primary" onClick={() => setPicking(true)}><Icon d={UI.users} />Desafiar alguém</button>
        </div>
      )}

      {live.length > 0 && (
        <>
          <h3 className="tcg-h3 tcg-h3-live"><span className="tcg-live-dot" />Partidas ao vivo <small className="tcg-dim">{live.length}</small></h3>
          <div className="tcg-live-grid">
            {live.map((m) => (
              <button key={m.id} type="button" className="tcg-live-card" onClick={() => onWatch(m.id)}>
                <span className="tcg-live-top">
                  <b className="tcgb-live">AO VIVO</b>
                  {m.tournamentId && <span className="tcg-live-tag">Torneio</span>}
                  {m.format === '2V2' && <span className="tcg-live-tag is-duo">2 vs 2</span>}
                  {m.custom && <span className="tcg-live-tag is-custom">Personalizada</span>}
                  {m.friend && <span className="tcg-live-tag is-friend">Amigo</span>}
                  <span className="tcgb-spacer" />
                  <span className="tcg-live-eye" title="Assistindo agora"><Icon d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" size={14} />{m.spectators || 0}</span>
                </span>
                <span className="tcg-live-vs">
                  {(m.format === '2V2' ? [[m.p1, m.p3], [m.p2, m.p4]] : [[m.p1], [m.p2]]).map((team, i) => (
                    <span key={i} className="tcg-live-p">
                      <span className="tcg-live-avs">{team.map((q, k) => (q?.bot ? <BotPortrait key={k} name={q.displayName} size={team.length > 1 ? 34 : 44} /> : <UserAvatar key={k} user={q} size={team.length > 1 ? 34 : 44} />))}</span>
                      <b data-no-translate>{team.map((q) => q?.displayName || '—').join(' & ')}</b>
                      {m.info && <span className="tcg-live-hp"><i style={{ width: `${Math.max(0, Math.min(100, (m.info.hp[i] / (m.format === '2V2' ? 42 : 30)) * 100))}%` }} /><em>{m.info.hp[i]}</em></span>}
                    </span>
                  ))}
                  <span className="tcg-live-x">VS</span>
                </span>
                <span className="tcg-live-foot">{m.info ? `Turno ${m.info.turn} · ${m.info.board[0]} x ${m.info.board[1]} unidades em campo` : 'Começando…'}<span className="tcg-live-go">Assistir <Icon d="M9 6l6 6-6 6" size={14} /></span></span>
              </button>
            ))}
          </div>
        </>
      )}

      <h3 className="tcg-h3">Últimas partidas</h3>
      <div className="tcg-history">
        {history.map((m) => (
          <div key={m.id} className={`tcg-hist${m.won ? ' is-win' : ' is-loss'}`}>
            <span className="tcg-hist-res">{m.won ? 'Vitória' : 'Derrota'}</span>
            <span className="tcg-hist-vs">vs <b data-no-translate>{m.opponent?.displayName}</b>{m.mode === 'PVE' ? ' (bot)' : ''}{m.format === '2V2' && <em className="tcg-hist-tag">2v2</em>}{m.custom && <em className="tcg-hist-tag is-custom">Personalizada</em>}</span>
            <span className="tcg-hist-coins">{m.reward > 0 ? <><Icon d={UI.coin} size={13} />+{m.reward}</> : '—'}</span>
            <button type="button" className="tcg-btn ghost tcg-btn-sm" onClick={() => onReplay(m.id)}>Replay</button>
          </div>
        ))}
        {!history.length && <p className="tcg-empty">Nenhuma partida ainda. Que tal começar pela campanha?</p>}
      </div>

      {queueing && <QuickMatch onStart={onQueueStart} onClose={() => setQueueing(false)} onBot={() => start('MEDIO')} />}
      {stage && <StageModal stage={stage} busy={busy === stage.id} onClose={() => setStage(null)} onPlay={() => startStage(stage)} />}
    </div>
  );
}
