import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useStore } from '../store/useStore';
import IconGlyph from '../components/IconGlyph.jsx';
import emptyIcon from '../assets/icons/nav-empty.png';
import {
  createCommunity, listPosts, createPost, uploadCommunityIconForSlug, uploadPostImage, votePost,
} from '../api/endpoints';
import { proxyImage } from '../utils/imageProxy';
import UserAvatar from '../components/UserAvatar.jsx';
import { useLiveRefresh } from '../utils/liveRefresh';
import FeedPoll from '../components/FeedPoll.jsx';

// Feeds — página principal, lista os posts de todos os Temas. Um Tema é
// uma categoria principal criada só pela staff (ver AdminPanel.jsx →
// "Estrutura da comunidade" → Cargos/Canais, e agora também a criação
// inline aqui embaixo pra quem já é staff); dentro de cada Tema existem
// categorias de post (Discussão, Meme, Dúvida...) também geridas só pela
// staff. Todo post precisa de um Tema + uma categoria escolhidos.
const SORTS = [
  { key: 'hot', icon: 'hot', label: 'Relevantes' },
  { key: 'new', icon: 'new', label: 'Novos' },
  { key: 'top', icon: 'top', label: 'Melhores' },
];

export default function CommunitiesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isStaff = user.platformRole === 'ADMIN' || user.platformRole === 'MODERATOR';
  const clubs = useStore((s) => s.clubs); // fonte única, já em tempo real via socket (ver SocketContext.jsx)
  const [sort, setSort] = useState('hot');
  const [posts, setPosts] = useState(null);
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [showCreateClub, setShowCreateClub] = useState(false);

  const refreshPosts = () => listPosts({ sort }).then((d) => setPosts(d.posts));
  useEffect(() => { refreshPosts(); }, [sort]);

  // Tempo real (11s): feed na ordenação escolhida (votos/novos posts).
  useLiveRefresh(({ put }) => listPosts({ sort }).then((d) => put(setPosts)(d.posts)), { enabled: posts !== null, key: sort });

  const onVote = async (post, value) => {
    // Otimista: atualiza a tela na hora, sem esperar o servidor.
    const nextMyVote = post.myVote === value ? 0 : value;
    const delta = nextMyVote - post.myVote;
    setPosts((list) => list.map((p) => (p.id === post.id ? { ...p, myVote: nextMyVote, score: p.score + delta } : p)));
    try { await votePost(post.id, value); } catch { refreshPosts(); }
  };

  return (
    <div className="communities-page">
      <header className="feeds-hero">
        <div>
          <h1>Fórum</h1>
          <p>Posts da comunidade, organizados por Temas.</p>
        </div>
        <button className="feeds-create" onClick={() => setShowCreatePost(true)} disabled={clubs.length === 0}>
          <FeedIcon name="plus" /> Criar post
        </button>
      </header>
      <div className="communities-feed-col">
        <div className="feeds-toolbar" role="tablist" aria-label="Ordenar posts">
          {SORTS.map((s) => (
            <button
              key={s.key} role="tab" aria-selected={sort === s.key}
              className={`feeds-sort${sort === s.key ? ' active' : ''}`} onClick={() => setSort(s.key)}
            >
              <FeedIcon name={s.icon} size={15} /> {s.label}
            </button>
          ))}
        </div>

        {showCreatePost && (
          <CreatePostForm
            clubs={clubs}
            onClose={() => setShowCreatePost(false)}
            onCreated={(post) => { setPosts((list) => [post, ...(list || [])]); setShowCreatePost(false); }}
          />
        )}

        {!posts ? <p className="dim">Carregando...</p> : posts.length === 0 ? (
          <div className="support-empty-state">
            <div className="support-empty-state-icon"><IconGlyph src={emptyIcon} size={40} /></div>
            <h3>Nenhum post ainda</h3>
            <p className="dim">Seja o primeiro a postar em algum Tema.</p>
          </div>
        ) : (
          <div className="post-card-list">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} onVote={onVote} onOpen={() => navigate(`/posts/${post.id}`)} />
            ))}
          </div>
        )}
      </div>

      <div className="communities-sidebar-col">
        <div className="communities-sidebar-card">
          <div className="feeds-side-head">
            <h4>Temas</h4>
            {isStaff && (
              <button className="feeds-side-add" onClick={() => setShowCreateClub(true)} title="Criar Tema" aria-label="Criar Tema">
                <FeedIcon name="plus" size={15} />
              </button>
            )}
          </div>
          {showCreateClub && (
            <CreateClubForm onClose={() => setShowCreateClub(false)} />
          )}
          <div className="communities-sidebar-list">
            {clubs.map((c) => (
              <ClubRow key={c.id} club={c} onOpen={() => navigate(`/comunidades/${c.slug}`)} />
            ))}
            {clubs.length === 0 && <p className="dim" style={{ padding: '8px 4px' }}>Nenhum Tema criado ainda.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Ícones dos Feeds (SVG, herdam a cor) — sem emoji, que some no Linux.
const FEED_ICONS = {
  up: 'M12 5 5 13h4.5v6h5v-6H19L12 5Z',
  down: 'M12 19l7-8h-4.5V5h-5v6H5l7 8Z',
  comment: 'M4 5h16v11H8l-4 4V5Z',
  share: 'M15 8a3 3 0 1 0-2.8-4M9 12a3 3 0 1 0 0 .01M15 16a3 3 0 1 0 2.8 4M11.7 10.7l3.6-2M11.7 13.3l3.6 2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  hot: 'M12 3s5 4.5 5 9.5A5 5 0 0 1 7 12.5C7 10 9 8.5 9 8.5s0 2.5 2 3.5c0-4 1-9 1-9Z',
  new: 'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8',
  top: 'M4 17l6-6 4 4 6-7M14 8h6v6',
  plus: 'M12 5v14M5 12h14',
};
export function FeedIcon({ name, size = 16, filled = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={FEED_ICONS[name]} />
    </svg>
  );
}

export function timeAgo(date) {
  if (!date) return '';
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d`;
  return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

// Votos: ▲ placar ▼ numa pílula só (cor muda conforme o seu voto).
export function VotePill({ score, myVote, onVote }) {
  return (
    <div className={`fp-vote${myVote === 1 ? ' is-up' : myVote === -1 ? ' is-down' : ''}`} onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Votar a favor" aria-pressed={myVote === 1} onClick={() => onVote(1)}>
        <FeedIcon name="up" filled={myVote === 1} />
      </button>
      <span className="fp-vote-score">{score}</span>
      <button type="button" aria-label="Votar contra" aria-pressed={myVote === -1} onClick={() => onVote(-1)}>
        <FeedIcon name="down" filled={myVote === -1} />
      </button>
    </div>
  );
}

export function PostCard({ post, onVote, onOpen }) {
  const [copied, setCopied] = useState(false);
  const share = (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(`${window.location.origin}/posts/${post.id}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  };
  const onKey = (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(); };
  return (
    <article className="fp-card" onClick={onOpen} onKeyDown={onKey} tabIndex={0} aria-label={post.title}>
      <header className="fp-card-head">
        <span className="fp-club">
          {post.community.iconUrl
            ? <img src={proxyImage(post.community.iconUrl)} alt="" />
            : <span className="fp-club-fallback">{post.community.name.slice(0, 1)}</span>}
          {post.community.name}
        </span>
        {post.category && (
          <span className="fp-cat">
            {post.category.iconUrl && <img src={proxyImage(post.category.iconUrl)} alt="" />}
            {post.category.name}
          </span>
        )}
        <span className="fp-by">
          <UserAvatar user={post.author} size={18} />
          <span className="truncate">{post.author.displayName}</span>
          {post.createdAt && <time dateTime={post.createdAt}>· {timeAgo(post.createdAt)}</time>}
        </span>
      </header>
      <h3 className="fp-title">{post.title}</h3>
      {post.type === 'TEXT' && post.content && <p className="fp-text">{post.content}</p>}
      {post.type === 'IMAGE' && post.imageUrl && (
        <div className="fp-media"><img src={proxyImage(post.imageUrl)} alt="" loading="lazy" /></div>
      )}
      {post.type === 'LINK' && (
        <span className="fp-link"><FeedIcon name="link" size={14} /> <span className="truncate">{post.linkUrl}</span></span>
      )}
      {post.poll && <FeedPoll postId={post.id} poll={post.poll} compact />}
      <footer className="fp-actions">
        <VotePill score={post.score} myVote={post.myVote} onVote={(v) => onVote(post, v)} />
        <span className="fp-action">
          <FeedIcon name="comment" /> {post.commentCount} <span className="fp-action-label">comentário{post.commentCount === 1 ? '' : 's'}</span>
        </span>
        <button type="button" className="fp-action" onClick={share}>
          <FeedIcon name="share" /> <span className="fp-action-label">{copied ? 'Link copiado' : 'Compartilhar'}</span>
        </button>
      </footer>
    </article>
  );
}

