import { useEffect, useState } from 'react';
import { getMyAppeal, submitAppeal } from '../../api/endpoints';
import { AuthAlert, apiError } from './AuthFields.jsx';

// "Pedir revisão" (Fase 5) — aparece no aviso de conta banida/suspensa da
// tela de login. Usa o token curto que o login devolveu (não é uma sessão).
// Um pedido por punição; texto opcional de até 2000 caracteres.
const MAX = 2000;
const STATUS_LABEL = { PENDING: 'Em análise pela equipe', ACCEPTED: 'Aceito', DENIED: 'Recusado' };

export default function AppealPanel({ token }) {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let alive = true;
    setState(null); setError(''); setSent(false); setOpen(false);
    getMyAppeal(token)
      .then((d) => { if (alive) setState(d); })
      .catch((err) => { if (alive) setError(apiError(err, 'Não foi possível carregar o pedido de revisão.')); });
    return () => { alive = false; };
  }, [token]);

  const send = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { appeal } = await submitAppeal(token, text.trim());
      setState((s) => ({ ...(s || {}), appeal, canAppeal: false }));
      setSent(true); setOpen(false); setText('');
    } catch (err) {
      setError(apiError(err, 'Não foi possível enviar o pedido. Tente de novo.'));
    } finally { setBusy(false); }
  };

  if (!state && !error) return <p className="pc-appeal-muted"><span className="pc-spinner" aria-hidden="true" /> Carregando…</p>;

  const appeal = state?.appeal;
  return (
    <div className="pc-appeal">
      {appeal && state?.punishment && (
        <div className={`pc-appeal-status is-${String(appeal.status).toLowerCase()}`} role="status">
          <span>Pedido de revisão: <b>{STATUS_LABEL[appeal.status] || appeal.status}</b></span>
          {appeal.staffReply && <p><b>Resposta da equipe:</b> {appeal.staffReply}</p>}
          {appeal.status === 'PENDING' && <p>Você recebe a resposta por e-mail. Só é possível pedir uma revisão por punição.</p>}
        </div>
      )}
      {sent && <AuthAlert tone="info">Pedido enviado! A equipe vai analisar e você recebe a resposta por e-mail.</AuthAlert>}

      {state?.canAppeal && !open && (
        <button type="button" className="pc-btn pc-btn-ghost pc-appeal-open" onClick={() => setOpen(true)}>
          Pedir revisão da punição
        </button>
      )}
      {state?.canAppeal && open && (
        <form className="pc-appeal-form" onSubmit={send} noValidate>
          <label htmlFor="pc-appeal-text">Conte para a equipe por que a punição deveria ser revista (opcional)</label>
          <textarea
            id="pc-appeal-text" value={text} maxLength={MAX} rows={5}
            onChange={(e) => setText(e.target.value.slice(0, MAX))}
            placeholder="Ex.: acho que foi um engano porque…"
          />
          <div className="pc-appeal-row">
            <span className="pc-appeal-count" aria-live="polite">{text.length}/{MAX}</span>
            <button type="button" className="pc-text-btn" onClick={() => setOpen(false)} disabled={busy}>Cancelar</button>
          </div>
          <button type="submit" className="pc-btn pc-btn-primary" disabled={busy}>
            {busy && <span className="pc-spinner" aria-hidden="true" />} Enviar pedido
          </button>
          <p className="pc-appeal-muted">Só dá para pedir uma vez por punição — capriche na explicação.</p>
        </form>
      )}
      <AuthAlert>{error}</AuthAlert>
    </div>
  );
}
