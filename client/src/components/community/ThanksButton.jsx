import { useState } from 'react';
import { thankTarget, errText } from '../../api/community';
import { useStore } from '../../store/useStore';

// Botão "Agradecer" (reputação). Uma vez por dia por pessoa — o servidor
// confere; aqui só mostra o resultado.
const HEART = 'M12 20s-7.5-4.5-9-9.5C2 6.9 4.4 4 7.4 4c2 0 3.6 1.1 4.6 2.7C13 5.1 14.6 4 16.6 4c3 0 5.4 2.9 4.4 6.5-1.5 5-9 9.5-9 9.5Z';

export async function thankAndNotify(targetType, targetId) {
  try {
    await thankTarget(targetType, targetId);
    useStore.getState().pushNotice('Agradecimento enviado! A pessoa vai ficar feliz.');
    return true;
  } catch (e) {
    useStore.getState().pushNotice(errText(e, 'Não deu pra agradecer agora.'));
    return e?.response?.data?.code === 'ALREADY_THANKED';
  }
}

export default function ThanksButton({ targetType, targetId, className = 'fp-action' }) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const click = async (e) => {
    e.stopPropagation();
    if (done || busy) return;
    setBusy(true);
    const ok = await thankAndNotify(targetType, targetId);
    setBusy(false);
    if (ok) setDone(true);
  };
  return (
    <button type="button" className={`${className} c4-thanks ${done ? 'is-done' : ''}`} onClick={click} disabled={busy} aria-pressed={done} title="Agradecer (reputação)">
      <svg width={16} height={16} viewBox="0 0 24 24" fill={done ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={HEART} /></svg>
      <span className="fp-action-label">{done ? 'Agradecido' : 'Agradecer'}</span>
    </button>
  );
}
