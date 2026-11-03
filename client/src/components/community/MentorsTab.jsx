import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMentorship, saveCommunityPrefs, errText } from '../../api/community';
import { EmptyState, Ico, Skeleton } from '../PagesKit.jsx';
import UserAvatar from '../UserAvatar.jsx';
import { ProgressBar, SectionCard, fmt, useFlash } from './CommunityBits.jsx';

const STATUS = { ACTIVE: 'Em andamento', REWARDED: 'Ficou! Você ganhou', EXPIRED: 'Encerrado' };

function Toggle({ title, hint, on, disabled, onChange }) {
  return (
    <label className={`c4-toggle ${disabled ? 'is-disabled' : ''}`}>
      <span className="c4-toggle-text"><strong>{title}</strong><small>{hint}</small></span>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="c4-switch" aria-hidden="true" />
    </label>
  );
}

// Padrinho de novatos + preferências de participação (padrinho e aniversário).
export default function MentorsTab() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flash, show] = useFlash();
  const navigate = useNavigate();
  const load = () => getMentorship().then(setData).catch(() => setData({ error: true }));
  useEffect(() => { load(); }, []);

  if (!data) return <Skeleton rows={3} height={70} />;
  if (data.error) return <EmptyState compact icon="users" title="Não deu pra carregar" text="Tente de novo daqui a pouco." />;
  const { prefs, rules } = data;

  const save = async (patch, okText) => {
    setBusy(true);
    try {
      const p = await saveCommunityPrefs(patch);
      setData((d) => ({ ...d, prefs: p }));
      show(okText);
    } catch (e) { show(errText(e), 'bad'); } finally { setBusy(false); }
  };

  return (
    <>
      <SectionCard icon="shield" title="Participação">
        <Toggle
          title="Quero ser padrinho/madrinha"
          hint={prefs.canMentor
            ? `Recebe um membro novo pra dar as boas-vindas (no máximo ${rules.maxActive} ao mesmo tempo). Se ele ficar ativo ${rules.menteeActiveDays} dias, você ganha ${fmt(rules.rewardCoins)} moedas.`
            : `Libera a partir do nível ${rules.minLevel}.`}
          on={prefs.mentorOptIn} disabled={busy || (!prefs.canMentor && !prefs.mentorOptIn)}
          onChange={(v) => save({ mentorOptIn: v }, v ? 'Pronto! Você vai receber o próximo membro novo.' : 'Você não vai mais receber afilhados.')}
        />
        <Toggle
          title="Comemorar meu aniversário"
          hint={prefs.hasBirthDate
            ? 'No dia, seus amigos recebem um aviso pra te dar parabéns e você ganha um presente. Só o dia aparece — nunca o ano nem a idade.'
            : 'Você não tem data de nascimento cadastrada, então não tem o que comemorar por aqui.'}
          on={prefs.birthdayOptIn} disabled={busy || (!prefs.hasBirthDate && !prefs.birthdayOptIn)}
          onChange={(v) => save({ birthdayOptIn: v }, v ? 'Combinado! Vamos comemorar no seu dia.' : 'Tudo bem, seu aniversário fica só com você.')}
        />
      </SectionCard>

      {data.mentor && (
        <SectionCard icon="heart" title="Seu padrinho">
          <div className="c4-list-row">
            <UserAvatar user={data.mentor.user} size={40} />
            <div className="c4-list-main">
              <strong>{data.mentor.user?.displayName}</strong>
              <small>Desde {new Date(data.mentor.since).toLocaleDateString('pt-BR')}. Pode chamar pra tirar qualquer dúvida!</small>
            </div>
            <button type="button" className="pk-btn sm" onClick={() => navigate('/dms')}><Ico name="chat" size={15} /> Conversar</button>
          </div>
        </SectionCard>
      )}

      {(prefs.mentorOptIn || data.mentees.length > 0) && (
        <SectionCard icon="users" title="Seus afilhados">
          {data.mentees.length === 0 && <EmptyState compact icon="users" title="Nenhum afilhado ainda" text="Assim que uma conta nova for aprovada, ela pode cair com você." />}
          <ul className="c4-list">
            {data.mentees.map((m) => (
              <li key={m.id} className="c4-list-row">
                <UserAvatar user={m.user} size={36} />
                <div className="c4-list-main">
                  <strong>{m.user?.displayName || 'Membro'}</strong>
                  <small>{STATUS[m.status] || m.status}{m.status === 'REWARDED' ? ` ${fmt(rules.rewardCoins)} moedas` : ''}</small>
                  {m.status === 'ACTIVE' && (
                    <>
                      <ProgressBar value={m.activeDays} max={rules.menteeActiveDays} label="Dias ativos do afilhado" tone="green" />
                      <small>{m.activeDays} de {rules.menteeActiveDays} dias ativos</small>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
      {flash}
    </>
  );
}
