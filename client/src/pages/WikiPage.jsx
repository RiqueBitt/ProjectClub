import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { listWikiPages, getWikiPage, createWikiPage, updateWikiPage, deleteWikiPage } from '../api/endpoints';
import { WikiMarkdown } from '../utils/wikiMarkdown.jsx';
import '../styles/wiki.css';

// Wiki da comunidade (/wiki e /wiki/:slug). Todo mundo lê; a equipe
// (ADMIN/MODERATOR) cria, edita e apaga aqui mesmo. O Pingu usa estas
// páginas pra responder sobre regras e funcionalidades.
const isStaffRole = (r) => r === 'ADMIN' || r === 'MODERATOR';
const EMPTY = { title: '', category: 'Geral', slug: '', body: '' };
const errText = (e, fallback) => e?.response?.data?.error || fallback;

function WikiEditor({ initial, isNew, onCancel, onSaved }) {
  const [form, setForm] = useState(initial);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const page = isNew
        ? await createWikiPage({ title: form.title, category: form.category, slug: form.slug || undefined, body: form.body })
        : await updateWikiPage(initial.slug, { title: form.title, category: form.category, body: form.body });
      onSaved(page);
    } catch (err) { setError(errText(err, 'Não deu pra salvar a página.')); } finally { setBusy(false); }
  };
  return (
    <form className="wiki-editor" onSubmit={save}>
      <div className="wiki-editor-row">
        <label>Título<input value={form.title} maxLength={120} onChange={set('title')} required /></label>
        <label>Categoria<input value={form.category} maxLength={60} onChange={set('category')} /></label>
        {isNew && <label>Endereço (opcional)<input value={form.slug} maxLength={80} placeholder="ex.: regras" onChange={set('slug')} /></label>}
      </div>
      <div className="wiki-editor-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!preview} className={!preview ? 'on' : ''} onClick={() => setPreview(false)}>Escrever</button>
        <button type="button" role="tab" aria-selected={preview} className={preview ? 'on' : ''} onClick={() => setPreview(true)}>Prévia</button>
        <span className="dim">Use # e ## para títulos, - para listas, **negrito** e [texto](link).</span>
      </div>
      {preview
        ? <div className="wiki-editor-preview"><WikiMarkdown body={form.body} /></div>
        : <textarea rows={18} value={form.body} maxLength={20000} onChange={set('body')} placeholder={'# Título\n\n## Seção\nTexto curto e verdadeiro…'} required />}
      <div className="wiki-actions">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>Cancelar</button>
        {error && <span className="wiki-error" role="alert">{error}</span>}
      </div>
    </form>
  );
}

export default function WikiPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const staff = isStaffRole(user?.platformRole);
  const [pages, setPages] = useState(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // 'new' | 'edit' | null
  const [reload, setReload] = useState(0);

  // Lista (com busca, um pouquinho depois de parar de digitar).
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      listWikiPages(query.trim()).then((r) => { if (alive) setPages(r.pages || []); }).catch((e) => { if (alive) setError(errText(e, 'Não deu pra carregar a wiki.')); });
    }, query ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [query, reload]);

  useEffect(() => {
    setEditing(null);
    if (!slug) { setPage(null); return undefined; }
    let alive = true;
    setPage(undefined);
    getWikiPage(slug).then((r) => { if (alive) setPage(r.page); }).catch((e) => { if (alive) { setPage(null); setError(errText(e, 'Página não encontrada.')); } });
    return () => { alive = false; };
  }, [slug, reload]);

  const groups = useMemo(() => {
    const map = new Map();
    (pages || []).forEach((p) => { if (!map.has(p.category)) map.set(p.category, []); map.get(p.category).push(p); });
    return [...map.entries()];
  }, [pages]);

  const remove = async () => {
    if (!page || !window.confirm(`Apagar a página "${page.title}"? Isso não pode ser desfeito.`)) return;
    try { await deleteWikiPage(page.slug); setReload((n) => n + 1); navigate('/wiki'); } catch (e) { setError(errText(e, 'Não deu pra apagar.')); }
  };
  const onSaved = (saved) => { setEditing(null); setError(''); setReload((n) => n + 1); if (saved?.slug && saved.slug !== slug) navigate(`/wiki/${saved.slug}`); };

  return (
    <div className="wiki-page">
      <aside className="wiki-side">
        <h1 className="wiki-title"><button type="button" onClick={() => navigate('/wiki')}>📚 Wiki</button></h1>
        <input className="wiki-search" type="search" placeholder="Buscar na wiki…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar na wiki" />
        {staff && <button type="button" className="btn-secondary wiki-new" onClick={() => { setEditing('new'); }}>+ Nova página</button>}
        {pages === null ? <p className="dim">Carregando…</p> : pages.length === 0 ? <p className="dim">{query ? 'Nada encontrado.' : 'A wiki ainda está vazia.'}</p> : (
          <nav aria-label="Páginas da wiki">
            {groups.map(([cat, list]) => (
              <div key={cat} className="wiki-group">
                <h2>{cat}</h2>
                {list.map((p) => (
                  <a key={p.slug} href={`/wiki/${p.slug}`} className={p.slug === slug ? 'on' : ''} onClick={(e) => { e.preventDefault(); navigate(`/wiki/${p.slug}`); }}>{p.title}</a>
                ))}
              </div>
            ))}
          </nav>
        )}
      </aside>

      <main className="wiki-main">
        {editing === 'new' && <WikiEditor initial={EMPTY} isNew onCancel={() => setEditing(null)} onSaved={onSaved} />}
        {!editing && !slug && (
          <section className="wiki-home">
            <h2>Wiki do Project Club</h2>
            <p>Regras, como a economia funciona, canais de voz, apps e tudo sobre o Pingu. Escolha uma página ao lado ou busque um assunto.</p>
            <p className="dim">Dica: pergunte pro <strong>@pingu</strong> em qualquer canal — ele usa estas páginas pra responder.</p>
            {(pages || []).slice(0, 8).map((p) => (
              <button type="button" key={p.slug} className="wiki-card" onClick={() => navigate(`/wiki/${p.slug}`)}>
                <strong>{p.title}</strong><span className="dim">{p.preview}</span>
              </button>
            ))}
          </section>
        )}
        {!editing && slug && page === undefined && <p className="dim">Carregando…</p>}
        {!editing && slug && page === null && <p className="wiki-error">{error || 'Página não encontrada.'}</p>}
        {slug && page && editing === 'edit' && (
          <WikiEditor initial={{ title: page.title, category: page.category, slug: page.slug, body: page.body }} onCancel={() => setEditing(null)} onSaved={onSaved} />
        )}
        {slug && page && !editing && (
          <article className="wiki-article">
            <div className="wiki-meta">
              <span className="wiki-cat">{page.category}</span>
              <span className="dim">
                Atualizada em {new Date(page.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                {page.updatedByUser ? ` por ${page.updatedByUser.displayName || page.updatedByUser.username}` : ''}
              </span>
              {staff && (
                <span className="wiki-actions">
                  <button type="button" className="btn-secondary" onClick={() => setEditing('edit')}>Editar</button>
                  <button type="button" className="btn-secondary danger" onClick={remove}>Apagar</button>
                </span>
              )}
            </div>
            <WikiMarkdown body={page.body} onNavigate={(href) => navigate(href)} />
          </article>
        )}
      </main>
    </div>
  );
}
