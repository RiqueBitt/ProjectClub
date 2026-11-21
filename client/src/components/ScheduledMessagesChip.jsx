import { useEffect, useState } from 'react';
import { listScheduledMessages, cancelScheduledMessage } from '../api/endpoints';
import { useSocket } from '../context/SocketContext.jsx';
import { useStore } from '../store/useStore';
import ChatIcon from './ChatIcons.jsx';

// Chip discreto acima do composer: "2 mensagens agendadas". Abre a lista
// com horário e botão de cancelar. Atualiza quando o servidor envia/falha
// (eventos scheduled:sent / scheduled:failed na sala pessoal).
const fmt = (d) => new Date(d).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function ScheduledMessagesChip({ channelId, conversationId, refreshToken }) {
  const { socket } = useSocket() || {};
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    listScheduledMessages({ channelId: channelId || undefined, conversationId: conversationId || undefined })
      .then((d) => { if (alive) setItems(d?.scheduled || []); }).catch(() => {});
    return () => { alive = false; };
  }, [channelId, conversationId, refreshToken]);

  useEffect(() => {
    if (!socket) return undefined;
    const drop = ({ id, error }) => {
      setItems((list) => list.filter((s) => s.id !== id));
      if (error) useStore.getState().pushNotice(`Mensagem agendada não enviada: ${error}`);
    };
    socket.on('scheduled:sent', drop);
    socket.on('scheduled:failed', drop);
    return () => { socket.off('scheduled:sent', drop); socket.off('scheduled:failed', drop); };
  }, [socket]);

  if (!items.length) return null;
  const cancel = async (id) => {
    try { await cancelScheduledMessage(id); setItems((l) => l.filter((s) => s.id !== id)); } catch { useStore.getState().pushNotice('Não foi possível cancelar.'); }
  };
  return (
    <div className="scheduled-chip-wrap">
      <button type="button" className="scheduled-chip" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChatIcon name="clock" size={13} /> {items.length === 1 ? '1 mensagem agendada' : `${items.length} mensagens agendadas`}
      </button>
      {open && (
        <ul className="scheduled-list">
          {items.map((s) => (
            <li key={s.id}>
              <div className="scheduled-item-body">
                <span className="scheduled-item-when">{fmt(s.sendAt)}</span>
                <span className="scheduled-item-text truncate">{s.content}</span>
              </div>
              <button type="button" className="icon-btn-small" title="Cancelar envio" aria-label="Cancelar envio" onClick={() => cancel(s.id)}><ChatIcon name="close" size={13} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
