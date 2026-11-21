import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listPinguAlerts, updatePinguAlert } from '../../api/endpoints';
import '../../styles/pingu-admin.css';

// Painel da Equipe → Moderação → Alertas do Pingu. Mensagens de canal que o
// filtro do Pingu achou suspeitas (e, com a IA ligada, que ela confirmou).
// O Pingu NUNCA pune: aqui a equipe abre a mensagem e decide o que fazer.
const STATUS = [
  { key: 'PENDING', label: 'Pendentes' },
  { key: 'RESOLVED', label: 'Resolvidos' },
  { key: 'DISMISSED', label: 'Dispensados' },
  { key: 'ALL', label: 'Todos' },
];

export default function PinguAlertsAdmin() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('PENDING');
  const [alerts, setAlerts] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = () => listPinguAlerts(status).then((r) => { setAlerts(r.alerts || []); setError(''); }).catch((e) => setError(e?.response?.data?.error || 'Não deu pra carregar os alertas.'));
  useEffect(() => { setAlerts(null); load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const mark = async (id, next) => {
    setBusy(id);
    try { await updatePinguAlert(id, next); await load(); } catch (e) { setError(e?.response?.data?.error || 'Não deu pra atualizar.'); } finally { setBusy(''); }
  };

  return (
    <div className="pgal">
      <p className="dim">O Pingu olha as mensagens dos canais com um filtro rápido (palavrões, ameaças, flood, maiúsculas, convites) e só as suspeitas vão pra IA confirmar. Ele só avisa — a decisão é sempre da equipe.</p>
      <div className="pgf-row" role="tablist">
        {STATUS.map((s) => (
          <button key={s.key} type="button" role="tab" aria-selected={status === s.key} className={status === s.key ? 'btn-primary' : 'btn-secondary'} onClick={() => setStatus(s.key)}>{s.label}</button>
        ))}
      </div>
      {error && <p className="pga-msg err">{error}</p>}
      {!alerts ? <p className="dim">Carregando…</p> : alerts.length === 0 ? <p className="dim">Nenhum alerta aqui. 🐧</p> : (
        <ul className="pgal-list">
          {alerts.map((a) => (
            <li key={a.id} className="pgal-item">
              <div className="pgal-head">
                <strong>{a.author?.displayName || a.author?.username || 'Conta removida'}</strong>
                {a.author?.username && <span className="dim">@{a.author.username}</span>}
                <span className="dim">em #{a.channel?.name || 'canal apagado'}</span>
                <span className="dim">· {new Date(a.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                <span className={`pgal-ai ${a.aiVerdict === 'SIM' ? 'sim' : 'sem'}`}>{a.aiVerdict === 'SIM' ? 'IA confirmou' : 'só o filtro'}</span>
              </div>
              <p className="pgal-snippet">{a.snippet}</p>
              <div className="pgal-reasons">{(a.reasons || []).map((r) => <span key={r}>{r}</span>)}</div>
              <div className="pgal-actions">
                {a.link && <button type="button" className="btn-secondary" onClick={() => navigate(a.link)}>Abrir mensagem</button>}
                {a.status === 'PENDING' ? (
                  <>
                    <button type="button" className="btn-primary" disabled={busy === a.id} onClick={() => mark(a.id, 'RESOLVED')}>Resolvido</button>
                    <button type="button" className="btn-secondary" disabled={busy === a.id} onClick={() => mark(a.id, 'DISMISSED')}>Dispensar</button>
                  </>
                ) : (
                  <>
                    <span className="dim">{a.status === 'RESOLVED' ? 'Resolvido' : 'Dispensado'}{a.reviewedBy ? ` por ${a.reviewedBy.displayName || a.reviewedBy.username}` : ''}</span>
                    <button type="button" className="btn-secondary" disabled={busy === a.id} onClick={() => mark(a.id, 'PENDING')}>Reabrir</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
