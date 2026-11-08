import { useEffect, useState } from 'react';
import { votePostPoll } from '../api/social';
import '../styles/socialx.css';

// Enquete de um post do Feed (mesmo formato das enquetes do perfil:
// opções com %, um voto por pessoa, dá pra trocar). Antes de votar mostra
// só as opções; depois mostra as barras com a porcentagem.
export default function FeedPoll({ postId, poll, onChange, compact = false }) {
  const [local, setLocal] = useState(poll);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setLocal(poll); }, [poll]);
  if (!local) return null;

  const voted = !!local.myVoteOptionId;
  const vote = async (e, opt) => {
    e.stopPropagation();
    if (busy || local.myVoteOptionId === opt.id) return;
    // Otimista: move o voto na hora.
    const prevId = local.myVoteOptionId;
    const total = local.totalVotes + (prevId ? 0 : 1);
    const options = local.options.map((o) => {
      const votes = o.votes + (o.id === opt.id ? 1 : 0) - (o.id === prevId ? 1 : 0);
      return { ...o, votes, percent: total ? Math.round((votes / total) * 100) : 0 };
    });
    const optimistic = { ...local, myVoteOptionId: opt.id, totalVotes: total, options };
    setLocal(optimistic);
    setBusy(true);
    try {
      const { poll: fresh } = await votePostPoll(postId, opt.id);
      setLocal(fresh);
      onChange?.(fresh);
    } catch { setLocal(poll); }
    setBusy(false);
  };

  return (
    <div className={`sx-poll${voted ? ' is-voted' : ''}${compact ? ' is-compact' : ''}`} onClick={(e) => e.stopPropagation()}>
      <span className="sx-poll-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7" /></svg>
        Enquete
      </span>
      <div className="sx-poll-options">
        {local.options.map((opt) => {
          const mine = local.myVoteOptionId === opt.id;
          return (
            <button key={opt.id} type="button" className={`sx-poll-opt${mine ? ' is-mine' : ''}`} onClick={(e) => vote(e, opt)} disabled={busy} aria-pressed={mine}>
              {voted && <span className="sx-poll-bar" style={{ width: `${opt.percent}%` }} />}
              <span className="sx-poll-radio" aria-hidden="true" />
              <span className="sx-poll-label">{opt.text}</span>
              {voted && <span className="sx-poll-pct">{opt.percent}%</span>}
            </button>
          );
        })}
      </div>
      <span className="sx-poll-foot">
        {local.totalVotes} {local.totalVotes === 1 ? 'voto' : 'votos'}
        {voted ? ' · clique em outra opção pra trocar' : ' · escolha uma opção pra ver o resultado'}
      </span>
    </div>
  );
}
