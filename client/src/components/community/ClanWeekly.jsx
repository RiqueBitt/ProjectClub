import { useEffect, useState } from 'react';
import { getClanWeekly } from '../../api/community';
import { useLiveRefresh } from '../../utils/liveRefresh';
import { EmptyState, Ico, Skeleton } from '../PagesKit.jsx';
import ClanIcon from '../ClanIcon.jsx';
import { Countdown, ProgressBar, fmt } from './CommunityBits.jsx';

// Aba "Competição" do Clube: ranking da semana entre Clubes, posição do seu
// Clube, sua contribuição e o campeão da semana passada.
export default function ClanWeekly({ clanId }) {
  const [data, setData] = useState(null);
  const load = () => getClanWeekly().then(setData).catch(() => setData({ error: true }));
  useEffect(() => { load(); }, []);
  useLiveRefresh(() => load(), { interval: 60000 });

  if (!data) return <Skeleton rows={3} height={56} />;
  if (data.error) return <EmptyState compact icon="trophy" title="Não deu pra carregar a competição" text="Tente de novo daqui a pouco." />;
  const { rules } = data;
  return (
    <div className="c4-clanweek">
      <div className="c4-clanweek-head">
        <div>
          <h3><Ico name="trophy" size={18} /> Competição da semana</h3>
          <p className="pk-muted">
            Cada mensagem vale {rules.points.messages} ponto, cada minuto em call {rules.points.voiceMinutes} e cada post no Fórum {rules.points.forumPosts}
            (até {fmt(rules.memberWeeklyCap)} pontos por membro na semana). O Clube campeão leva {fmt(rules.winnerCoinsPerMember)} moedas
            pra cada membro que fez pelo menos {rules.minMemberPoints} pontos.
          </p>
        </div>
        <Countdown to={data.endsAt} prefix="fecha em" />
      </div>
      <div className="c4-stats">
        <div><strong>{data.myClan?.rank ? `${data.myClan.rank}º` : '—'}</strong><small>posição do seu Clube</small></div>
        <div><strong>{fmt(data.myClan?.points)}</strong><small>pontos do Clube</small></div>
        <div><strong>{fmt(data.myContribution)}</strong><small>sua contribuição</small></div>
      </div>
      <ProgressBar value={data.myContribution} max={rules.minMemberPoints} label="Pontos mínimos pra ganhar o prêmio" tone={data.myContribution >= rules.minMemberPoints ? 'green' : 'brand'} />
      <p className="c4-small">{data.myContribution >= rules.minMemberPoints ? 'Você já garantiu sua parte se o Clube vencer!' : `Faltam ${rules.minMemberPoints - data.myContribution} pontos pra você entrar no prêmio.`}</p>
      {data.standings.length === 0
        ? <EmptyState compact icon="trophy" title="Ninguém pontuou ainda" text="A semana acabou de começar. Puxe a conversa!" />
        : (
          <ol className="c4-list c4-rank">
            {data.standings.map((c) => (
              <li key={c.clanId} className={`c4-list-row ${c.clanId === clanId ? 'is-me' : ''}`}>
                <span className={`c4-rank-pos pos-${c.rank}`}>{c.rank}</span>
                <span className="c4-clan-icon"><ClanIcon icon={c.icon} color={c.iconColor} size={24} /></span>
                <div className="c4-list-main">
                  <strong className="truncate">{c.name}</strong>
                  <small>{fmt(c.messages)} msgs · {fmt(c.voiceMinutes)} min em call · {fmt(c.forumPosts)} posts</small>
                </div>
                <span className="pk-chip brand">{fmt(c.points)} pts</span>
              </li>
            ))}
          </ol>
        )}
      {data.lastWinner && (
        <p className="c4-last-winner"><Ico name="crown" size={16} /> Campeão da semana passada: <strong>{data.lastWinner.name}</strong> com {fmt(data.lastWinner.points)} pontos.</p>
      )}
    </div>
  );
}
