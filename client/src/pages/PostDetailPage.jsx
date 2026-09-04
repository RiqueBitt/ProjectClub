import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useElementHeight } from '../utils/useElementHeight';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { useStore } from '../store/useStore';
import UserAvatar from '../components/UserAvatar.jsx';
import EmojiPicker from '../components/EmojiPicker.jsx';
import GifPicker from '../components/GifPicker.jsx';
import IconGlyph from '../components/IconGlyph.jsx';
import linkIcon from '../assets/icons/nav-link.png';
import {
  getPost, deletePost, votePost,
  listPostComments, addPostComment, votePostComment, deletePostComment,
} from '../api/endpoints';
import { proxyImage } from '../utils/imageProxy';

// Reconhece se um comentário é só um link de imagem/GIF (colado a mão ou
// escolhido no seletor de GIF abaixo) pra renderizar como imagem em vez
// de texto puro — comentários não têm campo de anexo próprio (são só
// texto), então isso é o jeito mais simples de "mandar GIF" funcionar de
// verdade sem precisar mudar o schema do banco.
const IMAGE_URL_RE = /^https?:\/\/\S+\.(gif|png|jpe?g|webp)(\?\S*)?$/i;

// NOVO (fusão com o Reddit clone — item 2): página de post individual,
// com comentários aninhados (respostas de respostas, como o Reddit).
export default function PostDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { socket } = useSocket() || {};
  // Item pedido: "menu fica em cima da barra de escrever" (mobile
  // usa isso via CSS — --composer-height) — mede a altura real do
  // formulário de comentário.
  const [commentFormRef, commentFormHeight] = useElementHeight();
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState(null);
  const [newComment, setNewComment] = useState('');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  // Item pedido: "o menu está muito pra esquerda e muito largo" — mede
  // a posição real do botão que abriu o popover (mesmo padrão já usado
  // em ChatWindow.jsx e no reaction picker de Message.jsx), em vez de
  // tentar inferir onde uma coluna termina.
  const commentGifBtnRef = useRef(null);
  const commentEmojiBtnRef = useRef(null);
  const [commentPickerStyle, setCommentPickerStyle] = useState(null);
  useEffect(() => {
    if (!gifPickerOpen && !emojiPickerOpen) { setCommentPickerStyle(null); return; }
    if (window.matchMedia('(max-width: 600px)').matches) { setCommentPickerStyle(null); return; }
    const btn = gifPickerOpen ? commentGifBtnRef.current : commentEmojiBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const estimatedHeight = Math.min(window.innerHeight * 0.4, window.innerHeight - 24);
    let bottom = window.innerHeight - rect.top + 8;
    if (window.innerHeight - bottom - estimatedHeight < 8) bottom = Math.max(8, window.innerHeight - estimatedHeight - 8);
    let right = window.innerWidth - rect.right;
    const width = Math.min(380, window.innerWidth - 32);
    if (window.innerWidth - right - width < 8) right = Math.max(8, window.innerWidth - width - 8);
    setCommentPickerStyle({ position: 'fixed', bottom: `${bottom}px`, right: `${right}px`, left: 'auto', top: 'auto', transform: 'none', width: `${width}px`, maxWidth: `${width}px` });
  }, [gifPickerOpen, emojiPickerOpen]);

  const refreshPost = () => getPost(id).then((d) => setPost(d.post)).catch(() => setPost(false));
  const refreshComments = () => listPostComments(id).then((d) => setComments(d.comments));

  useEffect(() => { refreshPost(); refreshComments(); }, [id]);

  useEffect(() => {
    if (!socket) return;
    const onVote = (data) => { if (data.postId === id) setPost((p) => (p ? { ...p, score: data.score } : p)); };
    const onNewComment = (data) => { if (data.postId === id) refreshComments(); };
    const onCommentVote = (data) => { if (data.postId === id) refreshComments(); };
    const onCommentDelete = (data) => { if (data.postId === id) refreshComments(); };
    socket.on('post:vote', onVote);
    socket.on('post:comment', onNewComment);
    socket.on('post:comment-vote', onCommentVote);
    socket.on('post:comment-delete', onCommentDelete);
    return () => {
      socket.off('post:vote', onVote);
      socket.off('post:comment', onNewComment);
      socket.off('post:comment-vote', onCommentVote);
      socket.off('post:comment-delete', onCommentDelete);
    };
  }, [socket, id]);

  const onVotePost = async (value) => {
    const nextMyVote = post.myVote === value ? 0 : value;
    const delta = nextMyVote - post.myVote;
    setPost((p) => ({ ...p, myVote: nextMyVote, score: p.score + delta }));
    try { await votePost(id, value); } catch { refreshPost(); }
  };

  const onDeletePost = async () => {
    if (!confirm('Excluir este post?')) return;
    await deletePost(id);
    navigate('/comunidades');
  };

  const submitComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    await addPostComment(id, newComment.trim());
    setNewComment('');
    refreshComments();
  };

  const insertCommentEmoji = (text) => setNewComment((c) => `${c}${text}`);
  const sendCommentGif = async (url) => {
    setGifPickerOpen(false);
    await addPostComment(id, url);
    refreshComments();
  };

  if (post === false) return <div className="post-detail-page"><p className="dim">Post não encontrado.</p></div>;
  if (!post) return <div className="post-detail-page"><p className="dim">Carregando...</p></div>;

  const isStaff = ['ADMIN', 'MODERATOR'].includes(user.platformRole);
  const canDelete = post.authorId === user.id || isStaff;

  return (
    <div className="post-detail-page">
      <button className="btn-link" onClick={() => navigate(-1)}>‹ Voltar</button>

      <div className="post-detail-card">
        <div className="post-card-votes">
          <button className={`post-vote-btn up ${post.myVote === 1 ? 'active' : ''}`} onClick={() => onVotePost(1)}>▲</button>
          <span className="post-vote-score">{post.score}</span>
          <button className={`post-vote-btn down ${post.myVote === -1 ? 'active' : ''}`} onClick={() => onVotePost(-1)}>▼</button>
        </div>
        <div className="post-detail-body">
          <div className="post-card-meta">
            <span className="post-card-community">{post.community.name}</span>
            {post.category && (
              <span className="post-card-category">
                {post.category.iconUrl && <img className="post-card-category-icon" src={proxyImage(post.category.iconUrl)} alt="" />}
                {post.category.name}
              </span>
            )}
            <span className="dim">· por {post.author.displayName}</span>
            {canDelete && <button className="btn-link danger post-detail-delete" onClick={onDeletePost}>Excluir</button>}
          </div>
          <h2 className="post-detail-title">{post.title}</h2>
          {post.type === 'TEXT' && post.content && <p className="post-detail-text">{post.content}</p>}
          {post.type === 'IMAGE' && post.imageUrl && <img className="post-detail-image" src={proxyImage(post.imageUrl)} alt="" />}
          {post.type === 'LINK' && <a className="post-card-link" href={post.linkUrl} target="_blank" rel="noreferrer"><IconGlyph src={linkIcon} size={13} /> {post.linkUrl}</a>}
        </div>
      </div>

      <form onSubmit={submitComment} className="post-comment-form" ref={commentFormRef}>
        <input value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Escreva um comentário..." maxLength={5000} />
        <div className="composer-picker-anchor">
          <button ref={commentGifBtnRef} type="button" className="icon-btn" title="GIF" onClick={() => { setGifPickerOpen((v) => !v); setEmojiPickerOpen(false); }}>GIF</button>
          {gifPickerOpen && createPortal(
            <GifPicker onPick={sendCommentGif} onClose={() => setGifPickerOpen(false)} style={{ '--composer-height': `${commentFormHeight}px`, ...(commentPickerStyle || {}) }} />,
            document.body,
          )}
        </div>
        <div className="composer-picker-anchor">
          <button ref={commentEmojiBtnRef} type="button" className="icon-btn" title="Emoji" onClick={() => { setEmojiPickerOpen((v) => !v); setGifPickerOpen(false); }}>☺</button>
          {emojiPickerOpen && createPortal(
            <EmojiPicker
              variant="composer-centered"
              style={{ '--composer-height': `${commentFormHeight}px`, ...(commentPickerStyle || {}) }}
              serverEmojis={useStore.getState().usableEmojis}
              onPick={insertCommentEmoji}
              onClose={() => setEmojiPickerOpen(false)}
            />,
            document.body,
          )}
        </div>
        <button type="submit" className="btn-primary">Comentar</button>
      </form>

      <div className="post-comment-tree">
        {!comments ? <p className="dim">Carregando comentários...</p> : comments.length === 0 ? (
          <p className="dim" style={{ padding: '16px 0' }}>Nenhum comentário ainda — seja o primeiro.</p>
        ) : comments.map((c) => (
          <CommentNode key={c.id} comment={c} postId={id} user={user} isStaff={isStaff} onChange={refreshComments} />
        ))}
      </div>
    </div>
  );
}

