import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { rollDice } from '../api/endpoints';
import { DicePicker } from './activities/Dice.jsx';
import { ChatVideoPicker, ChatMusicPicker } from './activities/ChatMediaPickers.jsx';

// Botão "Atividades" na barra de digitação (do lado do emoji):
//   Rolar dados  → o servidor sorteia; vai pro chat o cartão animado
//   YouTube      → cartão de vídeo (assiste quem clicar, dá pra levar pra call)
//   Música       → cartão de música (YouTube Music, Spotify ou Last.fm)
//   Mostrar cartão → o cartão da carteira
// `onSendActivity(url)` manda o link da atividade como mensagem (vira cartão).
const ACTIONS = [
  { id: 'dice', title: 'Rolar dados', desc: 'Do D2 ao D100, quantos quiser', icon: 'M12 2.5 20.5 7.3v9.4L12 21.5l-8.5-4.8V7.3zM12 2.5v19M3.5 7.3l8.5 4.9 8.5-4.9', color: '#ff8a2a' },
  { id: 'video', title: 'YouTube', desc: 'Manda um vídeo pra assistir no chat', icon: 'M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM10 9v6l5-3z', color: '#ff2d2d' },
  { id: 'music', title: 'Música', desc: 'YouTube Music, Spotify ou Last.fm', icon: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z', color: '#a855f7' },
];

export default function ActivitiesComposerButton({ onShowCard, onSendActivity }) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(null); // 'dice' | 'video' | 'music'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => { if (!open) setError(''); }, [open]);

  const showCard = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await onShowCard(); setOpen(false); } catch (err) {
      // 404 aqui = o servidor ainda está rodando a versão antiga (atualizou
      // os arquivos mas não reiniciou): avisa em vez de "Rota não encontrada".
      setError(err?.response?.status === 404
        ? 'O servidor ainda não foi reiniciado com a versão nova. Tente de novo daqui a pouco.'
        : err?.response?.data?.error || 'Não foi possível mostrar o cartão.');
    } finally { setBusy(false); }
  };

  return (
    <div className="mj-composer" ref={ref}>
      <button type="button" className={`icon-btn chat-composer-btn ${open ? 'on' : ''}`} title="Atividades" aria-label="Atividades" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" /><circle cx="17" cy="7.2" r="3.3" /><path d="M7.2 13.5l3.3 5.7H4z" /><path d="M17 13.5l3.4 3.4-3.4 3.4-3.4-3.4z" />
        </svg>
      </button>
      {open && (
        <div className="mj-composer-pop" role="dialog" aria-label="Atividades">
          <div className="mj-composer-head"><strong>Atividades</strong></div>
          <div className="mj-composer-actions">
            {onSendActivity && ACTIONS.map((a) => (
              <button key={a.id} type="button" className="mj-composer-action" onClick={() => { setOpen(false); setModal(a.id); }}>
                <span className="mj-composer-action-icon" aria-hidden="true" style={{ background: a.color, color: '#fff' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={a.icon} /></svg>
                </span>
                <span className="mj-composer-action-text"><strong>{a.title}</strong><small>{a.desc}</small></span>
              </button>
            ))}
          </div>
          {onShowCard && (
            <div className="mj-composer-actions">
              <button type="button" className="mj-composer-action" onClick={showCard} disabled={busy}>
                <span className="mj-composer-action-icon" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 10h18M7 15h4" /></svg>
                </span>
                <span className="mj-composer-action-text">
                  <strong>{busy ? 'Mostrando…' : 'Mostrar cartão'}</strong>
                  <small>Manda o seu cartão da carteira no chat</small>
                </span>
              </button>
              {error && <p className="mj-composer-error">{error}</p>}
            </div>
          )}
        </div>
      )}
      {modal === 'dice' && createPortal(
        <DicePicker
          where="chat" onClose={() => setModal(null)}
          onRoll={async (payload) => { const r = await rollDice(payload); await onSendActivity(`${window.location.origin}/atividade/dados/${r.id}`); }}
        />, document.body,
      )}
      {modal === 'video' && createPortal(<ChatVideoPicker onClose={() => setModal(null)} onSend={(id) => onSendActivity(`${window.location.origin}/atividade/video/${id}`)} />, document.body)}
      {modal === 'music' && createPortal(<ChatMusicPicker onClose={() => setModal(null)} onSend={(id) => onSendActivity(`${window.location.origin}/atividade/musica/${id}`)} />, document.body)}
    </div>
  );
}