function ClubRow({ club, onOpen }) {
  return (
    <button className="community-row" onClick={onOpen}>
      <span className="community-row-icon">{club.iconUrl ? <img src={proxyImage(club.iconUrl)} alt="" /> : <span className="fp-club-fallback">{club.name.slice(0, 1)}</span>}</span>
      <span className="community-row-info">
        <span className="community-row-name truncate">{club.name}</span>
        <span className="dim community-row-meta">{club.postCount} post{club.postCount === 1 ? '' : 's'}</span>
      </span>
    </button>
  );
}

function CreateClubForm({ onClose }) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [iconFile, setIconFile] = useState(null);
  const [iconPreview, setIconPreview] = useState(null);
  const [error, setError] = useState('');

  const pickIcon = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIconFile(file);
    setIconPreview(URL.createObjectURL(file));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { community } = await createCommunity({ slug, name, description });
      if (iconFile) {
        try { await uploadCommunityIconForSlug(community.slug, iconFile); } catch { /* logo é opcional — Tema já foi criado */ }
      }
      // Não precisa atualizar o estado local aqui — o evento de socket
      // "club:new" (ver SocketContext.jsx) já escreve no store global
      // assim que o servidor confirma, então a lista atualiza sozinha
      // tanto aqui quanto na barra lateral, em tempo real.
      onClose();
    } catch (err) { setError(err.response?.data?.error || 'Não foi possível criar o Tema.'); }
  };

  return (
    <form onSubmit={submit} className="settings-block communities-inline-form">
      <label>
        LOGO (opcional)
        <div className="community-icon-picker-row">
          <span className="community-row-icon community-icon-preview">
            {iconPreview ? <img src={iconPreview} alt="" /> : '📌'}
          </span>
          <label className="btn-secondary">Escolher imagem<input type="file" accept="image/*" hidden onChange={pickIcon} /></label>
        </div>
      </label>
      <label>IDENTIFICADOR<input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="ex: jogos" maxLength={24} required /></label>
      <label>NOME<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></label>
      <label>DESCRIÇÃO<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} /></label>
      {error && <div className="auth-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn-link" onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn-primary">Criar</button>
      </div>
    </form>
  );
}

