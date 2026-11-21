import { useEffect, useRef } from 'react';
import Modal from '../Modal.jsx';
import Message from '../Message.jsx';

// "Pular para a mensagem" quando ela é antiga demais pra costurar na
// lista do chat sem deixar buraco: mostra a mensagem com as 25 antes e as
// 25 depois (GET /messages?around=), já rolado até ela e destacada.
export default function MessageContextModal({ messages, targetId, title, onClose, onOpenTopic }) {
  const listRef = useRef(null);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-message-id="${targetId}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.classList.add('nav-flash');
    }
  }, [targetId]);
  return (
    <Modal title={title || 'Contexto da mensagem'} onClose={onClose} width="640px" className="message-context-modal">
      <p className="message-context-hint">Mensagem antiga — mostrando a conversa em volta dela.</p>
      <div className="message-list message-context-list" ref={listRef}>
        {messages.map((m) => (
          <Message key={m.id} message={m} showAuthor onReply={() => {}} onOpenTopic={(t) => { onClose(); onOpenTopic?.(t); }} />
        ))}
      </div>
    </Modal>
  );
}
