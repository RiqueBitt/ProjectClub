import { useEffect, useState } from 'react';
import { getMyReferrals, errText } from '../../api/community';
import { EmptyState, Ico, Skeleton } from '../PagesKit.jsx';
import UserAvatar from '../UserAvatar.jsx';
import { SectionCard, fmt, useFlash } from './CommunityBits.jsx';

// Indicação de amigos: código/link pessoal + quem já entrou pelo seu convite.

const STATUS = {
  PENDING: { label: 'Aguardando atividade', tone: '' },
  REWARDED: { label: 'Pago', tone: 'green' },
  CAPPED: { label: 'Limite do mês', tone: '' },
  SUSPECT: { label: 'Em análise', tone: '' },
  EXPIRED: { label: 'Expirou', tone: '' },
  REJECTED: { label: 'Não vale', tone: '' },
};

export default function ReferralsTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [flash, show] = useFlash();
  useEffect(() => { getMyReferrals().then(setData).catch((e) => setError(errText(e))); }, []);
  if (error) return <EmptyState compact icon="users" title="Não deu pra carregar" text={error} />;
  if (!data) return <Skeleton rows={2} height={90} />;
  const fullLink = `${window.location.origin}${data.link}`;
  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); show(`${what} copiado!`); } catch { show('Não foi possível copiar.', 'bad'); }
  };
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Project Club', text: 'Vem pro Project Club comigo!', url: fullLink }); return; } catch { /* cancelado */ }
    }
    copy(fullLink, 'Link');
  };
  const r = data.rules;
  return (
    <>
      <SectionCard icon="gift" title="Convide amigos">
        <p className="pk-muted">
          Quando alguém entra pelo seu convite e fica ativo (nível {r.minLevel} e {r.minDays} dias de conta),
          você ganha <strong>{fmt(r.inviterCoins)} moedas</strong> e a pessoa ganha <strong>{fmt(r.inviteeCoins)}</strong>.
          Até {r.monthlyCap} indicações pagas por mês.
        </p>
        <div className="c4-code-box">
          <div>
            <small>Seu código</small>
            <strong className="c4-code">{data.code}</strong>
          </div>
          <div className="c4-code-actions">
            <button type="button" className="pk-btn sm" onClick={() => copy(data.code, 'Código')}><Ico name="doc" size={15} /> Copiar código</button>
            <button type="button" className="pk-btn sm primary" onClick={share}><Ico name="mail" size={15} /> Compartilhar link</button>
          </div>
        </div>
        <p className="c4-small">Este mês: {data.paidThisMonth} de {r.monthlyCap} indicações pagas.</p>
      </SectionCard>
      <SectionCard icon="users" title="Quem entrou pelo seu convite">
        {data.referrals.length === 0 && <EmptyState compact icon="users" title="Ninguém ainda" text="Mande o link pros seus amigos — a inscrição deles já vai com o seu código." />}
        <ul className="c4-list">
          {data.referrals.map((ref) => (
            <li key={ref.id} className="c4-list-row">
              {ref.invitee ? <UserAvatar user={ref.invitee} size={32} /> : <span className="c4-avatar-ph"><Ico name="user" size={16} /></span>}
              <div className="c4-list-main">
                <strong>{ref.invitee?.displayName || 'Inscrição em análise'}</strong>
                <small>{new Date(ref.createdAt).toLocaleDateString('pt-BR')}{ref.invitee ? ` · nível ${ref.invitee.accountLevel}` : ''}</small>
              </div>
              <span className={`pk-chip ${STATUS[ref.status]?.tone || ''}`}>{STATUS[ref.status]?.label || ref.status}{ref.status === 'REWARDED' && ref.coins ? ` · +${fmt(ref.coins)}` : ''}</span>
            </li>
          ))}
        </ul>
      </SectionCard>
      {flash}
    </>
  );
}
