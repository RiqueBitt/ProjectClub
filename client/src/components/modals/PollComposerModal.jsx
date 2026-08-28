import { useState } from 'react';
import Modal from '../Modal.jsx';
import { createPoll } from '../../api/endpoints';
import cancelIcon from '../../assets/icons/cancel.png';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 7;

const DURATIONS = [
  { value: '1h', label: '1 hora' },
  { value: '4h', label: '4 horas' },
  { value: '16h', label: '16 horas' },
  { value: '24h', label: '24 horas' },
  { value: '3d', label: '3 dias' },
  { value: '1w', label: '1 semana' },
];

export default function PollComposerModal({ channelId, conversationId, onClose }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [duration, setDuration] = useState('24h');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const setOption = (i, value) => setOptions((o) => o.map((v, idx) => (idx === i ? value : v)));
  const addOption = () => { if (options.length < MAX_OPTIONS) setOptions((o) => [...o, '']); };
  const removeOption = (i) => { if (options.length > MIN_OPTIONS) setOptions((o) => o.filter((_, idx) => idx !== i)); };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim()) return setError('Escreva um título para a enquete.');
    if (cleanOptions.length < MIN_OPTIONS) return setError(`Adicione pelo menos ${MIN_OPTIONS} opções.`);

    setSubmitting(true);
    try {
      await createPoll({ channelId, conversationId, question: question.trim(), options: cleanOptions, duration });
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao criar enquete.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Criar enquete" onClose={onClose} width="440px">
      <form className="settings-grid poll-composer" onSubmit={submit}>
        <label>
          TÍTULO
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Sobre o que é a enquete?" autoFocus />
        </label>

        <label>OPÇÕES (até {MAX_OPTIONS})</label>
        {options.map((opt, i) => (
          <div key={i} className="poll-option-row">
            <input
              value={opt}
              onChange={(e) => setOption(i, e.target.value)}
              placeholder={`Opção ${i + 1}`}
              maxLength={80}
            />
            {options.length > MIN_OPTIONS && (
              <button type="button" className="icon-btn-small" onClick={() => removeOption(i)}><img className="ui-icon-sm" src={cancelIcon} alt="x" /></button>
            )}
          </div>
        ))}
        {options.length < MAX_OPTIONS && (
          <button type="button" className="btn-secondary" onClick={addOption}>+ Adicionar opção</button>
        )}

        <label>
          DURAÇÃO
          <select value={duration} onChange={(e) => setDuration(e.target.value)}>
            {DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>

        {error && <div className="auth-error">{error}</div>}
        <button type="submit" className="btn-primary" disabled={submitting}>Criar enquete</button>
      </form>
    </Modal>
  );
}
