import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useStore } from '../store/useStore';
import IconGlyph from '../components/IconGlyph.jsx';
import emptyIcon from '../assets/icons/nav-empty.png';
import linkIcon from '../assets/icons/nav-link.png';
import {
  createCommunity, listPosts, createPost, uploadCommunityIconForSlug, uploadPostImage, votePost,
} from '../api/endpoints';
import { proxyImage } from '../utils/imageProxy';

// Feeds — página principal, lista os posts de todos os Clubes. Um Clube é
// uma categoria principal criada só pela staff (ver AdminPanel.jsx →
// "Estrutura da comunidade" → Cargos/Canais, e agora também a criação
// inline aqui embaixo pra quem já é staff); dentro de cada Clube existem
// categorias de post (Discussão, Meme, Dúvida...) também geridas só pela
// staff. Todo post precisa de um Clube + uma categoria escolhidos.
const SORTS = [
  { key: 'hot', label: '🔥 Relevantes' },
  { key: 'new', label: '🆕 Novos' },
  { key: 'top', label: '⬆️ Melhores' },
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

  const onVote = async (post, value) => {
    // Otimista: atualiza a tela na hora, sem esperar o servidor.
    const nextMyVote = post.myVote === value ? 0 : value;
    const delta = nextMyVote - post.myVote;
    setPosts((list) => list.map((p) => (p.id === post.id ? { ...p, myVote: nextMyVote, score: p.score + delta } : p)));
    try { await votePost(post.id, value); } catch { refreshPosts(); }
  };

  return (
    <div className="communities-page">
      <div className="communities-feed-col">
        <div className="communities-feed-header">
          <div className="communities-sort-tabs">
            {SORTS.map((s) => (
              <button key={s.key} className={`communities-sort-tab ${sort === s.key ? 'active' : ''}`} onClick={() => setSort(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
          <button className="btn-primary" onClick={() => setShowCreatePost(true)} disabled={clubs.length === 0}>+ Criar post</button>
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
            <p className="dim">Seja o primeiro a postar em algum Clube.</p>
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
          <h4>Clubes</h4>
          {isStaff && (
            <button className="btn-secondary communities-create-btn" onClick={() => setShowCreateClub(true)}>+ Criar Clube</button>
          )}
          {showCreateClub && (
            <CreateClubForm onClose={() => setShowCreateClub(false)} />
          )}
          <div className="communities-sidebar-list">
            {clubs.map((c) => (
              <ClubRow key={c.id} club={c} onOpen={() => navigate(`/comunidades/${c.slug}`)} />
            ))}
            {clubs.length === 0 && <p className="dim" style={{ padding: '8px 4px' }}>Nenhum Clube criado ainda.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PostCard({ post, onVote, onOpen }) {
  return (
    <div className="post-card">
      <div className="post-card-votes">
        <button className={`post-vote-btn up ${post.myVote === 1 ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); onVote(post, 1); }}>▲</button>
        <span className="post-vote-score">{post.score}</span>
        <button className={`post-vote-btn down ${post.myVote === -1 ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); onVote(post, -1); }}>▼</button>
      </div>
      <div className="post-card-body" onClick={onOpen}>
        <div className="post-card-meta">
          <span className="post-card-community">{post.community.name}</span>
          {post.category && (
            <span className="post-card-category">
              {post.category.iconUrl && <img className="post-card-category-icon" src={proxyImage(post.category.iconUrl)} alt="" />}
              {post.category.name}
            </span>
          )}
          <span className="dim">· por {post.author.displayName}</span>
        </div>
        <div className="post-card-title">{post.title}</div>
        {post.type === 'TEXT' && post.content && <div className="post-card-text-preview">{post.content}</div>}
        {post.type === 'IMAGE' && post.imageUrl && <img className="post-card-image" src={proxyImage(post.imageUrl)} alt="" loading="lazy" />}
        {post.type === 'LINK' && <div className="post-card-link"><IconGlyph src={linkIcon} size={13} /> {post.linkUrl}</div>}
        <div className="post-card-footer">💬 {post.commentCount} comentário{post.commentCount === 1 ? '' : 's'}</div>
      </div>
    </div>
  );
}

function ClubRow({ club, onOpen }) {
  return (
    <button className="community-row" onClick={onOpen}>
      <span className="community-row-icon">{club.iconUrl ? <img src={proxyImage(club.iconUrl)} alt="" /> : '📌'}</span>
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
        try { await uploadCommunityIconForSlug(community.slug, iconFile); } catch { /* logo é opcional — Clube já foi criado */ }
      }
      // Não precisa atualizar o estado local aqui — o evento de socket
      // "club:new" (ver SocketContext.jsx) já escreve no store global
      // assim que o servidor confirma, então a lista atualiza sozinha
      // tanto aqui quanto na barra lateral, em tempo real.
      onClose();
    } catch (err) { setError(err.response?.data?.error || 'Não foi possível criar o Clube.'); }
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
    if (!categoryId) { setError('Escolha uma categoria dentro do Clube.'); return; }
    if (type === 'IMAGE' && (!imageFile?.url || uploadingImage)) { setError('Espere a imagem terminar de enviar.'); return; }
    try {
      const { post } = await createPost({
        communitySlug, categoryId, title, type, content,
        imageUrl: type === 'IMAGE' ? imageFile.url : undefined,
        linkUrl,
      });
      onCreated(post);
    } catch (err) { setError(err.response?.data?.error || 'Não foi possível publicar o post.'); }
  };

  if (clubs.length === 0) {
    return (
      <div className="settings-block communities-inline-form">
        <p className="dim">Ainda não existe nenhum Clube — peça pra staff criar um antes de postar.</p>
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
        {[['TEXT', 'Texto'], ['IMAGE', 'Imagem'], ['LINK', 'Link']].map(([k, l]) => (
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
      {error && <div className="auth-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn-link" onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn-primary" disabled={uploadingImage}>Publicar</button>
      </div>
    </form>
  );
}
