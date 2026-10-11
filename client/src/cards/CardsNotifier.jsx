import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { Icon, UI } from './CardView.jsx';
import { cardsAcceptChallenge, cardsDeclineChallenge, errMsg } from './api';
import '../styles/cards.css';

// Avisos do Jogo de Cartas em qualquer tela: desafio recebido, desafio
// aceito e proposta de troca. Dentro da Arena a própria página atualiza.
export default function CardsNotifier() {
  const { socket } = useSocket() || {};
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!socket) return undefined;
    const onChallenge = (msg) => setToast({ kind: 'challenge', id: msg.id, from: msg.from });
    const onMatch = (msg) => { if (msg?.started) setToast({ kind: 'started', id: msg.id }); };
    const onTrade = (msg) => { if (!msg?.accepted) setToast({ kind: 'trade', id: msg.id }); else setToast({ kind: 'tradeDone', id: msg.id }); };
    const onInvite = (msg) => setToast({ kind: 'invite', code: msg.code, from: msg.from, format: msg.format, custom: msg.custom });
    socket.on('cards:invite', onInvite);
    socket.on('cards:challenge', onChallenge);
    socket.on('cards:match', onMatch);
    socket.on('cards:trade', onTrade);
    return () => { socket.off('cards:invite', onInvite); socket.off('cards:challenge', onChallenge); socket.off('cards:match', onMatch); socket.off('cards:trade', onTrade); };
  }, [socket]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.kind === 'challenge' || toast.kind === 'invite' ? 60_000 : 12_000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  const onArena = pathname.startsWith('/cartas');
  if (onArena && toast.kind !== 'challenge' && toast.kind !== 'invite') return null;
  const close = () => setToast(null);

  if (toast.kind === 'invite') {
    return (
      <div className="tcg-toast is-invite" role="alert">
        <UserAvatar user={toast.from || {}} size={38} />
        <span className="tcg-toast-text">
          <b data-no-translate>{toast.from?.displayName || 'Alguém'}</b> está chamando você para uma batalha {toast.format === '2V2' ? '2 vs 2' : '1 vs 1'}{toast.custom ? ' personalizada' : ''}!
          <small>Arena de Cartas · sala {toast.code}</small>
        </span>
        <button type="button" className="tcg-btn ghost" onClick={close}>Agora não</button>
        <button type="button" className="tcg-btn primary" onClick={() => { close(); navigate(`/cartas?sala=${toast.code}`); }}><Icon d={UI.sword} size={15} />Entrar</button>
      </div>
    );
  }

  if (toast.kind === 'challenge') {
    return (
      <div className="tcg-toast" role="alert">
        <UserAvatar user={toast.from || {}} size={34} />
        <span className="tcg-toast-text"><b data-no-translate>{toast.from?.displayName || 'Alguém'}</b> desafiou você na Arena de Cartas!</span>
        <button type="button" className="tcg-btn ghost" onClick={() => { cardsDeclineChallenge(toast.id).catch(() => {}); close(); }}>Recusar</button>
        <button type="button" className="tcg-btn primary" onClick={async () => {
          try { const m = await cardsAcceptChallenge(toast.id); close(); navigate(`/cartas?partida=${m.id}`); } catch (e) { setToast({ kind: 'error', text: errMsg(e) }); }
        }}>Aceitar</button>
      </div>
    );
  }
  const text = {
    started: 'Seu desafio foi aceito! A partida começou.',
    trade: 'Você recebeu uma proposta de troca de cartas.',
    tradeDone: 'Sua proposta de troca foi aceita!',
    error: toast.text,
  }[toast.kind];
  const go = { started: `/cartas?partida=${toast.id}`, trade: '/cartas?aba=trocas', tradeDone: '/cartas?aba=colecao' }[toast.kind];
  return (
    <div className="tcg-toast" role="status">
      <span className="tcg-logo" style={{ width: 34, height: 34, borderRadius: 10 }}><Icon d={toast.kind === 'started' ? UI.sword : UI.swap} size={18} /></span>
      <span className="tcg-toast-text">{text}</span>
      {go && <button type="button" className="tcg-btn primary" onClick={() => { close(); navigate(go); }}>{toast.kind === 'started' ? 'Entrar' : 'Ver'}</button>}
      <button type="button" className="tcg-icon-btn" onClick={close} aria-label="Fechar"><Icon d={UI.close} size={14} /></button>
    </div>
  );
}
