import { useEffect, useState } from 'react';
import { getReputation, getReputationRanking } from '../../api/community';
import { useAuth } from '../../context/AuthContext.jsx';
import { useStore } from '../../store/useStore';
import { EmptyState, Ico, Skeleton } from '../PagesKit.jsx';
import UserAvatar from '../UserAvatar.jsx';
import { SectionCard, fmt } from './CommunityBits.jsx';

// Reputação: agradecimentos recebidos + ranking de quem mais ajuda.
export default function ReputationTab() {
  const { user } = useAuth();
  const [mine, setMine] = useState(null);
  const [period, setPeriod] = useState('30d');
  const [ranking, setRanking] = useState(null);
  useEffect(() => { if (user?.id) getReputation(user.id).then(setMine).catch(() => setMine(null)); }, [user?.id]);
  useEffect(() => { setRanking(null); getReputationRanking(period).then((d) => setRanking(d.ranking)).catch(() => setRanking([])); }, [period]);

  return (
    <>
      <SectionCard icon="heart" title="Sua reputação">
        <div className="c4-stats">
          <div><strong>{fmt(mine?.total)}</strong><small>agradecimentos no total</small></div>
          <div><strong>{fmt(mine?.last30Days)}</strong><small>nos últimos 30 dias</small></div>
        </div>
        <p className="pk-muted">Toque com o botão direito numa mensagem (ou segure no celular) e escolha <strong>Agradecer</strong>. Nos posts do Fórum o botão fica embaixo do post. Dá pra agradecer cada pessoa uma vez por dia.</p>
      </SectionCard>
      <SectionCard
        icon="trophy" title="Quem mais ajuda"
        aside={(
          <div className="pk-filters" role="group" aria-label="Período">
            {[['30d', '30 dias'], ['all', 'Sempre']].map(([id, label]) => (
              <button key={id} type="button" className={`pk-filter ${period === id ? 'active' : ''}`} aria-pressed={period === id} onClick={() => setPeriod(id)}>{label}</button>
            ))}
          </div>
        )}
      >
        {ranking === null && <Skeleton rows={4} height={48} />}
        {ranking?.length === 0 && <EmptyState compact icon="heart" title="Ninguém no ranking ainda" text="Comece agradecendo quem te ajudou." />}
        <ol className="c4-list c4-rank">
          {(ranking || []).map((r) => (
            <li key={r.user.id} className={`c4-list-row ${r.user.id === user?.id ? 'is-me' : ''}`}>
              <span className={`c4-rank-pos pos-${r.rank}`}>{r.rank}</span>
              <button type="button" className="c4-plain" onClick={() => useStore.getState().openProfile(r.user.id)}>
                <UserAvatar user={r.user} size={32} />
              </button>
              <div className="c4-list-main"><strong>{r.user.displayName}</strong></div>
              <span className="pk-chip brand"><Ico name="heart" size={13} /> {fmt(r.thanks)}</span>
            </li>
          ))}
        </ol>
      </SectionCard>
    </>
  );
}
