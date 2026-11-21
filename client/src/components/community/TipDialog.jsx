import { useEffect, useState } from 'react';
import { getTipStatus, sendTip, errText } from '../../api/community';
import { useStore } from '../../store/useStore';
import { Ico } from '../PagesKit.jsx';
import UserAvatar from '../UserAvatar.jsx';
import { Dialog, fmt } from './CommunityBits.jsx';

// Gorjeta em moedas pra quem escreveu uma mensagem. O servidor faz a
// transferência numa transação só (saldo, teto diário, crédito e extrato).
const PRESETS = [10, 25, 50, 100];

export default function TipDialog({ message, onClose }) {
  const [status, setStatus] = useState(null);
  const [amount, setAmount] = useState(25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { getTipStatus().then(setStatus).catch((e) => setError(errText(e))); }, []);
  const left = status ? Math.max(0, status.dailyCap - status.sentToday) : null;
  const send = async () => {
    setBusy(true); setError('');
    try {
      const r = await sendTip(message.id, Number(amount));
      useStore.getState().pushNotice(`Você deu ${r.amount} moedas de gorjeta pra ${message.author?.displayName || 'essa pessoa'}. Saldo: ${fmt(r.coins)}.`);
      onClose();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog
      title="Dar gorjeta" onClose={onClose} width={400}
      footer={(
        <>
          <button type="button" className="pk-btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="pk-btn primary" disabled={busy || !status || !amount} onClick={send}>
            {busy ? 'Enviando…' : <>Enviar <Ico name="coin" size={15} /> {fmt(amount)}</>}
          </button>
        </>
      )}
    >
      <div className="c4-list-row">
        <UserAvatar user={message.author} size={36} />
        <div className="c4-list-main">
          <strong>{message.author?.displayName || 'Autor da mensagem'}</strong>
          {message.content && <small className="c4-clamp">“{message.content.slice(0, 120)}”</small>}
        </div>
      </div>
      <div className="c4-chips" role="group" aria-label="Valor">
        {PRESETS.map((v) => (
          <button key={v} type="button" className={`c4-interest ${Number(amount) === v ? 'on' : ''}`} aria-pressed={Number(amount) === v} onClick={() => setAmount(v)}>
            <Ico name="coin" size={14} /> {v}
          </button>
        ))}
      </div>
      <label className="c4-form-inline">Outro valor
        <input type="number" min={status?.min || 5} max={status?.max || 500} value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 4))} />
      </label>
      {status && <p className="c4-small">De {status.min} a {status.max} moedas por gorjeta. Hoje você ainda pode dar {fmt(left)} moedas.</p>}
      {error && <p className="c4-error" role="alert">{error}</p>}
    </Dialog>
  );
}