function CommentNode({ comment, postId, user, isStaff, onChange, depth = 0 }) {
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyEmojiOpen, setReplyEmojiOpen] = useState(false);
  const [replyGifOpen, setReplyGifOpen] = useState(false);
  const [localVote, setLocalVote] = useState(comment.myVote);
  const [localScore, setLocalScore] = useState(comment.score);
  // Item pedido: "menu fica em cima da barra de escrever" (mobile
  // usa isso via CSS — --composer-height) — mede a altura real do
  // formulário de resposta.
  const [replyFormRef, replyFormHeight] = useElementHeight();
  // Item pedido: "o menu está muito pra esquerda e muito largo" —
  // mede a posição real do botão que abriu o popover (mesmo padrão
  // já usado em ChatWindow.jsx), em vez de tentar inferir onde uma
  // coluna termina.
  const replyGifBtnRef = useRef(null);
  const replyEmojiBtnRef = useRef(null);
  const [replyPickerStyle, setReplyPickerStyle] = useState(null);
  useEffect(() => {
    if (!replyGifOpen && !replyEmojiOpen) { setReplyPickerStyle(null); return; }
    if (window.matchMedia('(max-width: 600px)').matches) { setReplyPickerStyle(null); return; }
    const btn = replyGifOpen ? replyGifBtnRef.current : replyEmojiBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const estimatedHeight = Math.min(window.innerHeight * 0.4, window.innerHeight - 24);
    let bottom = window.innerHeight - rect.top + 8;
    if (window.innerHeight - bottom - estimatedHeight < 8) bottom = Math.max(8, window.innerHeight - estimatedHeight - 8);
    let right = window.innerWidth - rect.right;
    const width = Math.min(380, window.innerWidth - 32);
    if (window.innerWidth - right - width < 8) right = Math.max(8, window.innerWidth - width - 8);
    setReplyPickerStyle({ position: 'fixed', bottom: `${bottom}px`, right: `${right}px`, left: 'auto', top: 'auto', transform: 'none', width: `${width}px`, maxWidth: `${width}px` });
  }, [replyGifOpen, replyEmojiOpen]);

  const vote = async (value) => {
    const nextMyVote = localVote === value ? 0 : value;
    const delta = nextMyVote - localVote;
    setLocalVote(nextMyVote);
    setLocalScore((s) => s + delta);
    try { await votePostComment(comment.id, value); } catch { onChange(); }
  };

  const submitReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    await addPostComment(postId, replyText.trim(), comment.id);
    setReplyText('');
    setReplying(false);
    onChange();
  };
  const insertReplyEmoji = (text) => setReplyText((t) => `${t}${text}`);
  const sendReplyGif = async (url) => {
    setReplyGifOpen(false);
    await addPostComment(postId, url, comment.id);
    setReplying(false);
    onChange();
  };

  const remove = async () => {
    if (!confirm('Excluir este comentário?')) return;
    await deletePostComment(comment.id);
    onChange();
  };

  const canDelete = !comment.deleted && (comment.authorId === user.id || isStaff);

  return (
    <div className="post-comment-node" style={{ marginLeft: depth > 0 ? 22 : 0 }}>
      <div className="post-comment-votes">
        <button className={`post-vote-btn up small ${localVote === 1 ? 'active' : ''}`} onClick={() => vote(1)} disabled={comment.deleted}>▲</button>
        <span className="post-vote-score small">{localScore}</span>
        <button className={`post-vote-btn down small ${localVote === -1 ? 'active' : ''}`} onClick={() => vote(-1)} disabled={comment.deleted}>▼</button>
      </div>
      <div className="post-comment-body">
        <div className="post-comment-meta">
          <UserAvatar user={comment.author} size={20} />
          <span className="post-comment-author">{comment.author.displayName}</span>
          <span className="dim">{new Date(comment.createdAt).toLocaleString('pt-BR')}</span>
        </div>
        {!comment.deleted && IMAGE_URL_RE.test(comment.content.trim())
          ? <img className="post-comment-gif" src={comment.content.trim()} alt="" />
          : <div className={`post-comment-content ${comment.deleted ? 'dim' : ''}`}>{comment.content}</div>}
        {!comment.deleted && (
          <div className="post-comment-actions">
            <button className="btn-link" onClick={() => setReplying((v) => !v)}>Responder</button>
            {canDelete && <button className="btn-link danger" onClick={remove}>Excluir</button>}
          </div>
        )}
        {replying && (
          <form onSubmit={submitReply} className="post-comment-form nested" ref={replyFormRef}>
            <input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Escreva uma resposta..." maxLength={5000} autoFocus />
            <div className="composer-picker-anchor">
              <button ref={replyGifBtnRef} type="button" className="icon-btn" title="GIF" onClick={() => { setReplyGifOpen((v) => !v); setReplyEmojiOpen(false); }}>GIF</button>
              {replyGifOpen && createPortal(
                <GifPicker onPick={sendReplyGif} onClose={() => setReplyGifOpen(false)} style={{ '--composer-height': `${replyFormHeight}px`, ...(replyPickerStyle || {}) }} />,
                document.body,
              )}
            </div>
            <div className="composer-picker-anchor">
              <button ref={replyEmojiBtnRef} type="button" className="icon-btn" title="Emoji" onClick={() => { setReplyEmojiOpen((v) => !v); setReplyGifOpen(false); }}>☺</button>
              {replyEmojiOpen && createPortal(
                <EmojiPicker
                  variant="composer-centered"
                  style={{ '--composer-height': `${replyFormHeight}px`, ...(replyPickerStyle || {}) }}
                  serverEmojis={useStore.getState().usableEmojis}
                  onPick={insertReplyEmoji}
                  onClose={() => setReplyEmojiOpen(false)}
                />,
                document.body,
              )}
            </div>
            <button type="submit" className="btn-primary">Enviar</button>
          </form>
        )}
        {comment.replies?.length > 0 && (
          <div className="post-comment-replies">
            {comment.replies.map((r) => (
              <CommentNode key={r.id} comment={r} postId={postId} user={user} isStaff={isStaff} onChange={onChange} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
