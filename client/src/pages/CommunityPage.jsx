import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useStore } from '../store/useStore';
import IconGlyph from '../components/IconGlyph.jsx';
import emptyIcon from '../assets/icons/nav-empty.png';
import { renderRichContent } from '../utils/richTextRender.jsx';
import {
  updateCommunity, uploadCommunityIconForSlug, deleteCommunity, listPosts, votePost,
  createClubCategory, updateClubCategory, uploadClubCategoryImage, deleteClubCategory,
} from '../api/endpoints';
import { PostCard, CreatePostForm } from './CommunitiesPage.jsx';
import { proxyImage } from '../utils/imageProxy';

// Página de UM Clube — lê direto do estado global (useStore.clubs), que já
// é mantido em tempo real via socket (club:new/update/delete e
// club:category:*, ver SocketContext.jsx) — não precisa de fetch próprio
// nem de recarregar a página pra ver uma edição da staff aparecer.
export default function CommunityPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isStaff = user.platformRole === 'ADMIN' || user.platformRole === 'MODERATOR';
  const club = useStore((s) => s.clubs.find((c) => c.slug === slug));
  const [posts, setPosts] = useState(null);
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState(null);

  const refreshPosts = () => listPosts({ communitySlug: slug, sort: 'new' }).then((d) => setPosts(d.posts));
  useEffect(() => { refreshPosts(); }, [slug]);

  const onVote = async (post, value) => {
    const nextMyVote = post.myVote === value ? 0 : value;
    const delta = nextMyVote - post.myVote;
    setPosts((list) => list.map((p) => (p.id === post.id ? { ...p, myVote: nextMyVote, score: p.score + delta } : p)));
    try { await votePost(post.id, value); } catch { refreshPosts(); }
  };

  const onDeleteClub = async () => {
    if (!confirm(`Excluir o Clube "${club.name}"? Isso apaga todos os posts e comentários dele e não pode ser desfeito.`)) return;
    try {
      await deleteCommunity(slug);
      navigate('/comunidades');
    } catch (err) {
      alert(err.response?.data?.error || 'Não foi possível excluir.');
    }
  };

  const addCategory = async () => {
    const name = prompt('Nome da nova categoria:');
    if (!name?.trim()) return;
    try {
      const { category } = await createClubCategory(club.slug, { name: name.trim() });
      setEditingCategoryId(category.id); // já abre o editor completo (ícone/banner/descrição)
    } catch (err) { alert(err.response?.data?.error || 'Não foi possível criar a categoria.'); }
  };

  const removeCategory = async (cat) => {
    if (!confirm(`Excluir a categoria "${cat.name}"?`)) return;
    try { await deleteClubCategory(cat.id); } catch (err) { alert(err.response?.data?.error || 'Não foi possível excluir.'); }
  };

  if (club === undefined) return <div className="community-page"><p className="dim">Carregando...</p></div>;
  if (!club) return <div className="community-page"><p className="dim">Clube não encontrado.</p></div>;

  const editingCategory = (club.categories || []).find((c) => c.id === editingCategoryId);

  return (
    <div className="community-page-layout">
      <div className="community-page-feed-col">
        <button className="btn-link" onClick={() => navigate('/comunidades')}>‹ Todos os Clubes</button>

        <div className="community-page-header">
          <div className="community-page-icon">{club.iconUrl ? <img src={proxyImage(club.iconUrl)} alt="" /> : '📌'}</div>
          <div className="community-page-info">
            <h1>{club.name}</h1>
            {club.description && <p className="dim">{club.description}</p>}
          </div>
        </div>

        {!showCreatePost && (
          <button className="btn-primary communities-create-btn" onClick={() => setShowCreatePost(true)}>+ Criar post</button>
        )}
        {showCreatePost && (
          <CreatePostForm
            clubs={[club]}
            defaultClubSlug={club.slug}
            onClose={() => setShowCreatePost(false)}
            onCreated={(post) => { setPosts((list) => [post, ...(list || [])]); setShowCreatePost(false); }}
          />
        )}

        {!posts ? <p className="dim">Carregando posts...</p> : posts.length === 0 ? (
          <div className="support-empty-state">
            <div className="support-empty-state-icon"><IconGlyph src={emptyIcon} size={40} /></div>
            <h3>Nenhum post ainda</h3>
            <p className="dim">Seja o primeiro a postar aqui.</p>
          </div>
        ) : (
          <div className="post-card-list">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} onVote={onVote} onOpen={() => navigate(`/posts/${post.id}`)} />
            ))}
          </div>
        )}
      </div>

      <div className="community-page-sidebar-col">
        {editing ? (
          <ClubEditForm club={club} onClose={() => setEditing(false)} />
        ) : (
          <div className="communities-sidebar-card community-info-card">
            <h4>Sobre {club.name}</h4>
            {club.description && <p className="community-info-description">{club.description}</p>}
            <div className="community-info-stats-row">
              <div className="community-info-stat"><strong>{club.postCount}</strong><span>post{club.postCount === 1 ? '' : 's'}</span></div>
            </div>
            <p className="dim community-info-created">
              Criado em {new Date(club.createdAt).toLocaleDateString('pt-BR')} por {club.createdBy.displayName}
            </p>
            <div className="community-info-rules">
              <h4>Categorias</h4>
              <div className="club-category-visual-list">
                {(club.categories || []).map((cat) => (
                  <div key={cat.id} className="club-category-visual-card">
                    {cat.bannerUrl && <img className="club-category-visual-banner" src={proxyImage(cat.bannerUrl)} alt="" />}
                    <div className="club-category-visual-body">
                      <span className="club-category-visual-icon">
                        {cat.iconUrl ? <img src={proxyImage(cat.iconUrl)} alt="" /> : '🏷️'}
                      </span>
                      <div className="club-category-visual-text">
                        <span className="club-category-visual-name">{cat.name}</span>
                        {cat.description && <span className="club-category-visual-desc">{renderRichContent(cat.description, {})}</span>}
                      </div>
                      {isStaff && (
                        <span className="club-category-visual-actions">
                          <button type="button" className="btn-link" onClick={() => setEditingCategoryId(cat.id)}>Editar</button>
                          <button type="button" className="btn-link danger" onClick={() => removeCategory(cat)}>Excluir</button>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {isStaff && <button type="button" className="btn-secondary club-category-add-btn" onClick={addCategory}>+ Nova categoria</button>}
            </div>
            {isStaff && (
              <div className="community-info-manage-actions">
                <button className="btn-secondary community-info-edit-btn" onClick={() => setEditing(true)}>Editar Clube</button>
                <button className="btn-danger community-info-delete-btn" onClick={onDeleteClub}>Excluir Clube</button>
              </div>
            )}
          </div>
        )}
      </div>

      {editingCategory && (
        <CategoryEditForm category={editingCategory} onClose={() => setEditingCategoryId(null)} />
      )}
    </div>
  );
}

function ClubEditForm({ club, onClose }) {
  const [name, setName] = useState(club.name);
  const [description, setDescription] = useState(club.description || '');
  const [iconPreview, setIconPreview] = useState(club.iconUrl || null);
  const [iconFile, setIconFile] = useState(null);
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
      await updateCommunity(club.slug, { name, description });
      if (iconFile) await uploadCommunityIconForSlug(club.slug, iconFile);
      // Sem precisar mexer no estado local aqui — os eventos de socket
      // club:update/club:category:* já atualizam o store global sozinhos.
      onClose();
    } catch (err) { setError(err.response?.data?.error || 'Não foi possível salvar.'); }
  };

  return (
    <form onSubmit={submit} className="settings-block communities-inline-form">
      <h4>Editar Clube</h4>
      <label>
        LOGO
        <div className="community-icon-picker-row">
          <span className="community-row-icon community-icon-preview">
            {iconPreview ? <img src={iconPreview} alt="" /> : '📌'}
          </span>
          <label className="btn-secondary">Trocar imagem<input type="file" accept="image/*" hidden onChange={pickIcon} /></label>
        </div>
      </label>
      <label>NOME<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></label>
      <label>DESCRIÇÃO<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={500} /></label>
      {error && <div className="auth-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn-link" onClick={onClose}>Fechar</button>
        <button type="submit" className="btn-primary">Salvar</button>
      </div>
    </form>
  );
}

// Editor completo de UMA categoria — nome, descrição com negrito/
// sublinhado (mesma sintaxe **negrito**/__sublinhado__ do resto do app,
// ver richTextRender.jsx), ícone pequeno e banner grande.
function CategoryEditForm({ category, onClose }) {
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description || '');
  const [iconPreview, setIconPreview] = useState(category.iconUrl || null);
  const [iconFile, setIconFile] = useState(null);
  const [bannerPreview, setBannerPreview] = useState(category.bannerUrl || null);
  const [bannerFile, setBannerFile] = useState(null);
  const [error, setError] = useState('');
  const descRef = useRef(null);

  const pickIcon = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIconFile(file);
    setIconPreview(URL.createObjectURL(file));
  };
  const pickBanner = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setBannerFile(file);
    setBannerPreview(URL.createObjectURL(file));
  };

  // Envolve o texto SELECIONADO na textarea com o marcador (** ou __) —
  // se nada estiver selecionado, insere o marcador vazio no cursor pra
  // continuar digitando dentro dele.
  const wrapSelection = (marker) => {
    const el = descRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const before = description.slice(0, s);
    const middle = description.slice(s, e);
    const after = description.slice(e);
    const next = `${before}${marker}${middle}${marker}${after}`;
    setDescription(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + marker.length, e + marker.length); });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await updateClubCategory(category.id, { name, description });
      if (iconFile) await uploadClubCategoryImage(category.id, 'icon', iconFile);
      if (bannerFile) await uploadClubCategoryImage(category.id, 'banner', bannerFile);
      onClose();
    } catch (err) { setError(err.response?.data?.error || 'Não foi possível salvar.'); }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit} className="modal-box settings-block communities-inline-form" style={{ maxWidth: 480 }}>
        <h4>Editar categoria</h4>

        <label>BANNER (opcional)</label>
        {bannerPreview && <img className="club-category-banner-preview" src={bannerPreview} alt="" />}
        <label className="btn-secondary" style={{ alignSelf: 'flex-start' }}>
          {bannerPreview ? 'Trocar banner' : 'Escolher banner'}<input type="file" accept="image/*" hidden onChange={pickBanner} />
        </label>

        <label>
          ÍCONE (opcional)
          <div className="community-icon-picker-row">
            <span className="community-row-icon community-icon-preview">
              {iconPreview ? <img src={iconPreview} alt="" /> : '🏷️'}
            </span>
            <label className="btn-secondary">Escolher ícone<input type="file" accept="image/*" hidden onChange={pickIcon} /></label>
          </div>
        </label>

        <label>NOME<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required /></label>

        <label>
          DESCRIÇÃO
          <div className="rich-text-toolbar">
            <button type="button" onClick={() => wrapSelection('**')}><b>N</b></button>
            <button type="button" onClick={() => wrapSelection('__')}><u>S</u></button>
          </div>
          <textarea ref={descRef} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} placeholder="Descreva a categoria — use **negrito** ou __sublinhado__" />
        </label>
        {description && (
          <div className="club-category-desc-preview dim">
            Prévia: {renderRichContent(description, {})}
          </div>
        )}

        {error && <div className="auth-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn-link" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary">Salvar</button>
        </div>
      </form>
    </div>
  );
}
