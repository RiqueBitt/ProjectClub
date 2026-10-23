import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { listMessages, sendMessage, toggleArchiveTopic, listThreads } from '../api/endpoints';
import { useAuth } from '../context/AuthContext.jsx';
import { useStore, roomKeyFor } from '../store/useStore';
import { getMyCommunityPermissions, hasPermission } from '../utils/permissions';
import { isThreadArchived, threadReplyLabel, threadRoomKey } from '../utils/chatFeatures';
import { formatMessageTime } from '../utils/formatTime';
import Message from './Message.jsx';
import UserAvatar from './UserAvatar.jsx';
import { FeatureIcon, ThreadCard } from './ChatFeatureBits.jsx';
import '../styles/chat-features.css';

// Painel do tópico (igual ao Discord): abre à direita do chat no
// computador e em tela cheia no celular. As respostas usam o mesmo modelo
// de mensagem do canal (anexos, reações, editar, fixar...) e chegam em
// tempo real pela sala do canal — o SocketContext manda as que têm
// threadId pra messagesByRoom['thread:<id>'].
const EMPTY = [];
const GROUP_WINDOW_MS = 7 * 60 * 1000;
const MAX_FILES = 10;

export default function ThreadPanel({ channel, threadId, initialRoot, onClose, onJumpToParent }) {
  const { user } = useAuth();
  const roomKey = threadRoomKey(threadId);
  const replies = useStore((s) => s.messagesByRoom[roomKey] || EMPTY);
  const channelRoot = useStore((s) => (s.messagesByRoom[roomKeyFor({ channelId: channel?.id })] || EMPTY).find((m) => m.id === threadId));
  const roles = useStore((s) => s.roles);
  const members = useStore((s) => s.members);
  const [fetchedRoot, setFetchedRoot] = useState(initialRoot || null);
  const [status, setStatus] = useState('loading'); // loading | ready | error | gone
  const [content, setContent] = useState('');
  const [files, setFiles] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const stickRef = useRef(true);

  const root = useMemo(() => {
    if (channelRoot && fetchedRoot) return { ...fetchedRoot, ...channelRoot, replyTo: channelRoot.replyTo || fetchedRoot.replyTo };
    return channelRoot || fetchedRoot;
  }, [channelRoot, fetchedRoot]);

  const myPerms = getMyCommunityPermissions(roles, members, user.id, user.platformRole);
  const canManage = hasPermission(myPerms, 'MANAGE_MESSAGES');
  const locked = !!root?.archived;
  const sleeping = !locked && !!root?.threadArchivedAt;

  // Carrega raiz + respostas. A "sala" do tópico só existe enquanto o
  // painel está aberto (addMessage ignora sala que não existe).
  useEffect(() => {
    let alive = true;
    const store = useStore.getState();
    store.setRoomMessages(roomKey, []);
    setStatus('loading');
    stickRef.current = true;
    listMessages({ channelId: channel.id, threadId })
      .then((d) => {
        if (!alive) return;
        const [first, ...rest] = d.messages || [];
        if (first?.id === threadId) {
          setFetchedRoot(first);
          useStore.getState().setRoomMessages(roomKey, rest);
        } else {
          useStore.getState().setRoomMessages(roomKey, d.messages || []);
        }
        setStatus('ready');
      })
      .catch((err) => { if (alive) setStatus(err?.response?.status === 404 ? 'gone' : 'error'); });
    return () => {
      alive = false;
      // Libera a memória da sala do tópico.
      useStore.setState((s) => {
        if (!s.messagesByRoom[roomKey]) return {};
        const next = { ...s.messagesByRoom };
        delete next[roomKey];
        return { messagesByRoom: next };
      });
    };
  }, [threadId, channel.id, roomKey]);

  // Foco no campo ao abrir (computador) e Esc fecha.
  useEffect(() => {
    if (!window.matchMedia?.('(max-width: 900px)').matches) requestAnimationFrame(() => inputRef.current?.focus());
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.modal-overlay')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [threadId, onClose]);

  // Acompanha o fim da lista quando chegam respostas novas.
  useEffect(() => {
    const list = listRef.current;
    if (list && stickRef.current) list.scrollTop = list.scrollHeight;
  }, [replies.length, status]);
  const onScroll = () => {
    const list = listRef.current;
    if (list) stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  };

  const addFiles = (incoming) => {
    const list = Array.from(incoming || []).slice(0, MAX_FILES);
    if (list.length) setFiles((prev) => [...prev, ...list].slice(0, MAX_FILES));
  };

  const send = async (e) => {
    e?.preventDefault();
    const text = content.trim();
    if ((!text && !files.length) || sending || locked) return;
    setSending(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('channelId', channel.id);
      fd.append('threadId', threadId);
      if (text) fd.append('content', text);
      if (replyTo) fd.append('replyToId', replyTo.id);
      files.forEach((f) => fd.append('attachments', f));
      const { message } = await sendMessage(fd);
      if (message) useStore.getState().addMessage(roomKey, message);
      setContent('');
      setFiles([]);
      setReplyTo(null);
      stickRef.current = true;
      if (sleeping) setFetchedRoot((r) => (r ? { ...r, threadArchivedAt: null } : r));
    } catch (err) {
      setError(err?.response?.data?.error || 'Não deu pra enviar. Tente de novo.');
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const toggleArchive = async () => {
    try {
      const { message } = await toggleArchiveTopic(threadId);
      if (message) setFetchedRoot(message);
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não deu pra mudar o tópico agora.');
    }
  };

  const rows = useMemo(() => {
    let lastAuthor = null;
    let lastTime = 0;
    return replies.map((m) => {
      const t = new Date(m.createdAt).getTime();
      const showAuthor = !!m.replyTo || m.authorId !== lastAuthor || t - lastTime > GROUP_WINDOW_MS;
      lastAuthor = m.authorId;
      lastTime = t;
      return (
        <Fragment key={m.nonce || m.id}>
          <Message message={m} showAuthor={showAuthor} onReply={setReplyTo} inThread />
        </Fragment>
      );
    });
  }, [replies]);

  const parent = root?.replyTo;
  const count = Math.max(root?.threadReplyCount || 0, replies.length);

  return (
    <aside className="thread-panel" role="complementary" aria-label={`Tópico ${root?.title || ''}`}>
      <header className="thread-panel-head">
        <span className="thread-panel-icon"><FeatureIcon name={locked ? 'lock' : 'thread'} size={18} /></span>
        <div className="thread-panel-title">
          <h3 className="truncate" title={root?.title}>{root?.title || 'Tópico'}</h3>
          <small className="truncate">
            #{channel.name} · {threadReplyLabel(count)}
            {locked && ' · trancado'}
            {sleeping && ' · arquivado'}
          </small>
        </div>
        {canManage && root && (
          <button
            type="button" className="icon-btn thread-panel-btn"
            onClick={toggleArchive}
            title={locked || sleeping ? 'Reabrir tópico' : 'Trancar tópico'}
            aria-label={locked || sleeping ? 'Reabrir tópico' : 'Trancar tópico'}
          >
            <FeatureIcon name={locked || sleeping ? 'unarchive' : 'archive'} />
          </button>
        )}
        <button type="button" className="icon-btn thread-panel-btn" onClick={onClose} title="Fechar tópico (Esc)" aria-label="Fechar tópico">
          <FeatureIcon name="close" />
        </button>
      </header>

      <div className="thread-panel-list" ref={listRef} onScroll={onScroll}>
        {parent && (
          <div className="thread-panel-origin">
            <span className="thread-panel-origin-label">Começou a partir de</span>
            <button type="button" className="thread-panel-origin-card" onClick={() => onJumpToParent?.(parent)} title="Ir para a mensagem original">
              <UserAvatar user={parent.author} size={28} />
              <span className="thread-panel-origin-body">
                <span className="thread-panel-origin-meta">
                  <b className="truncate">{parent.author?.displayName || 'Alguém'}</b>
                  <time dateTime={parent.createdAt}>{formatMessageTime(parent.createdAt)}</time>
                </span>
                <span className="thread-panel-origin-text">{(parent.content || '').slice(0, 280) || (parent.deleted ? 'Mensagem apagada' : '📎 Anexo')}</span>
              </span>
            </button>
          </div>
        )}
        <div className="thread-panel-sep" role="separator"><span>{threadReplyLabel(count)}</span></div>
        {status === 'loading' && <div className="thread-panel-empty">Carregando respostas…</div>}
        {status === 'error' && <div className="thread-panel-empty">Não deu pra carregar o tópico. Feche e abra de novo.</div>}
        {status === 'gone' && <div className="thread-panel-empty">Este tópico não existe mais.</div>}
        {status === 'ready' && replies.length === 0 && (
          <div className="thread-panel-empty">
            <FeatureIcon name="thread" size={28} />
            <span>Nenhuma resposta ainda. Comece a conversa!</span>
          </div>
        )}
        {rows}
      </div>

      <footer className="thread-panel-composer">
        {locked ? (
          <div className="thread-panel-notice"><FeatureIcon name="lock" size={15} /> A moderação trancou este tópico — não dá pra responder.</div>
        ) : (
          <>
            {sleeping && <div className="thread-panel-notice is-soft"><FeatureIcon name="archive" size={15} /> Arquivado por inatividade — enviar uma mensagem reabre o tópico.</div>}
            {replyTo && (
              <div className="thread-panel-replying">
                <FeatureIcon name="reply" size={14} />
                <span className="truncate">Respondendo a <b>{replyTo.author?.displayName}</b></span>
                <button type="button" className="icon-btn" onClick={() => setReplyTo(null)} aria-label="Cancelar resposta"><FeatureIcon name="close" size={14} /></button>
              </div>
            )}
            {files.length > 0 && (
              <ul className="thread-panel-files">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    <span className="truncate">{f.name}</span>
                    <button type="button" className="icon-btn" aria-label={`Remover ${f.name}`} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}><FeatureIcon name="close" size={12} /></button>
                  </li>
                ))}
              </ul>
            )}
            <form className="thread-panel-form" onSubmit={send}>
              <button type="button" className="icon-btn thread-panel-attach" onClick={() => fileRef.current?.click()} title="Anexar arquivo" aria-label="Anexar arquivo">
                <FeatureIcon name="attach" />
              </button>
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              <textarea
                ref={inputRef}
                rows={1}
                value={content}
                maxLength={8000}
                placeholder={`Responder em ${root?.title ? `“${root.title}”` : 'tópico'}`}
                aria-label="Mensagem do tópico"
                onChange={(e) => setContent(e.target.value)}
                onPaste={(e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
                  if (e.key === 'Escape' && replyTo) { e.stopPropagation(); setReplyTo(null); }
                }}
              />
              <button type="submit" className="icon-btn thread-panel-send" disabled={sending || (!content.trim() && !files.length)} aria-label="Enviar">
                <FeatureIcon name="send" />
              </button>
            </form>
            {error && <p className="form-error" role="alert">{error}</p>}
          </>
        )}
      </footer>
    </aside>
  );
}

