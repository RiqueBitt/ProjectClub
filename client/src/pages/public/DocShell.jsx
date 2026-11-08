import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { PublicFooter, PublicHeader, usePublicScrollChrome } from './PublicChrome.jsx';
import '../../styles/landing.css';
import '../../styles/public-docs.css';

// Esqueleto das páginas longas públicas (Blog e Termos): abertura,
// índice lateral (fixo no PC, recolhível no celular), seções com âncora e,
// no Blog, um filtro que esconde as seções que não falam do termo e
// marca as ocorrências no texto (CSS Custom Highlight, sem mexer no DOM).

const fold = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Marca as ocorrências de `q` dentro de `roots` (só onde o navegador
// suporta ::highlight; nos outros a página só filtra).
function paintHits(roots, q) {
  const reg = typeof CSS !== 'undefined' && CSS.highlights;
  if (!reg || typeof Highlight === 'undefined') return;
  reg.delete('wk-hit');
  if (!q) return;
  const ranges = [];
  roots.forEach((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const raw = n.nodeValue;
      if (!raw || raw.length < q.length) continue;
      // Texto "dobrado" (sem acento) com o mapa de volta pro original.
      let folded = ''; const map = [];
      for (let i = 0; i < raw.length; i += 1) { const f = fold(raw[i]); folded += f; for (let k = 0; k < f.length; k += 1) map.push(i); }
      let at = folded.indexOf(q);
      while (at !== -1 && ranges.length < 400) {
        const r = document.createRange();
        r.setStart(n, map[at]);
        r.setEnd(n, map[at + q.length - 1] + 1);
        ranges.push(r);
        at = folded.indexOf(q, at + q.length);
      }
    }
  });
  if (ranges.length) reg.set('wk-hit', new Highlight(...ranges));
}

