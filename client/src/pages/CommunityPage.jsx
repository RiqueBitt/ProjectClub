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
import { PostCard, CreatePostForm, FeedIcon, TagFilter, PostSkeletons, usePinToggle } from './CommunitiesPage.jsx';
import { updateClubTags } from '../api/contentx';
import { proxyImage } from '../utils/imageProxy';
import { useLiveRefresh } from '../utils/liveRefresh';
import { postPath } from '../utils/prettyLinks';

// Página de UM Tema — lê direto do estado global (useStore.clubs), que já
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
  const [tag, setTag] = useState('');
  const onPin = usePinToggle(setPosts);

  const refreshPosts = () => listPosts({ communitySlug: slug, sort: 'new', tag: tag || undefined }).then((d) => setPosts(d.posts));
  useEffect(() => { setPosts(null); refreshPosts(); }, [slug, tag]);

  // Tempo real (11s): posts do clube.
  useLiveRefresh(({ put }) => listPosts({ communitySlug: slug, sort: 'new', tag: tag || undefined }).then((d) => put(setPosts)(d.posts)), { enabled: posts !== null, key: `${slug}|${tag}` });

  const onVote = async (post, value) => {
    const nextMyVote = post.myVote === value ? 0 : value;
    const delta = nextMyVote - post.myVote;
    setPosts((list) => list.map((p) => (p.id === post.id ? { ...p, myVote: nextMyVote, score: p.score + delta } : p)));
    try { await votePost(post.id, value); } catch { refreshPosts(); }
  };

  const onDeleteClub = async () => {
    if (!confirm(`Excluir o Tema "${club.name}"? Isso apaga todos os posts e comentários dele e não pode ser desfeito.`)) return;
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

  if (club === undefined) return <div className="community-page"><PostSkeletons /></div>;
  if (!club) {
    return (
      <div className="community-page">
        <div className="support-empty-state">
          <div className="support-empty-state-icon"><FeedIcon name="tag" size={32} /></div>
          <h3>Tema não encontrado</h3>
          <p className="dim">Ele pode ter sido removido pela staff.</p>
          <button type="button" className="btn-secondary" onClick={() => navigate('/comunidades')}>Ver todos os Temas</button>
        </div>
      </div>
    );
  }
  const clubTags = Array.isArray(club.postTags) ? club.postTags : [];

  const editingCategory = (club.categories || []).find((c) => c.id === editingCategoryId);

  return (
    <div className="community-page-layout">
      <div className="community-page-feed-col">
        <button className="feeds-back" onClick={() => navigate('/comunidades')}>‹ Todos os Temas</button>

        <div className="community-page-header">
          <div className="community-page-icon">{club.iconUrl ? <img src={proxyImage(club.iconUrl)} alt="" /> : <span className="fp-club-fallback">{club.name.slice(0, 1)}</span>}</div>
          <div className="community-page-info">
            <h1>{club.name}</h1>
            {club.description && <p className="dim">{club.description}</p>}
          </div>
        </div>

        {!showCreatePost && (
          <button className="feeds-create" onClick={() => setShowCreatePost(true)}><FeedIcon name="plus" /> Criar post</button>
        )}
        <TagFilter tags={clubTags} value={tag} onChange={setTag} />
        {showCreatePost && (
          <CreatePostForm
            clubs={[club]}
            defaultClubSlug={club.slug}
            onClose={() => setShowCreatePost(false)}
            onCreated={(post) => { setPosts((list) => [post, ...(list || [])]); setShowCreatePost(false); }}
          />
        )}

        {!posts ? <PostSkeletons /> : posts.length === 0 ? (
          <div className="support-empty-state">
            <div className="support-empty-state-icon"><IconGlyph src={emptyIcon} size={40} /></div>
            <h3>{tag ? 'Nenhum post com essa tag' : 'Nenhum post ainda'}</h3>
            <p className="dim">{tag ? 'Tente outra tag.' : 'Seja o primeiro a postar aqui.'}</p>
          </div>
        ) : (
          <div className="post-card-list">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} onVote={onVote} onPin={isStaff ? onPin : undefined} onTag={setTag} onOpen={() => navigate(postPath(post))} />
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
                        {cat.iconUrl ? <img src={proxyImage(cat.iconUrl)} alt="" /> : <FeedIcon name="tag" size={16} />}
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
            <ClubTagsCard club={club} tags={clubTags} isStaff={isStaff} />
            {isStaff && (
              <div className="community-info-manage-actions">
                <button className="btn-secondary community-info-edit-btn" onClick={() => setEditing(true)}>Editar Tema</button>
                <button className="btn-danger community-info-delete-btn" onClick={onDeleteClub}>Excluir Tema</button>
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

// Tags do Fórum deste Tema: todo mundo vê a lista; a staff adiciona/remove.
function ClubTagsCard({ club, tags, isStaff }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!isStaff && tags.length === 0) return null;
  const save = async (next) => {
    setBusy(true); setError('');
    try { await updateClubTags(club.slug, next); } catch (err) { setError(err.response?.data?.error || 'Não foi possível salvar as tags.'); }
    setBusy(false);
  };
  const add = (e) => {
    e.preventDefault();
    const t = draft.trim().slice(0, 24);
    if (!t || tags.includes(t)) { setDraft(''); return; }
    if (tags.length >= 20) { setError('No máximo 20 tags por Tema.'); return; }
    setDraft('');
    save([...tags, t]);
  };
  return (
    <div className="community-info-rules cxf-tags-card">
      <h4>Tags do Fórum</h4>
      {tags.length === 0 ? <p className="dim">Nenhuma tag ainda. Crie algumas pra quem posta poder marcar o assunto.</p> : (
        <div className="cxf-tag-picker-list">
          {tags.map((t) => (
            <span key={t} className="cxf-tag-chip static">
              <FeedIcon name="tag" size={12} /> {t}
              {isStaff && (
                <button type="button" className="cxf-tag-remove" aria-label={`Remover tag ${t}`} disabled={busy} onClick={() => save(tags.filter((x) => x !== t))}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {isStaff && (
        <form className="cxf-tag-add" onSubmit={add}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={24} placeholder="Nova tag (ex: Guia)" aria-label="Nova tag" />
          <button type="submit" className="btn-secondary" disabled={busy || !draft.trim()}>Adicionar</button>
        </form>
      )}
      {error && <div className="auth-error">{error}</div>}
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
      <h4>Editar Tema</h4>
      <label>
        LOGO
        <div className="community-icon-picker-row">
          <span className="community-row-icon community-icon-preview">
            {iconPreview ? <img src={iconPreview} alt="" /> : <FeedIcon name="pin" size={18} />}
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
              {iconPreview ? <img src={iconPreview} alt="" /> : <FeedIcon name="tag" size={18} />}
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
