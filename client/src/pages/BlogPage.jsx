import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { PublicFooter, PublicHeader, usePublicScrollChrome } from './public/PublicChrome.jsx';
import { CATEGORIES, POSTS, categoryLabel, featuredPost, fmtDate, postBySlug } from './blog/posts.jsx';
import { BannerArt } from './blog/bannerArt.jsx';
import '../styles/landing.css';
import '../styles/landing-mono.css';
import '../styles/landing-club.css';
import '../styles/public-docs.css';
import '../styles/blog.css';

// Blog (/blog e /blog/:slug), no estilo de blog de produto: destaque grande
// no topo, filtro por categoria, cartões com banner e uma página por artigo
// com endereço próprio (/blog/efeitos-de-texto-na-loja). Os termos de uso e
// a política de privacidade são artigos daqui também.
// Preto e branco, no mesmo visual da página inicial (landing-mono.css).

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Banner desenhado em código (nada de imagem gerada): uma cena da turminha
// do login sobre o assunto do artigo (blog/bannerArt.jsx). Na grade, um
// claro e um escuro alternados, feito tabuleiro; em cima de fundo preto
// (destaque e topo do artigo), sempre o claro.
export function PostBanner({ post, big = false, dark = false }) {
  return (
    <div className={`bl-banner ${dark ? 'is-dark' : 'is-light'} ${big ? 'is-big' : ''}`} aria-hidden="true">
      <BannerArt post={post} />
      <span className="bl-banner-cat">{categoryLabel(post.category)}</span>
    </div>
  );
}

function PostCard({ post, i = 0 }) {
  return (
    <li className="bl-card lp-reveal" style={{ '--i': i % 6 }}>
      <Link to={`/blog/${post.slug}`} data-cursor="Ler">
        <PostBanner post={post} dark={i % 2 === 0} />
        <span className="bl-card-meta"><b>{categoryLabel(post.category)}</b><time dateTime={post.date}>{fmtDate(post.date)}</time></span>
        <h3>{post.title}</h3>
        <p>{post.excerpt}</p>
      </Link>
    </li>
  );
}