export function CreatePostForm({ clubs, defaultClubSlug, onClose, onCreated }) {
  const [communitySlug, setCommunitySlug] = useState(defaultClubSlug || clubs[0]?.slug || '');
  const selectedClub = clubs.find((c) => c.slug === communitySlug);
  const [categoryId, setCategoryId] = useState(selectedClub?.categories?.[0]?.id || '');
  const [title, setTitle] = useState('');
  const [type, setType] = useState('TEXT');
  const [content, setContent] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  // Enquete (aba "Enquete"): o título do post vira a pergunta.
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [error, setError] = useState('');

  const changeClub = (slug) => {
    setCommunitySlug(slug);
    const club = clubs.find((c) => c.slug === slug);
    setCategoryId(club?.categories?.[0]?.id || '');
  };

  // Item 6: em vez de pedir uma URL de imagem, deixa escolher um arquivo
  // do computador/celular e já sobe ele na hora (mesma rota validada por
  // magic bytes reais, ver middleware/upload.js), mostrando a prévia
  // antes de publicar de verdade.
  const pickImage = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setUploadingImage(true);
    setError('');
    try {
      const { url } = await uploadPostImage(file);
      setImageFile({ url });
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível enviar a imagem.');
      setImageFile(null);
      setImagePreview(null);
    } finally {
      setUploadingImage(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!categoryId) { setError('Escolha uma categoria dentro do Tema.'); return; }
    if (type === 'IMAGE' && (!imageFile?.url || uploadingImage)) { setError('Espere a imagem terminar de enviar.'); return; }
    const cleanOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (type === 'POLL' && new Set(cleanOptions).size < 2) { setError('A enquete precisa de pelo menos 2 opções diferentes.'); return; }
    try {
      const { post } = await createPost({
        communitySlug, categoryId, title, type: type === 'POLL' ? 'TEXT' : type, content,
        imageUrl: type === 'IMAGE' ? imageFile.url : undefined,
        linkUrl,
        poll: type === 'POLL' ? { options: cleanOptions } : undefined,
      });
      onCreated(post);
    } catch (err) { setError(err.response?.data?.error || 'Não foi possível publicar o post.'); }
  };

  if (clubs.length === 0) {
    return (
      <div className="settings-block communities-inline-form">
        <p className="dim">Ainda não existe nenhum Tema — peça pra staff criar um antes de postar.</p>
        <div className="modal-actions"><button type="button" className="btn-link" onClick={onClose}>Fechar</button></div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="settings-block communities-inline-form">
      <label>CLUBE
        <select value={communitySlug} onChange={(e) => changeClub(e.target.value)} required>
          {clubs.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
      </label>
      <label>CATEGORIA
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
          {(selectedClub?.categories || []).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
        </select>
      </label>
      <label>TÍTULO<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required /></label>
      <div className="post-type-tabs">
        {[['TEXT', 'Texto'], ['IMAGE', 'Imagem'], ['LINK', 'Link'], ['POLL', 'Enquete']].map(([k, l]) => (
          <button key={k} type="button" className={`post-type-tab ${type === k ? 'active' : ''}`} onClick={() => setType(k)}>{l}</button>
        ))}
      </div>
      {type === 'TEXT' && <label>TEXTO (opcional)<textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} maxLength={10000} /></label>}
      {type === 'IMAGE' && (
        <label>
          IMAGEM
          <input type="file" accept="image/*" onChange={pickImage} required={!imagePreview} />
          {imagePreview && (
            <div className="post-image-preview-wrap">
              <img className="post-image-preview" src={imagePreview} alt="" />
              {uploadingImage && <span className="dim">Enviando...</span>}
            </div>
          )}
        </label>
      )}
      {type === 'LINK' && <label>LINK<input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://..." required /></label>}
      {type === 'POLL' && (
        <div className="sx-poll-editor">
          <span className="sx-poll-editor-hint">O título do post vira a pergunta. De 2 a 6 opções.</span>
          {pollOptions.map((opt, i) => (
            <div key={i} className="sx-poll-editor-row">
              <span className="sx-poll-radio" aria-hidden="true" />
              <input
                value={opt} maxLength={100} placeholder={`Opção ${i + 1}`}
                onChange={(e) => setPollOptions((list) => list.map((o, j) => (j === i ? e.target.value : o)))}
              />
              {pollOptions.length > 2 && (
                <button type="button" className="sx-icon-btn" aria-label={`Remover opção ${i + 1}`} onClick={() => setPollOptions((list) => list.filter((_, j) => j !== i))}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              )}
            </div>
          ))}
          {pollOptions.length < 6 && (
            <button type="button" className="sx-btn ghost sm sx-poll-add" onClick={() => setPollOptions((list) => [...list, ''])}>
              <FeedIcon name="plus" size={14} /> Adicionar opção
            </button>
          )}
          <label>TEXTO (opcional)<textarea value={content} onChange={(e) => setContent(e.target.value)} rows={2} maxLength={10000} /></label>
        </div>
      )}
      {error && <div className="auth-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn-link" onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn-primary" disabled={uploadingImage}>Publicar</button>
      </div>
    </form>
  );
}
