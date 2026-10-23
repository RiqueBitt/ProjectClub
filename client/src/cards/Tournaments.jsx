import { useEffect, useState } from 'react';
import UserAvatar from '../components/UserAvatar.jsx';
import { CardView, Icon, UI } from './CardView.jsx';
import { cardsTournaments, cardsJoinTournament, cardsLeaveTournament, errMsg } from './api';

// Torneios criados pela staff: inscrição, chaveamento ao vivo e prêmio.
const STATUS = { OPEN: 'Inscrições abertas', RUNNING: 'Em andamento', FINISHED: 'Encerrado', CANCELLED: 'Cancelado' };

export function Bracket({ rounds, onWatch }) {
  if (!rounds?.length) return null;
  return (
    <div className="tcg-bracket">
      {rounds.map((round, ri) => (
        <div key={ri} className="tcg-bracket-col">
          <h5>{ri === rounds.length - 1 && round.length === 1 ? 'Final' : `Rodada ${ri + 1}`}</h5>
          {round.map((p, i) => (
            <div key={i} className="tcg-bracket-pair">
              {[['p1', 'p1u'], ['p2', 'p2u']].map(([k, ku]) => (
                <span key={k} className={`tcg-bracket-p${p.winner && p.winner === p[k] ? ' is-win' : ''}${p.winner && p[k] && p.winner !== p[k] ? ' is-out' : ''}`}>
                  {p[ku] ? <><UserAvatar user={p[ku]} size={18} /><span data-no-translate>{p[ku].displayName}</span></> : <em>{k === 'p2' && !p.p2 ? 'passa direto' : '—'}</em>}
                </span>
              ))}
              {p.matchId && !p.winner && onWatch && <button type="button" className="tcg-link" onClick={() => onWatch(p.matchId)}>assistir</button>}
              {p.walkover && <small className="tcg-dim">W.O.</small>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Tournaments({ me, onWatch, onReload }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const load = () => cardsTournaments().then((d) => setList(d.tournaments)).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  const act = async (fn) => { setErr(''); try { await fn(); load(); onReload?.(); } catch (e) { setErr(errMsg(e)); } };
  return (
    <div className="tcg-tournaments">
      <div className="tcg-section-head"><p>Torneios eliminatórios organizados pela equipe. Quando começar, cada partida é um duelo PvP normal — fique atento aos avisos!</p></div>
      {err && <p className="tcg-error">{err}</p>}
      {list === null && <p className="tcg-empty">Carregando…</p>}
      {list?.length === 0 && <p className="tcg-empty">Nenhum torneio no momento. A equipe avisa em Anúncios quando abrir um.</p>}
      {list?.map((t) => (
        <article key={t.id} className={`tcg-tourn is-${t.status.toLowerCase()}`}>
          <header>
            <span className="tcg-tourn-icon"><Icon d={UI.trophy} size={26} /></span>
            <div className="tcg-tourn-title">
              <h3 data-no-translate>{t.name}</h3>
              <small>{STATUS[t.status]} · {t.players.length}/{t.maxPlayers} jogadores{t.startsAt ? ` · início ${new Date(t.startsAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</small>
            </div>
            {t.status === 'OPEN' && (t.joined
              ? <button type="button" className="tcg-btn ghost" onClick={() => act(() => cardsLeaveTournament(t.id))}>Sair</button>
              : <button type="button" className="tcg-btn primary" disabled={t.players.length >= t.maxPlayers} onClick={() => act(() => cardsJoinTournament(t.id))}>Inscrever-se</button>)}
          </header>
          {t.description && <p className="tcg-tourn-desc">{t.description}</p>}
          <div className="tcg-tourn-prize">
            <span>Prêmio:</span>
            {t.prizeCoins > 0 && <b><Icon d={UI.coin} size={14} />{t.prizeCoins}</b>}
            {t.prizeGems > 0 && <b className="is-gem"><Icon d={UI.gem} size={14} />{t.prizeGems}</b>}
            {t.prizeCard && <CardView card={{ ...t.prizeCard, foil: true }} size="xs" />}
          </div>
          {t.winner && <p className="tcg-ok">Campeão: <b data-no-translate>{t.winner.displayName}</b>{t.winner.id === me.id ? ' — é você!' : ''}</p>}
          {t.status === 'OPEN' && t.players.length > 0 && (
            <div className="tcg-tourn-players">{t.players.map((u) => <span key={u.id} title={u.displayName}><UserAvatar user={u} size={26} /></span>)}</div>
          )}
          <Bracket rounds={t.rounds} onWatch={t.status === 'RUNNING' ? onWatch : null} />
        </article>
      ))}
    </div>
  );
}