// Botão "Tópicos" do cabeçalho do canal: lista os tópicos ativos e os
// arquivados do canal; clicar abre o painel.
export function ThreadsButton({ channelId }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    setData(null);
    listThreads(channelId).then((d) => setData(d.threads || [])).catch(() => setData([]));
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open, channelId]);
  const pick = (t) => {
    useStore.getState().setOpenThread({ id: t.id, channelId: t.channelId, root: t });
    setOpen(false);
  };
  const active = (data || []).filter((t) => !isThreadArchived(t));
  const archived = (data || []).filter((t) => isThreadArchived(t));
  return (
    <div className="threads-btn-wrap" ref={ref}>
      <button
        type="button" className={`icon-btn chat-header-btn ${open ? 'on' : ''}`}
        onClick={() => setOpen((v) => !v)} title="Tópicos" aria-label="Tópicos" aria-expanded={open}
      >
        <FeatureIcon name="thread" size={20} />
      </button>
      {open && (
        <div className="threads-popover" role="dialog" aria-label="Tópicos do canal">
          <header><FeatureIcon name="thread" size={16} /><strong>Tópicos</strong></header>
          {!data && <p className="threads-popover-empty">Carregando…</p>}
          {data && data.length === 0 && (
            <p className="threads-popover-empty">Nenhum tópico neste canal ainda. Clique com o botão direito numa mensagem → <b>Criar tópico</b>.</p>
          )}
          {active.length > 0 && <h4>Ativos</h4>}
          {active.map((t) => <ThreadCard key={t.id} thread={t} onOpen={pick} />)}
          {archived.length > 0 && <h4>Arquivados</h4>}
          {archived.map((t) => <ThreadCard key={t.id} thread={t} onOpen={pick} compact />)}
        </div>
      )}
    </div>
  );
}