export default function DocShell({ page, kicker, title, lede, meta, heroArt, sections, search = false, searchPlaceholder = 'Filtrar o guia', footNote }) {
  usePublicScrollChrome();
  const location = useLocation();
  const [q, setQ] = useState('');
  const [hidden, setHidden] = useState(() => new Set());
  const [active, setActive] = useState(sections[0]?.id);
  const [tocOpen, setTocOpen] = useState(false);
  const inputRef = useRef(null);
  const bodyRef = useRef(null);

  const groups = useMemo(() => {
    const out = [];
    sections.forEach((s, i) => {
      const g = s.group || '';
      let last = out[out.length - 1];
      if (!last || last.name !== g) { last = { name: g, items: [] }; out.push(last); }
      last.items.push({ ...s, n: String(i + 1).padStart(2, '0') });
    });
    return out;
  }, [sections]);

  // Abriu com "#secao" (ou trocou o hash): rola o contêiner até lá.
  useEffect(() => {
    const id = decodeURIComponent((location.hash || '').slice(1));
    if (!id) return undefined;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'auto', block: 'start' }), 80);
    return () => clearTimeout(t);
  }, [location.hash]);

  // Seção atual no índice.
  useEffect(() => {
    const root = document.querySelector('.lp');
    const els = sections.map((s) => document.getElementById(s.id)).filter(Boolean);
    if (!root || !els.length || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActive(vis[0].target.id);
    }, { root, rootMargin: '-18% 0px -70% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);

  // Mantém o item atual visível dentro do índice (rola só o índice).
  const tocRef = useRef(null);
  useEffect(() => {
    const box = tocRef.current;
    const link = box?.querySelector('li.is-on a');
    if (!box || !link || box.scrollHeight <= box.clientHeight) return;
    const top = link.offsetTop; // o índice (sticky) é o offsetParent
    if (top < box.scrollTop + 40 || top > box.scrollTop + box.clientHeight - 60) {
      box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: 'smooth' });
    }
  }, [active]);

  // Ctrl+K e "/" focam o filtro.
  const focusSearch = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => el.focus({ preventScroll: true }), 250);
  }, []);
  useEffect(() => {
    if (!search) return undefined;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); focusSearch(); }
      else if (e.key === '/' && !/input|textarea/i.test(document.activeElement?.tagName || '')) { e.preventDefault(); focusSearch(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [search, focusSearch]);

  // Filtro: compara com o texto já renderizado de cada seção.
  useEffect(() => {
    const term = fold(q.trim());
    const next = new Set();
    const shown = [];
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (!el) return;
      if (term && !fold(el.textContent || '').includes(term)) next.add(s.id);
      else shown.push(el);
    });
    setHidden(next);
    paintHits(term.length >= 2 ? shown : [], term.length >= 2 ? term : '');
  }, [q, sections]);
  useEffect(() => () => { try { CSS.highlights?.delete('wk-hit'); } catch { /* sem suporte */ } }, []);

  const visibleCount = sections.length - hidden.size;

  return (
    <div className={`lp lp-doc is-${page}`}>
      <a className="lp-skip" href="#doc-conteudo">Pular para o conteúdo</a>
      <div className="lp-progress" aria-hidden="true" />
      <PublicHeader page={page} onSearch={search ? focusSearch : undefined} searchLabel="Buscar no guia" />

      <main id="doc-conteudo">
        <section className="wk-hero" aria-labelledby="doc-titulo">
          <div className="wk-hero-copy">
            {kicker && <p className="wk-kicker">{kicker}</p>}
            <h1 id="doc-titulo" className="wk-title">{title}</h1>
            {lede && <p className="wk-hero-lede">{lede}</p>}
            {meta && <p className="wk-meta">{meta}</p>}
          </div>
          {heroArt}
          {search && (
            <div className="wk-search" role="search">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m20 20-4.2-4.2M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" /></svg>
              <label htmlFor="wk-filter" className="wk-sr">{searchPlaceholder}</label>
              <input
                id="wk-filter" ref={inputRef} type="search" value={q} placeholder={searchPlaceholder} autoComplete="off" spellCheck="false"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); } }}
              />
              <span className="wk-search-count" aria-live="polite">
                {q.trim() ? `${visibleCount} de ${sections.length} seções` : <><kbd>Ctrl</kbd><kbd>K</kbd></>}
              </span>
            </div>
          )}
        </section>

        <div className="wk-layout">
          <aside ref={tocRef} className={`wk-toc ${tocOpen ? 'is-open' : ''}`} aria-label="Índice">
            <button type="button" className="wk-toc-toggle" aria-expanded={tocOpen} aria-controls="wk-toc-list" onClick={() => setTocOpen((o) => !o)}>
              <span>Índice</span>
              <small>{sections.find((s) => s.id === active)?.title || ''}</small>
              <i aria-hidden="true" />
            </button>
            <nav id="wk-toc-list" className="wk-toc-list">
              {groups.map((g) => (
                <div key={g.name || 'g'} className="wk-toc-group">
                  {g.name && <p>{g.name}</p>}
                  <ol>
                    {g.items.map((s) => (
                      <li key={s.id} className={`${active === s.id ? 'is-on' : ''} ${hidden.has(s.id) ? 'is-off' : ''}`}>
                        <a href={`#${s.id}`} onClick={() => setTocOpen(false)} aria-current={active === s.id ? 'location' : undefined}>
                          <span>{s.n}</span>{s.title}
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </nav>
          </aside>

          <div className="wk-body" ref={bodyRef}>
            {visibleCount === 0 && (
              <div className="wk-empty">
                <p>Nada sobre “{q.trim()}” por aqui.</p>
                <button type="button" className="lp-btn is-ghost is-sm" onClick={() => setQ('')}>Limpar o filtro</button>
              </div>
            )}
            {groups.map((g) => g.items.map((s) => (
              <section key={s.id} id={s.id} className="wk-sec" hidden={hidden.has(s.id)} aria-labelledby={`${s.id}-t`}>
                <header className="wk-sec-head">
                  <span className="wk-sec-n" aria-hidden="true">{s.n}</span>
                  <h2 id={`${s.id}-t`}>{s.title}</h2>
                  <a className="wk-anchor" href={`#${s.id}`} aria-label={`Link para ${s.title}`}>#</a>
                </header>
                <div className="wk-prose">{s.body}</div>
              </section>
            )))}
            {footNote}
          </div>
        </div>
      </main>

      <PublicFooter page={page} />
    </div>
  );
}