function useReveal(deps) {
  useEffect(() => {
    if (reducedMotion()) return undefined;
    const lp = document.querySelector('.lp');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { root: lp, threshold: 0, rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.lp-reveal:not(.is-in)').forEach((el) => io.observe(el));
    lp?.classList.add('is-js');
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ---------- Lista ----------
function BlogIndex() {
  const [cat, setCat] = useState('todos');
  const [q, setQ] = useState('');
  const fold = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const top = featuredPost();
  const list = useMemo(() => POSTS.filter((p) => p !== top
    && (cat === 'todos' || p.category === cat)
    && (!q.trim() || fold(`${p.title} ${p.excerpt}`).includes(fold(q.trim())))), [cat, q, top]);
  useReveal([cat, q]);
  useEffect(() => { document.title = 'Blog · Project Club'; }, []);

  return (
    <>
      <section className="bl-hero lm-dark" aria-labelledby="blog-titulo">
        <p className="lm-eyebrow"><b>Blog</b>/Project Club</p>
        <h1 id="blog-titulo" className="bl-title">Novidades, tutoriais e tudo sobre o clube.</h1>
        <Link to={`/blog/${top.slug}`} className="bl-feature" data-cursor="Ler">
          <PostBanner post={top} big />
          <span className="bl-feature-copy">
            <span className="bl-card-meta"><b>Destaque · {categoryLabel(top.category)}</b><time dateTime={top.date}>{fmtDate(top.date)}</time></span>
            <strong>{top.title}</strong>
            <span>{top.excerpt}</span>
            <em className="lm-btn is-solid">Ler o artigo</em>
          </span>
        </Link>
      </section>

      <section className="lm-sec bl-list" aria-label="Artigos">
        <div className="bl-filters">
          <div className="bl-tabs" role="tablist" aria-label="Categorias">
            {[{ id: 'todos', label: 'Todos' }, ...CATEGORIES].map((c) => (
              <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} className={cat === c.id ? 'is-on' : ''} onClick={() => setCat(c.id)}>{c.label}</button>
            ))}
          </div>
          <label className="bl-search">
            <span className="wk-sr">Buscar no blog</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m20 20-4.2-4.2M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" /></svg>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: 2FA, moldura, modpack…" />
          </label>
        </div>
        {list.length ? (
          <ul className="bl-grid" key={cat + q}>
            {list.map((p, i) => <PostCard key={p.slug} post={p} i={i} />)}
          </ul>
        ) : (
          <p className="bl-empty">Nenhum artigo sobre “{q.trim()}”. <button type="button" onClick={() => { setQ(''); setCat('todos'); }}>Ver todos</button></p>
        )}
      </section>
    </>
  );
}

// ---------- Artigo ----------
function BlogPost({ post }) {
  const navigate = useNavigate();
  const bodyRef = useRef(null);
  const [mins, setMins] = useState(null);
  const [heads, setHeads] = useState([]);
  const [copied, setCopied] = useState(false);
  const related = useMemo(() => {
    const same = POSTS.filter((p) => p.slug !== post.slug && p.category === post.category);
    const rest = POSTS.filter((p) => p.slug !== post.slug && p.category !== post.category);
    return [...same, ...rest].slice(0, 3);
  }, [post]);
  const idx = POSTS.indexOf(post);
  const prev = POSTS[idx - 1]; const next = POSTS[idx + 1];

  useEffect(() => {
    document.title = `${post.title} · Blog do Project Club`;
    const el = bodyRef.current;
    if (!el) return;
    const words = (el.textContent || '').trim().split(/\s+/).length;
    setMins(Math.max(1, Math.round(words / 200)));
    setHeads(post.toc ? [...el.querySelectorAll('section.bl-sub[id] > h2')].map((h) => ({ id: h.parentElement.id, t: h.textContent })) : []);
    document.querySelector('.lp')?.scrollTo({ top: 0 });
  }, [post]);
  // Vindo de /termos#dados: rola até a parte certa.
  useEffect(() => {
    const id = decodeURIComponent((window.location.hash || '').slice(1));
    if (!id) return undefined;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 120);
    return () => clearTimeout(t);
  }, [post]);
  useReveal([post.slug]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href.split('#')[0]); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* sem área de transferência */ }
  };

  return (
    <>
      <article className="bl-post" aria-labelledby="post-titulo">
        <header className="bl-post-head lm-dark">
          <nav className="bl-crumb" aria-label="Você está em"><Link to="/blog">Blog</Link><span aria-hidden="true">/</span><button type="button" onClick={() => navigate('/blog')}>{categoryLabel(post.category)}</button></nav>
          <h1 id="post-titulo" className="bl-post-title">{post.title}</h1>
          <p className="bl-post-lede">{post.excerpt}</p>
          <p className="bl-post-meta">
            <span>Equipe Project Club</span>
            <time dateTime={post.date}>{fmtDate(post.date)}</time>
            {mins && <span>{mins} min de leitura</span>}
            <button type="button" className="lm-btn is-line bl-copy" onClick={copy}>{copied ? 'Link copiado' : 'Copiar link'}</button>
          </p>
          <PostBanner post={post} big />
        </header>

        <div className={`bl-post-body ${heads.length ? 'has-toc' : ''}`}>
          {heads.length > 0 && (
            <aside className="bl-toc" aria-label="Neste artigo">
              <p>Neste artigo</p>
              <ol>{heads.map((h) => <li key={h.id}><a href={`#${h.id}`}>{h.t}</a></li>)}</ol>
            </aside>
          )}
          <div className="wk-prose bl-prose" ref={bodyRef}>{post.body}</div>
        </div>

        <nav className="bl-pager" aria-label="Outros artigos">
          {prev ? <Link to={`/blog/${prev.slug}`}><small>← Anterior</small>{prev.title}</Link> : <span />}
          {next ? <Link to={`/blog/${next.slug}`} className="is-next"><small>Próximo →</small>{next.title}</Link> : <span />}
        </nav>
      </article>

      <section className="lm-sec bl-related" aria-labelledby="rel-titulo">
        <p className="lm-eyebrow"><b>Leia também</b></p>
        <h2 id="rel-titulo" className="lm-h2">Mais do blog.</h2>
        <ul className="bl-grid">{related.map((p, i) => <PostCard key={p.slug} post={p} i={i} />)}</ul>
        <Link to="/blog" className="lm-btn is-line">Ver todos os artigos</Link>
      </section>
    </>
  );
}

export default function BlogPage() {
  const { slug } = useParams();
  usePublicScrollChrome();
  const post = slug ? postBySlug(slug) : null;
  if (slug && !post) return <Navigate to="/blog" replace />;
  return (
    <div className="lp lp-mono lp-doc lp-blog">
      <a className="lp-skip" href="#conteudo">Pular para o conteúdo</a>
      <div className="lp-progress" aria-hidden="true" />
      <PublicHeader page="blog" />
      <main id="conteudo">
        {post ? <BlogPost key={post.slug} post={post} /> : <BlogIndex />}
      </main>
      <PublicFooter page="blog" />
    </div>
  );
}
