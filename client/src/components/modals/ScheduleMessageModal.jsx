import { useState } from 'react';
import Modal from '../Modal.jsx';
import { scheduleMessage } from '../../api/endpoints';
import { useStore } from '../../store/useStore';

// "Enviar depois": agenda a mensagem do composer pra um horário. Presets
// comuns + escolher data/hora. O servidor envia na hora marcada pelo mesmo
// caminho do envio normal (permissões, automod, menções), como se a pessoa
// tivesse apertado Enter naquela hora.
const fmt = (d) => d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
function at(h, m, addDays = 0) { const d = new Date(); d.setDate(d.getDate() + addDays); d.setHours(h, m, 0, 0); return d; }
function presets(now = new Date()) {
  const list = [
    { label: 'Em 30 minutos', at: new Date(now.getTime() + 30 * 60000) },
    { label: 'Em 1 hora', at: new Date(now.getTime() + 60 * 60000) },
    { label: 'Em 3 horas', at: new Date(now.getTime() + 3 * 3600000) },
  ];
  const today18 = at(18, 0); if (today18 > now) list.push({ label: 'Hoje às 18:00', at: today18 });
  list.push({ label: 'Amanhã às 09:00', at: at(9, 0, 1) });
  list.push({ label: 'Amanhã às 18:00', at: at(18, 0, 1) });
  const monday = new Date(now); monday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7)); monday.setHours(9, 0, 0, 0);
  list.push({ label: 'Segunda às 09:00', at: monday });
  return list;
}
function toLocalInput(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }

export default function ScheduleMessageModal({ content, channelId, conversationId, replyToId, onClose, onScheduled }) {
  const [custom, setCustom] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const options = presets();

  const submit = async (when) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { scheduled } = await scheduleMessage({ content, channelId, conversationId, replyToId: replyToId || undefined, sendAt: when.toISOString() });
      useStore.getState().pushNotice(`Mensagem agendada para ${fmt(new Date(scheduled.sendAt))}.`);
      onScheduled?.(scheduled);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível agendar agora.');
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Enviar depois" onClose={onClose} width="460px">
      <div className="schedule-modal">
        <p className="dim schedule-preview">“{content.length > 140 ? `${content.slice(0, 140)}…` : content}”</p>
        <div className="schedule-presets">
          {options.map((o) => (
            <button key={o.label} type="button" className="schedule-preset" disabled={busy} onClick={() => submit(o.at)}>
              <span>{o.label}</span><small className="dim">{fmt(o.at)}</small>
            </button>
          ))}
        </div>
        <div className="schedule-custom">
          <label className="dim" htmlFor="schedule-custom-at">Ou escolha data e hora</label>
          <div className="schedule-custom-row">
            <input id="schedule-custom-at" type="datetime-local" value={custom} min={toLocalInput(new Date())} onChange={(e) => setCustom(e.target.value)} />
            <button type="button" className="btn-primary" disabled={busy || !custom} onClick={() => { const d = new Date(custom); if (Number.isNaN(d.getTime())) return setError('Data inválida.'); submit(d); }}>Agendar</button>
          </div>
        </div>
        {error && <p className="field-error">{error}</p>}
      </div>
    </Modal>
  );
}
