import { useEffect, useMemo, useState } from 'react';
import { CardView, Icon, UI, ELEMENTS, RARITIES } from './CardView.jsx';
import {
  cardsDraft, cardsDraftStart, cardsDraftPick, cardsDraftPlay, cardsDraftRetire,
  cardsBoss, cardsBossStart, cardsBossClaim, cardsLeague, errMsg,
} from './api';
import { sfx } from './sfx';
import UserAvatar from '../components/UserAvatar.jsx';

// Aba "Desafios": Draft (Arena), chefão semanal da comunidade e liga de clãs.

const fmtLeft = (end) => {
  const ms = Math.max(0, new Date(end).getTime() - Date.now());
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((ms % 3600000) / 60000)}min`;
};
const n = (v) => Number(v || 0).toLocaleString('pt-BR');

// ------------------------------------------------------------------ Draft
function DraftDeck({ picks }) {
  const groups = useMemo(() => {
    const m = new Map();
    for (const c of picks) {
      const g = m.get(c.id) || { card: c, qty: 0 };
      g.qty += 1; m.set(c.id, g);
    }
    return [...m.values()].sort((a, b) => a.card.cost - b.card.cost || a.card.name.localeCompare(b.card.name));
  }, [picks]);
  const curve = useMemo(() => {
    const arr = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const c of picks) arr[Math.min(7, c.cost | 0)] += 1;
    return arr;
  }, [picks]);
  const max = Math.max(1, ...curve);
  return (
    <aside className="tcgd-deck">
      <div className="tcgd-curve" aria-label="Curva de custo">
        {curve.map((v, i) => <span key={i}><i style={{ height: `${(v / max) * 100}%` }} /><small>{i === 7 ? '7+' : i}</small></span>)}
      </div>
      <ul>
        {groups.map(({ card, qty }) => (
          <li key={card.id} style={{ '--elc': ELEMENTS[card.element]?.color, '--rar': RARITIES[card.rarity]?.color }}>
            <b className="tcgd-cost">{card.cost}</b>
            <span>{card.name}</span>
            {qty > 1 && <em>×{qty}</em>}
          </li>
        ))}
        {!groups.length && <li className="tcg-dim">Suas escolhas aparecem aqui.</li>}
      </ul>
    </aside>
  );
}

function DraftPanel({ wallet, onStartMatch, onWallet }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const load = () => cardsDraft().then(setData).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, []);
  const run = async (fn, after) => {
    if (busy) return;
    setBusy(true); setErr('');
    try { const r = await fn(); after?.(r); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  if (!data) return <section className="tcgd"><p className="tcg-empty">{err || 'Carregando o Draft…'}</p></section>;
  const d = data.draft;
  const rewards = data.rewards || [];

  const header = (
    <header className="tcgd-head">
      <span className="tcgd-badge"><Icon d={UI.wand} size={22} /></span>
      <div>
        <h3>Draft da Arena</h3>
        <p className="tcg-dim">Monte um baralho escolhendo 1 entre 3 cartas e vá o mais longe que conseguir: até {d?.maxWins || 7} vitórias ou {d?.maxLosses || 3} derrotas. Cartas novas pra todo mundo — vale a estratégia, não a coleção.</p>
      </div>
    </header>
  );

  if (!d) {
    return (
      <section className="tcgd">
        {header}
        <div className="tcgd-rewards">
          {rewards.map((c, i) => <span key={i} className={i === rewards.length - 1 ? 'is-max' : ''}><small>{i} vit.</small><b><Icon d={UI.coin} size={13} />{n(c)}</b></span>)}
        </div>
        {err && <p className="tcg-error">{err}</p>}
        <div className="tcgd-start">
          <button type="button" className="tcg-btn primary" disabled={busy || (wallet?.coins ?? 0) < data.fee} onClick={() => run(cardsDraftStart, (r) => { sfx('pack'); setData((x) => ({ ...x, draft: r.draft, last: null })); onWallet?.(); })}>
            <Icon d={UI.coin} size={15} />Entrar por {n(data.fee)} moedas
          </button>
          <span className="tcg-dim">Melhor campanha: <b>{data.best}</b> vitória(s) · {data.runs} corrida(s)</span>
        </div>
        {data.last && <p className="tcgd-last">Última corrida: <b>{data.last.wins}V</b> · {data.last.losses}D — ganhou <b>{n(data.last.reward)}</b> moedas.</p>}
      </section>
    );
  }

  if (d.status === 'PICKING') {
    return (
      <section className="tcgd is-picking">
        {header}
        <div className="tcgd-progress"><span>Escolha <b>{d.picks.length + 1}</b> de {d.size}</span><i><em style={{ width: `${(d.picks.length / d.size) * 100}%` }} /></i></div>
        {err && <p className="tcg-error">{err}</p>}
        <div className="tcgd-body">
          <div className="tcgd-options">
            {d.options.map((c, i) => (
              <button key={`${d.picks.length}-${i}`} type="button" className="tcgd-opt" disabled={busy} style={{ animationDelay: `${i * 70}ms` }}
                onClick={() => run(() => cardsDraftPick(i), (r) => { sfx(r.draft.status === 'PLAYING' ? 'epic' : 'draw'); setData((x) => ({ ...x, draft: r.draft })); })}>
                <CardView card={c} tilt />
              </button>
            ))}
          </div>
          <DraftDeck picks={d.picks} />
        </div>
      </section>
    );
  }

  // PLAYING
  return (
    <section className="tcgd is-playing">
      {header}
      <div className="tcgd-score">
        <div className="tcgd-wins" aria-label={`${d.wins} vitórias`}>
          {Array.from({ length: d.maxWins }, (_, i) => <span key={i} className={i < d.wins ? 'on' : ''}><Icon d={UI.trophy} size={16} /></span>)}
        </div>
        <div className="tcgd-losses" aria-label={`${d.losses} derrotas`}>
          {Array.from({ length: d.maxLosses }, (_, i) => <span key={i} className={i < d.losses ? 'on' : ''}><Icon d={UI.close} size={14} /></span>)}
        </div>
        <span className="tcgd-now">Prêmio atual: <b><Icon d={UI.coin} size={14} />{n(rewards[Math.min(d.wins, rewards.length - 1)])}</b>{d.wins < d.maxWins && <> · próxima vitória: <b>{n(rewards[Math.min(d.wins + 1, rewards.length - 1)])}</b></>}</span>
      </div>
      {err && <p className="tcg-error">{err}</p>}
      <div className="tcgd-body">
        <div className="tcgd-actions">
          <button type="button" className="tcg-btn primary tcgd-play" disabled={busy} onClick={() => run(cardsDraftPlay, (m) => onStartMatch(m))}>
            <Icon d={UI.sword} size={18} />Jogar partida {d.wins + d.losses + 1}
          </button>
          <p className="tcg-dim">Os adversários ficam mais fortes a cada vitória. Sair de uma partida no meio conta como derrota.</p>
          {!confirmRetire
            ? <button type="button" className="tcg-btn" disabled={busy} onClick={() => setConfirmRetire(true)}>Encerrar e pegar o prêmio</button>
            : (
              <div className="tcgd-confirm">
                <span>Encerrar a corrida com {d.wins} vitória(s)?</span>
                <button type="button" className="tcg-btn primary tcg-btn-sm" onClick={() => run(cardsDraftRetire, (r) => { setConfirmRetire(false); sfx('win'); setData(r); onWallet?.(); })}>Sim, encerrar</button>
                <button type="button" className="tcg-btn tcg-btn-sm" onClick={() => setConfirmRetire(false)}>Continuar</button>
              </div>
            )}
        </div>
        <DraftDeck picks={d.picks} />
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Chefão
function BossCard({ boss, onStart, onClaim, busy, compact = false }) {
  const el = ELEMENTS[boss.element] || ELEMENTS.SOMBRA;
  const left = Math.max(0, boss.hp - boss.damage);
  const pct = boss.hp ? (left / boss.hp) * 100 : 0;
  return (
    <div className={`tcgboss${boss.defeated ? ' is-down' : ''}${compact ? ' is-compact' : ''}`} style={{ '--elc': el.color, '--eld': el.dark }}>
      <div className="tcgboss-art" aria-hidden>
        <span className="tcgboss-aura" />
        <svg viewBox="0 0 24 24" width="96" height="96"><path d={el.glyph} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      <div className="tcgboss-info">
        <small className="tcgboss-kicker">{compact ? 'Chefão da semana passada' : `Chefão da semana · ${el.label}`}</small>
        <h3>{boss.name}</h3>
        <div className="tcgboss-bar"><i style={{ width: `${pct}%` }} /><span>{boss.defeated ? 'DERROTADO!' : `${n(left)} / ${n(boss.hp)}`}</span></div>
        <p className="tcg-dim">
          {n(boss.participants)} jogador(es) atacaram · você causou <b>{n(boss.me.damage)}</b> de dano
          {!boss.defeated && <> · termina em {fmtLeft(boss.endsAt)}</>}
        </p>
        <div className="tcgboss-actions">
          {boss.canClaim && <button type="button" className="tcg-btn primary" disabled={busy} onClick={() => onClaim(boss.id)}><Icon d={UI.trophy} size={15} />Resgatar {n(boss.reward.coins)} moedas + {n(boss.reward.gems)} gemas</button>}
          {!boss.defeated && !compact && (
            <button type="button" className="tcg-btn primary" disabled={busy || boss.me.triesLeft <= 0} onClick={onStart}>
              <Icon d={UI.sword} size={15} />{boss.me.triesLeft > 0 ? `Atacar (${boss.me.triesLeft} tentativa${boss.me.triesLeft > 1 ? 's' : ''} hoje)` : 'Sem tentativas hoje'}
            </button>
          )}
          {boss.me.claimed && <span className="tcgcos-on"><Icon d={UI.check} size={13} />Prêmio resgatado</span>}
        </div>
        {!compact && !boss.defeated && <small className="tcg-dim">O chefe tem {boss.heroHp} de vida por luta. Todo dano que você causa vai para a barra da comunidade. Quando ela zerar, todo mundo que ajudou ganha {n(boss.reward.coins)} moedas e {n(boss.reward.gems)} gemas.</small>}
      </div>
    </div>
  );
}

function BossPanel({ onStartMatch, onWallet }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { cardsBoss().then(setData).catch((e) => setErr(errMsg(e))); }, []);
  const start = async () => { setBusy(true); setErr(''); try { onStartMatch(await cardsBossStart()); } catch (e) { setErr(errMsg(e)); setBusy(false); } };
  const claim = async (id) => {
    setBusy(true); setErr('');
    try { const r = await cardsBossClaim(id); sfx('epic'); setData(r); setOk(`+${n(r.reward.coins)} moedas e +${n(r.reward.gems)} gemas!`); onWallet?.(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  if (!data) return <section className="tcgboss-wrap"><p className="tcg-empty">{err || 'Carregando o chefão…'}</p></section>;
  return (
    <section className="tcgboss-wrap">
      {data.previous && <BossCard boss={data.previous} onClaim={claim} busy={busy} compact />}
      <BossCard boss={data.boss} onStart={start} onClaim={claim} busy={busy} />
      {err && <p className="tcg-error">{err}</p>}
      {ok && <p className="tcg-ok">{ok}</p>}
      {data.boss.top.length > 0 && (
        <div className="tcgboss-top">
          <h4>Quem mais bateu</h4>
          {data.boss.top.map((t) => (
            <div key={t.user.id} className="tcgboss-row">
              <span className="tcg-rank-n">{t.rank}</span>
              <UserAvatar user={t.user} size={26} />
              <span className="tcg-rank-name" data-no-translate>{t.user.displayName}</span>
              <b>{n(t.damage)}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Liga de clãs
function ClanIconBadge({ c, size = 34 }) {
  return (
    <span className="tcgl-icon" style={{ width: size, height: size, '--cc': c.iconColor || '#80848E' }}>
      {c.iconUrl ? <i style={{ WebkitMaskImage: `url(${c.iconUrl})`, maskImage: `url(${c.iconUrl})` }} /> : <b>{(c.name || '?').slice(0, 1).toUpperCase()}</b>}
    </span>
  );
}

function LeaguePanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { cardsLeague().then(setData).catch((e) => setErr(errMsg(e))); }, []);
  if (!data) return <section className="tcgl"><p className="tcg-empty">{err || 'Carregando a liga…'}</p></section>;
  const mineInTable = data.table.some((c) => c.mine);
  return (
    <section className="tcgl">
      <header className="tcgl-head">
        <div>
          <h3>Liga de Clãs <span className="tcg-dim">· semana {data.week.slice(5)}</span></h3>
          <p className="tcg-dim">Cada vitória dos membros soma pontos para o clã: PvP <b>{data.points.PVP}</b> · 2 vs 2 <b>{data.points.DUO}</b> · contra bots <b>{data.points.PVE}</b>. Termina em {fmtLeft(data.endsAt)}. Os 3 primeiros dividem moedas entre quem jogou.</p>
        </div>
        <div className="tcgl-prizes">
          {data.prizes.slice(0, 3).map((p, i) => <span key={i} className={`is-p${i + 1}`}><small>{i + 1}º</small><Icon d={UI.coin} size={13} />{n(p)}</span>)}
        </div>
      </header>
      {data.last?.results?.length > 0 && (
        <p className="tcgl-last"><Icon d={UI.trophy} size={14} />Campeões da semana passada: {data.last.results.map((r, i) => <b key={r.clanId || i}>{i + 1}º {r.name}</b>)}</p>
      )}
      <div className="tcgl-table">
        {data.table.map((c) => (
          <div key={c.clanId} className={`tcgl-row${c.rank <= 3 ? ` is-top${c.rank}` : ''}${c.mine ? ' is-me' : ''}`}>
            <span className="tcg-rank-n">{c.rank}</span>
            <ClanIconBadge c={c} />
            <span className="tcgl-name" data-no-translate>{c.name}{c.mine && <em>seu clã</em>}</span>
            <small className="tcg-dim">{c.players} jogador(es)</small>
            <b>{n(c.points)} pts</b>
          </div>
        ))}
        {data.table.length === 0 && <p className="tcg-empty">Nenhum clã pontuou nesta semana ainda. Seja o primeiro!</p>}
      </div>
      {!data.myClan && <p className="tcg-dim tcgl-note">Você não está em um clã. Entre em um para somar pontos na liga!</p>}
      {data.myClan && !mineInTable && <p className="tcg-dim tcgl-note">Seu clã ainda não pontuou nesta semana — vença partidas para entrar na tabela.</p>}
    </section>
  );
}

export default function ChallengesTab({ wallet, onStartMatch, onWallet }) {
  const [sub, setSub] = useState(() => { try { return sessionStorage.getItem('pc-cards-chal') || 'draft'; } catch { return 'draft'; } });
  const pick = (k) => { setSub(k); try { sessionStorage.setItem('pc-cards-chal', k); } catch { /* ignora */ } };
  const SUBS = [['draft', 'Draft', UI.wand], ['boss', 'Chefão semanal', UI.flag], ['league', 'Liga de clãs', UI.users]];
  return (
    <div className="tcgchal">
      <div className="tcg-chips tcgchal-subs">
        {SUBS.map(([k, label, icon]) => <button key={k} type="button" className={sub === k ? 'on' : ''} onClick={() => pick(k)}><Icon d={icon} size={14} />{label}</button>)}
      </div>
      {sub === 'draft' && <DraftPanel wallet={wallet} onStartMatch={onStartMatch} onWallet={onWallet} />}
      {sub === 'boss' && <BossPanel onStartMatch={onStartMatch} onWallet={onWallet} />}
      {sub === 'league' && <LeaguePanel />}
    </div>
  );
}
