import { useEffect, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import UserAvatar from '../UserAvatar.jsx';
import { sendMessage } from '../../api/endpoints';
import { useStore } from '../../store/useStore';
import { suggestThreadName } from '../../utils/chatFeatures';

// "Criar tópico" a partir de uma mensagem: nome (sugerido pelo texto da
// mensagem) + primeira resposta opcional. Ao criar, abre o painel do
// tópico à direita.
const NAME_MAX = 100;

export default function CreateThreadModal({ message, onClose }) {
  const [name, setName] = useState(() => suggestThreadName(message.content) || '');
  const [first, setFirst] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); }); }, []);

  const submit = async (e) => {
    e?.preventDefault();
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('channelId', message.channelId);
      fd.append('replyToId', message.id);
      fd.append('title', title.slice(0, NAME_MAX));
      const { message: root } = await sendMessage(fd);
      if (first.trim()) {
        const fd2 = new FormData();
        fd2.append('channelId', message.channelId);
        fd2.append('threadId', root.id);
        fd2.append('content', first.trim());
        await sendMessage(fd2).catch(() => {});
      }
      useStore.getState().setOpenThread({ id: root.id, channelId: root.channelId, root });
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || 'Não deu pra criar o tópico. Tente de novo.');
      setBusy(false);
    }
  };

  const preview = String(message.content || '').slice(0, 180) || (message.attachments?.length ? '📎 Anexo' : '…');
  return (
    <Modal title="Criar tópico" onClose={onClose} width="460px">
      <form className="thread-create" onSubmit={submit}>
        <div className="thread-create-origin">
          <UserAvatar user={message.author} size={24} />
          <div>
            <b>{message.author?.displayName || 'Alguém'}</b>
            <p>{preview}</p>
          </div>
        </div>
        <label className="thread-create-field">
          <span>Nome do tópico</span>
          <input
            ref={inputRef}
            value={name}
            maxLength={NAME_MAX}
            placeholder="Ex.: Combinando o torneio de sábado"
            onChange={(e) => setName(e.target.value)}
            required
          />
          <small>{name.length}/{NAME_MAX}</small>
        </label>
        <label className="thread-create-field">
          <span>Primeira mensagem <em>(opcional)</em></span>
          <textarea
            rows={3}
            value={first}
            maxLength={4000}
            placeholder="Puxe o assunto…"
            onChange={(e) => setFirst(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e); }}
          />
        </label>
        <p className="thread-create-hint">Quem participar recebe aviso das novas respostas. Tópicos parados por alguns dias são arquivados sozinhos — é só responder pra reabrir.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-link" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={!name.trim() || busy}>{busy ? 'Criando…' : 'Criar tópico'}</button>
        </div>
      </form>
    </Modal>
  );
}
