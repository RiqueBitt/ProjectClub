import { useEffect, useState } from 'react';
import Modal from '../Modal.jsx';
import { createReminder, previewReminderWhen } from '../../api/endpoints';
import { useStore } from '../../store/useStore';

// "Me lembra disso": cria um lembrete pessoal (vira notificação + push na
// hora). Pode vir de uma mensagem (guarda link + id pra pular até ela) ou
// avulso. Presets + texto livre ("em 2h", "amanhã 9h", "15/10 14:00") com
// prévia do horário interpretado antes de confirmar.
const fmt = (d) => new Date(d).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const PRESETS = [
  { label: 'Em 20 minutos', when: 'em 20m' },
  { label: 'Em 1 hora', when: 'em 1h' },
  { label: 'Em 3 horas', when: 'em 3h' },
  { label: 'Hoje às 18:00', when: 'hoje 18h' },
  { label: 'Amanhã às 09:00', when: 'amanhã 9h' },
  { label: 'Em 1 semana', when: '1 semana' },
];

export default function ReminderModal({ message, defaultText, link, onClose, onCreated }) {
  const [text, setText] = useState(() => defaultText || (message?.content ? `Mensagem de ${message.author?.displayName || 'alguém'}: ${message.content.slice(0, 120)}` : ''));
  const [when, setWhen] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Prévia do horário digitado (debounce curto).
  useEffect(() => {
    const w = when.trim();
    if (!w) { setPreview(null); return undefined; }
    const t = setTimeout(() => {
      previewReminderWhen(w).then((d) => setPreview(d.dueAt)).catch(() => setPreview(false));
    }, 250);
    return () => clearTimeout(t);
  }, [when]);

  const submit = async (whenText) => {
    if (busy) return;
    const t = text.trim();
    if (!t) { setError('Escreva do que você quer lembrar.'); return; }
    setBusy(true); setError('');
    try {
      const { reminder } = await createReminder({ text: t, when: whenText, tzOffset: new Date().getTimezoneOffset(), link: link || undefined, messageId: message?.id || undefined });
      useStore.getState().pushNotice(`Vou te lembrar ${fmt(reminder.dueAt)}.`);
      onCreated?.(reminder);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível criar o lembrete.');
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Lembrar-me" onClose={onClose} width="460px">
      <div className="schedule-modal">
        <label className="dim" htmlFor="reminder-text">Do quê?</label>
        <textarea id="reminder-text" className="reminder-text" rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: responder a Ana sobre o evento" />
        <div className="schedule-presets">
          {PRESETS.map((p) => (
            <button key={p.when} type="button" className="schedule-preset" disabled={busy} onClick={() => submit(p.when)}><span>{p.label}</span></button>
          ))}
        </div>
        <div className="schedule-custom">
          <label className="dim" htmlFor="reminder-when">Ou escreva quando</label>
          <div className="schedule-custom-row">
            <input id="reminder-when" type="text" value={when} onChange={(e) => setWhen(e.target.value)} placeholder="em 2h · amanhã 9h · 18:30 · 15/10 14:00" onKeyDown={(e) => { if (e.key === 'Enter' && preview) submit(when.trim()); }} />
            <button type="button" className="btn-primary" disabled={busy || !preview} onClick={() => submit(when.trim())}>Lembrar</button>
          </div>
          {preview && <small className="dim">Vou te lembrar {fmt(preview)}</small>}
          {preview === false && when.trim() && <small className="field-error">Não entendi esse horário.</small>}
        </div>
        {error && <p className="field-error">{error}</p>}
      </div>
    </Modal>
  );
}
