import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import '../../styles/report-dialog.css';

// Denúncia rápida no estilo do Discord: um clique no motivo, detalhes
// opcionais e "Enviar denúncia". Usada pra mensagem (Message.jsx) e pra
// perfil (UserProfileModal.jsx). As chaves são as mesmas que o servidor
// aceita (REPORT_CATEGORIES em server/src/controllers/reportController.js).
export const REPORT_CATEGORIES = [
  { key: 'spam', label: 'Spam', hint: 'Propaganda, flood ou mensagens repetidas' },
  { key: 'harassment', label: 'Assédio ou ódio', hint: 'Ofensas, ameaças, perseguição ou discurso de ódio' },
  { key: 'nsfw', label: 'Conteúdo impróprio/NSFW', hint: 'Conteúdo adulto, violento ou chocante' },
  { key: 'scam', label: 'Golpe ou phishing', hint: 'Links falsos, roubo de conta, promessas de prêmio' },
  { key: 'impersonation', label: 'Se passando por alguém', hint: 'Perfil falso ou fingindo ser outra pessoa' },
  { key: 'other', label: 'Outro', hint: 'Conte o que aconteceu nos detalhes' },
];
const DETAILS_MAX = 500;

/**
 * @param {object} props
 * @param {string} props.title        ex.: "Denunciar mensagem"
 * @param {import('react').ReactNode} [props.subtitle]  o que está sendo denunciado
 * @param {(category: string, details: string) => Promise<{alreadyReported?: boolean}>} props.onSubmit
 * @param {() => void} props.onClose
 */
export default function ReportDialog({ title, subtitle, onSubmit, onClose }) {
  const [category, setCategory] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null); // null | 'sent' | 'already'

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const needsDetails = category === 'other';
  const submit = async (e) => {
    e.preventDefault();
    if (!category || busy) return;
    if (needsDetails && !details.trim()) { setError('Conte o que aconteceu para a equipe entender a denúncia.'); return; }
    setBusy(true); setError('');
    try {
      const result = await onSubmit(category, details.trim());
      setDone(result?.alreadyReported ? 'already' : 'sent');
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível enviar a denúncia. Tente de novo.');
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="modal-overlay report-dlg-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal-box report-dlg" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="report-dlg-title">
        {done ? (
          <div className="report-dlg-done">
            <div className="report-dlg-check" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
            </div>
            <h3 id="report-dlg-title">Obrigado, a equipe vai analisar</h3>
            <p>
              {done === 'already'
                ? 'Você já tinha denunciado isso — a denúncia continua na fila da equipe.'
                : 'A equipe vai revisar e tomar as medidas necessárias. Se precisar, você também pode bloquear a pessoa.'}
            </p>
            <button type="button" className="btn-primary" onClick={onClose} autoFocus>Fechar</button>
          </div>
        ) : (
          <>
            <header className="report-dlg-head">
              <h3 id="report-dlg-title">{title}</h3>
              {subtitle && <div className="report-dlg-sub">{subtitle}</div>}
            </header>
            <p className="report-dlg-q">O que está acontecendo?</p>
            <div className="report-dlg-chips" role="radiogroup" aria-label="Motivo da denúncia">
              {REPORT_CATEGORIES.map((c) => (
                <button
                  key={c.key} type="button" role="radio" aria-checked={category === c.key}
                  className={`report-dlg-chip${category === c.key ? ' on' : ''}`}
                  onClick={() => { setCategory(c.key); setError(''); }}
                  title={c.hint}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {category && <p className="report-dlg-hint">{REPORT_CATEGORIES.find((c) => c.key === category)?.hint}</p>}
            <label className="report-dlg-details">
              <span>Detalhes {needsDetails ? <b className="report-dlg-req">(obrigatório)</b> : <i>(opcional)</i>}</span>
              <textarea
                value={details} maxLength={DETAILS_MAX} rows={3}
                placeholder={needsDetails ? 'Conte o que aconteceu' : 'Algo que ajude a equipe a entender'}
                onChange={(e) => setDetails(e.target.value)}
              />
              <small className="report-dlg-count">{details.length}/{DETAILS_MAX}</small>
            </label>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn-danger" disabled={!category || busy}>{busy ? 'Enviando…' : 'Enviar denúncia'}</button>
            </div>
          </>
        )}
      </form>
    </div>,
    document.body,
  );
}
