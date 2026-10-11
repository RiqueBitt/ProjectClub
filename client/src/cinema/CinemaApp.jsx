import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCinema } from './cinemaStore';
import { cineHome, cineSearch, cineItem, cineSubtitle } from '../api/endpoints';
import { useMusic } from '../music/musicStore';
import { useYouTubeApp } from '../youtube/youtubeStore';
import '../styles/cinema.css';

// ============================================================
// Cinema do Project Club: filmes, séries, desenhos e anime do Internet
// Archive (acervo de domínio público / licença aberta). Funciona como o
// YouTube da barra de cima: um único <video> fica sempre montado
// (CinemaHost) e "segue" o lugar certo — grande na tela de assistir ou
// pequeno no canto enquanto você navega pelo resto do app.
// ============================================================

const P = {
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  close: 'M6 6l12 12M18 6 6 18',
  mini: 'M4 5h16v14H4zM12 12h6v5h-6z',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  play: 'M7 4v16l13-8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12l5 5 9-10',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  back: 'M15 5l-7 7 7 7',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  next: 'M5 4v16l10-8zM18 4v16',
  prev: 'M19 4v16L9 12zM6 4v16',
  cc: 'M4 6h16v12H4zM10.5 10.2A2.2 2.2 0 1 0 10.5 13.8M17 10.2A2.2 2.2 0 1 0 17 13.8',
  hd: 'M4 6h16v12H4zM8 9v6M8 12h3M11 9v6M14 9v6h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2z',
  auto: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  translate: 'M4 5h8M8 3v2M6 5c0 4 3 7 6 8M10 5c0 4-3 7-6 8M13 21l4-10 4 10M14.5 17h5',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  warn: 'M12 3 2 20h20zM12 10v4M12 17h.01',
};
const Ico = ({ d, size = 18, fill = false }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

const CATS = [
  ['populares', 'Em alta'], ['filmes', 'Filmes'], ['series', 'Séries e TV'], ['desenhos', 'Desenhos'], ['anime', 'Anime'],
  ['terror', 'Terror'], ['ficcao', 'Ficção científica'], ['comedia', 'Comédia'], ['noir', 'Policial e noir'],
  ['faroeste', 'Faroeste'], ['aventura', 'Ação e aventura'], ['mudos', 'Cinema mudo'], ['brasil', 'Em português'],
];
const CAT_LABEL = Object.fromEntries(CATS);
const SORTS = [['populares', 'Mais vistos'], ['recentes', 'Adicionados recentemente'], ['novos', 'Mais novos'], ['antigos', 'Mais antigos'], ['titulo', 'Título (A–Z)']];
const KIND = { filme: 'Filme', serie: 'Série', desenho: 'Desenho', anime: 'Anime' };
const KIND_CAT = { filme: 'filmes', serie: 'series', desenho: 'desenhos', anime: 'anime' };

function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return '';
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
const fmtDur = (s) => {
  if (!s) return '';
  const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m ? `${m} min` : ''}`.trim() : `${m} min`;
};

// Cache simples dos itens já abertos (detalhe -> assistir sem refazer o pedido).
const itemCache = new Map();
function useItem(id) {
  const [state, setState] = useState(() => ({ item: itemCache.get(id) || null, loading: !itemCache.has(id), error: null }));
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!id) return undefined;
    if (itemCache.has(id)) { setState({ item: itemCache.get(id), loading: false, error: null }); return undefined; }
    let alive = true;
    setState({ item: null, loading: true, error: null });
    cineItem(id).then((it) => { itemCache.set(id, it); if (alive) setState({ item: it, loading: false, error: null }); })
      .catch((e) => { if (alive) setState({ item: null, loading: false, error: e?.response?.status === 404 ? 'Título não encontrado.' : 'Não consegui falar com o Internet Archive agora.' }); });
    return () => { alive = false; };
  }, [id, nonce]);
  return { ...state, retry: () => setNonce((n) => n + 1) };
}
const loadItem = async (id) => {
  if (itemCache.has(id)) return itemCache.get(id);
  const it = await cineItem(id); itemCache.set(id, it); return it;
};

// ---------------- Cartões ----------------
function Art({ src, alt = '' }) {
  const [bad, setBad] = useState(false);
  return (
    <span className="cine-art">
      {!bad && <img className="cine-art-bg" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" aria-hidden="true" />}
      {!bad ? <img className="cine-art-img" src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />
        : <span className="cine-art-fallback"><Ico d={P.film} size={34} /></span>}
    </span>
  );
}

function CineCard({ it, prog, onOpen, onRemove }) {
  const pct = prog?.d ? Math.min(100, Math.max(2, (prog.t / prog.d) * 100)) : 0;
  return (
    <div className="cine-card">
      <button type="button" className="cine-card-btn" onClick={() => onOpen(it)} title={it.title}>
        <span className="cine-card-media">
          <Art src={it.thumbnail} alt="" />
          <span className="cine-card-kind">{KIND[it.kind] || 'Filme'}</span>
          {it.duration && !onRemove ? <span className="cine-card-dur">{fmtDur(it.duration)}</span> : null}
          {pct > 0 && <span className="cine-card-prog"><i style={{ width: `${pct}%` }} /></span>}
          <span className="cine-card-play"><Ico d={P.play} size={22} fill /></span>
        </span>
        <span className="cine-card-t">
          <strong data-no-translate>{it.title}</strong>
          <small>
            {prog ? (prog.epCount > 1 ? `Ep. ${prog.epIdx + 1}${prog.d ? ` · faltam ${fmtDur(Math.max(60, prog.d - prog.t))}` : ''}` : (prog.d ? `Faltam ${fmtDur(Math.max(60, prog.d - prog.t))}` : 'Continuar'))
              : [it.year, KIND[it.kind]].filter(Boolean).join(' · ')}
          </small>
        </span>
      </button>
      {onRemove && <button type="button" className="cine-card-x" onClick={() => onRemove(it)} title="Remover" aria-label="Remover"><Ico d={P.close} size={14} /></button>}
    </div>
  );
}

function Skeletons({ n = 8, row = false }) {
  return Array.from({ length: n }, (_, i) => <div key={i} className={`cine-card cine-skel${row ? ' in-row' : ''}`}><span className="cine-art" /><span className="cine-skel-l" /><span className="cine-skel-l short" /></div>);
}

function Row({ title, items, progress, onOpen, onMore, onRemove, loading }) {
  const ref = useRef(null);
  const scroll = (dir) => { const el = ref.current; if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' }); };
  if (!loading && !items?.length) return null;
  return (
    <section className="cine-row">
      <div className="cine-row-h">
        <h3>{title}</h3>
        {onMore && <button type="button" className="cine-link" onClick={onMore}>Ver tudo</button>}
        <span className="cine-grow" />
        <button type="button" className="cine-arrow" onClick={() => scroll(-1)} aria-label="Voltar"><Ico d={P.left} size={16} /></button>
        <button type="button" className="cine-arrow" onClick={() => scroll(1)} aria-label="Avançar"><Ico d={P.right} size={16} /></button>
      </div>
      <div className="cine-row-list" ref={ref}>
        {loading ? <Skeletons n={7} row /> : items.map((it) => <CineCard key={it.id} it={it} prog={progress?.[it.id]} onOpen={onOpen} onRemove={onRemove} />)}
      </div>
    </section>
  );
}

// ---------------- Início ----------------
function Hero({ it, onOpen, onPlay }) {
  if (!it) return <div className="cine-hero is-skel" />;
  return (
    <section className="cine-hero">
      <img className="cine-hero-bg" src={it.thumbnail} alt="" referrerPolicy="no-referrer" aria-hidden="true" />
      <div className="cine-hero-in">
        <img className="cine-hero-poster" src={it.thumbnail} alt="" referrerPolicy="no-referrer" />
        <div className="cine-hero-txt">
          <span className="cine-pill">Destaque · {KIND[it.kind] || 'Filme'}{it.year ? ` · ${it.year}` : ''}</span>
          <h2 data-no-translate>{it.title}</h2>
          {it.description && <p lang="en">{it.description}</p>}
          <div className="cine-hero-act">
            <button type="button" className="cine-btn is-primary" onClick={() => onPlay(it)}><Ico d={P.play} fill /> Assistir</button>
            <button type="button" className="cine-btn" onClick={() => onOpen(it)}>Detalhes</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function HomeView({ go, onOpen, onPlay }) {
  const { progress, list, forget, toggleList } = useCinema();
  const [data, setData] = useState({ rows: null, error: false });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setData((d) => ({ rows: d.rows, error: false }));
    cineHome().then((r) => alive && setData({ rows: r.rows || [], error: false })).catch(() => alive && setData({ rows: [], error: true }));
    return () => { alive = false; };
  }, [nonce]);
  const cont = useMemo(() => Object.values(progress).sort((a, b) => b.at - a.at), [progress]);
  const rows = data.rows;
  // Destaque muda a cada dia, entre os mais vistos.
  const hero = useMemo(() => {
    const pop = rows?.[0]?.items?.filter((x) => x.description) || [];
    return pop.length ? pop[new Date().getDate() % Math.min(pop.length, 8)] : null;
  }, [rows]);
  return (
    <>
      {data.error ? (
        <div className="cine-notice" role="status">
          <Ico d={P.warn} /> Não consegui falar com o Internet Archive agora.
          <button type="button" className="cine-link" onClick={() => setNonce((n) => n + 1)}>Tentar de novo</button>
        </div>
      ) : <Hero it={hero} onOpen={onOpen} onPlay={onPlay} />}
      <Row title="Continuar assistindo" items={cont} progress={progress} onOpen={(it) => onPlay(it, true)} onRemove={(it) => forget(it.id)} />
      <Row title="Minha lista" items={list} onOpen={onOpen} onRemove={(it) => toggleList(it)} />
      {rows === null
        ? ['Em alta', 'Filmes', 'Séries e TV'].map((t) => <Row key={t} title={t} loading />)
        : rows.map((r) => <Row key={r.cat} title={r.label} items={r.items} progress={progress} onOpen={onOpen} onMore={() => go({ type: 'cat', cat: r.cat })} />)}
      <p className="cine-foot">
        Acervo do <a href="https://archive.org/details/movies" target="_blank" rel="noreferrer">Internet Archive</a>: filmes, séries e desenhos em domínio público ou com licença aberta.
        Anime com licença livre ainda é raro por lá; o que existe aparece em <button type="button" className="cine-link" onClick={() => go({ type: 'cat', cat: 'anime' })}>Anime</button>.
      </p>
    </>
  );
}

// ---------------- Categoria / busca ----------------
function GridView({ view, go, onOpen, mainRef }) {
  const { progress } = useCinema();
  const [sort, setSort] = useState('populares');
  const [state, setState] = useState({ items: [], page: 0, hasMore: true, loading: false, error: false, total: 0 });
  const busy = useRef(false);
  const key = `${view.type}|${view.cat || ''}|${view.q || ''}|${sort}`;
  const keyRef = useRef(key);

  const loadPage = useCallback(async (page, reset) => {
    if (busy.current && !reset) return;
    busy.current = true;
    const k = keyRef.current;
    setState((s) => ({ ...(reset ? { items: [], total: 0 } : s), page: reset ? 0 : s.page, hasMore: true, loading: true, error: false }));
    try {
      const r = await cineSearch({ q: view.q || '', cat: view.cat || 'populares', sort, page });
      if (keyRef.current !== k) return;
      setState((s) => {
        const seen = new Set(s.items.map((x) => x.id));
        return { items: [...(reset ? [] : s.items), ...r.items.filter((x) => !seen.has(x.id))], page, hasMore: r.hasMore, loading: false, error: false, total: r.total };
      });
    } catch {
      if (keyRef.current === k) setState((s) => ({ ...s, loading: false, error: true, hasMore: false }));
    } finally { busy.current = false; }
  }, [view.q, view.cat, sort]);

  useEffect(() => { keyRef.current = key; busy.current = false; loadPage(1, true); mainRef.current?.scrollTo?.({ top: 0 }); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const sentinel = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const el = sentinel.current; if (!el) return undefined;
    const io = new IntersectionObserver((ents) => {
      const s = stateRef.current;
      if (ents.some((e) => e.isIntersecting) && s.hasMore && !s.loading && !busy.current && s.page > 0) loadPage(s.page + 1, false);
    }, { root: mainRef.current, rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadPage, mainRef]);

  return (
    <>
      <div className="cine-chips" role="tablist" aria-label="Categorias">
        {CATS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view.cat === id && !view.q} className={`cine-chip${view.cat === id && !view.q ? ' is-on' : ''}`} onClick={() => go({ type: 'cat', cat: id })}>{label}</button>
        ))}
      </div>
      <div className="cine-grid-h">
        <h3>{view.q ? <>Resultados para “<span data-no-translate>{view.q}</span>”{view.cat && view.cat !== 'populares' ? ` em ${CAT_LABEL[view.cat]}` : ''}</> : CAT_LABEL[view.cat] || 'Explorar'}</h3>
        {state.total > 0 && <small>{state.total.toLocaleString('pt-BR')} títulos</small>}
        <span className="cine-grow" />
        <label className="cine-select">
          <span>Ordenar</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>
        </label>
      </div>
      {state.error && <div className="cine-notice" role="status"><Ico d={P.warn} /> Não consegui carregar agora. <button type="button" className="cine-link" onClick={() => loadPage(1, true)}>Tentar de novo</button></div>}
      {!state.loading && !state.error && !state.items.length && (
        <div className="cine-empty"><Ico d={P.search} size={30} /><strong>Nada encontrado</strong><span>Tente o nome original em inglês (ex.: “Nosferatu”, “Popeye”, “Superman”) ou outra categoria.</span></div>
      )}
      <div className="cine-grid">
        {state.items.map((it) => <CineCard key={it.id} it={it} prog={progress[it.id]} onOpen={onOpen} />)}
        {state.loading && <Skeletons n={state.items.length ? 6 : 18} />}
      </div>
      <div ref={sentinel} className="cine-sentinel" aria-hidden="true" />
    </>
  );
}

// ---------------- Detalhes ----------------
function EpisodeList({ item, current, onPick, compact }) {
  const { progress } = useCinema();
  const [filter, setFilter] = useState('');
  const prog = progress[item.id];
  const eps = item.episodes.map((e, i) => ({ e, i })).filter(({ e }) => !filter || e.title.toLowerCase().includes(filter.toLowerCase()));
  const curRef = useRef(null);
  // Rola só a coluna da lista (scrollIntoView rolaria a página inteira junto).
  useEffect(() => {
    const el = curRef.current; const box = el?.closest('.cine-watch-side');
    if (!el || !box || box.scrollHeight <= box.clientHeight) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTo({ top: Math.max(0, top - 60), behavior: 'smooth' });
  }, [current]);
  return (
    <div className={`cine-eps${compact ? ' is-compact' : ''}`}>
      <div className="cine-eps-h">
        <h3>Episódios <small>{item.episodes.length}</small></h3>
        {item.episodes.length > 12 && <input type="search" placeholder="Filtrar episódios" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar episódios" />}
      </div>
      <ol>
        {eps.map(({ e, i }) => {
          const isCur = i === current;
          const seen = prog && (i < prog.epIdx);
          const partial = prog && i === prog.epIdx && prog.d ? (prog.t / prog.d) * 100 : 0;
          return (
            <li key={e.key} ref={isCur ? curRef : null}>
              <button type="button" className={`cine-ep${isCur ? ' is-cur' : ''}${seen ? ' is-seen' : ''}`} onClick={() => onPick(i)}>
                <span className="cine-ep-n">{isCur ? <Ico d={P.play} size={14} fill /> : i + 1}</span>
                <span className="cine-ep-t"><strong data-no-translate>{e.title}</strong><small>{[fmtDur(e.duration), e.subtitles.length ? 'Legendas' : '', seen ? 'Assistido' : ''].filter(Boolean).join(' · ')}</small></span>
                {partial > 0 && <span className="cine-ep-prog"><i style={{ width: `${partial}%` }} /></span>}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const translateUrl = (text) => `https://translate.google.com/?sl=auto&tl=pt&op=translate&text=${encodeURIComponent(text.slice(0, 4500))}`;

function DetailView({ id, onPlay, go }) {
  const { item, loading, error, retry } = useItem(id);
  const { progress, list, toggleList } = useCinema();
  const [more, setMore] = useState(false);
  if (loading) return <div className="cine-detail is-loading"><div className="cine-hero is-skel" /></div>;
  if (error || !item) return <div className="cine-notice" role="status"><Ico d={P.warn} /> {error || 'Erro.'} <button type="button" className="cine-link" onClick={retry}>Tentar de novo</button></div>;
  const prog = progress[item.id];
  const inList = list.some((x) => x.id === item.id);
  const canPlay = item.episodes.length > 0;
  const total = item.episodes.reduce((a, e) => a + (e.duration || 0), 0);
  const english = /^(en|eng|english)$/i.test(item.language || '') || !item.language;
  const resumeEp = prog && item.episodes[prog.epIdx] ? prog.epIdx : 0;
  return (
    <div className="cine-detail">
      <section className="cine-hero is-detail">
        <img className="cine-hero-bg" src={item.thumbnail} alt="" referrerPolicy="no-referrer" aria-hidden="true" />
        <div className="cine-hero-in">
          <img className="cine-hero-poster" src={item.thumbnail} alt="" referrerPolicy="no-referrer" />
          <div className="cine-hero-txt">
            <span className="cine-pill">{[KIND[item.kind], item.year, item.episodes.length > 1 ? `${item.episodes.length} episódios` : fmtDur(total), item.language].filter(Boolean).join(' · ')}</span>
            <h2 data-no-translate>{item.title}</h2>
            {item.creator && <p className="cine-sub" data-no-translate>{item.creator}</p>}
            <div className="cine-hero-act">
              {canPlay && (
                <button type="button" className="cine-btn is-primary" onClick={() => onPlay(item, resumeEp)}>
                  <Ico d={P.play} fill /> {prog ? (item.episodes.length > 1 ? `Continuar ep. ${resumeEp + 1}` : `Continuar de ${fmtTime(prog.t)}`) : 'Assistir'}
                </button>
              )}
              {prog && canPlay && <button type="button" className="cine-btn" onClick={() => onPlay(item, 0, 0)}>Do começo</button>}
              <button type="button" className={`cine-btn${inList ? ' is-on' : ''}`} onClick={() => toggleList(item)}><Ico d={inList ? P.check : P.plus} /> {inList ? 'Na minha lista' : 'Minha lista'}</button>
              <a className="cine-btn is-ghost" href={item.pageUrl} target="_blank" rel="noreferrer" title="Abrir no Internet Archive"><Ico d={P.ext} /> Archive</a>
            </div>
          </div>
        </div>
      </section>
      {!canPlay && (
        <div className="cine-notice" role="status"><Ico d={P.warn} /> Este título não tem um vídeo liberado para assistir aqui (só empréstimo ou formato que o navegador não toca). Dá para ver no site do Archive.</div>
      )}
      {item.description && (
        <section className="cine-about">
          <h3>Sinopse</h3>
          <p className={more ? '' : 'is-clamped'} lang={english ? 'en' : undefined}>{item.description}</p>
          <div className="cine-about-act">
            {item.description.length > 320 && <button type="button" className="cine-link" onClick={() => setMore((m) => !m)}>{more ? 'Mostrar menos' : 'Mostrar mais'}</button>}
            {english && <a className="cine-link" href={translateUrl(item.description)} target="_blank" rel="noreferrer"><Ico d={P.translate} size={15} /> Traduzir para português</a>}
          </div>
          {item.subjects.length > 0 && (
            <div className="cine-tags">{item.subjects.slice(0, 10).map((s) => <button key={s} type="button" className="cine-tag" onClick={() => go({ type: 'search', q: s, cat: 'populares' })} data-no-translate>{s}</button>)}</div>
          )}
        </section>
      )}
      {item.episodes.length > 1 && <EpisodeList item={item} current={-1} onPick={(i) => onPlay(item, i)} />}
    </div>
  );
}

// ---------------- Assistir ----------------
function Related({ item, onOpen }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let alive = true;
    setItems(null);
    cineSearch({ cat: KIND_CAT[item.kind] || 'filmes', page: 1 + (item.id.length % 3) })
      .then((r) => alive && setItems(r.items.filter((x) => x.id !== item.id).slice(0, 12))).catch(() => alive && setItems([]));
    return () => { alive = false; };
  }, [item.id, item.kind]);
  return (
    <div className="cine-related">
      <h3>Você também pode gostar</h3>
      <div className="cine-related-list">
        {items === null ? <Skeletons n={4} /> : items.map((it) => (
          <button key={it.id} type="button" className="cine-rel" onClick={() => onOpen(it)}>
            <Art src={it.thumbnail} />
            <span><strong data-no-translate>{it.title}</strong><small>{[it.year, KIND[it.kind]].filter(Boolean).join(' · ')}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}

function WatchView({ onOpen }) {
  const st = useCinema();
  const p = st.playing;
  if (!p) return null;
  const { item, epIdx } = p;
  const ep = item.episodes[epIdx];
  const many = item.episodes.length > 1;
  const inList = st.list.some((x) => x.id === item.id);
  const curTime = () => document.querySelector('.cine-video')?.currentTime || 0;
  return (
    <div className="cine-watch">
      <div className="cine-watch-main">
        <div className="cine-slot" />
        <div className="cine-watch-meta">
          <div className="cine-watch-t">
            <h2 data-no-translate>{item.title}</h2>
            <p>{many ? <>Episódio {epIdx + 1} de {item.episodes.length} · <span data-no-translate>{ep.title}</span></> : [item.year, KIND[item.kind], fmtDur(ep.duration)].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="cine-tools">
            {many && <button type="button" className="cine-tool" disabled={epIdx === 0} onClick={() => st.play(item, epIdx - 1, { startAt: 0 })} title="Episódio anterior"><Ico d={P.prev} size={16} /> Anterior</button>}
            {many && <button type="button" className="cine-tool" disabled={epIdx >= item.episodes.length - 1} onClick={() => st.nextEpisode()} title="Próximo episódio (N)"><Ico d={P.next} size={16} /> Próximo</button>}
            <label className="cine-tool is-select" title="Qualidade do vídeo">
              <Ico d={P.hd} size={16} />
              <select value={p.srcIdx} onChange={(e) => st.setSource(Number(e.target.value), curTime())} aria-label="Qualidade">
                {ep.sources.map((s, i) => <option key={s.url} value={i}>{s.label}{s.size ? ` · ${Math.round(s.size / 1048576)} MB` : ''}</option>)}
              </select>
            </label>
            <label className={`cine-tool is-select${p.sub ? ' is-on' : ''}`} title={ep.subtitles.length ? 'Legendas (C)' : 'Este vídeo não tem legendas no Archive'}>
              <Ico d={P.cc} size={16} />
              <select value={p.sub || ''} onChange={(e) => st.setSub(e.target.value || null)} disabled={!ep.subtitles.length} aria-label="Legendas">
                <option value="">{ep.subtitles.length ? 'Sem legenda' : 'Sem legendas'}</option>
                {ep.subtitles.map((s) => <option key={s.file} value={s.file}>{s.label}</option>)}
              </select>
            </label>
            {many && <button type="button" className={`cine-tool${st.prefs.autoNext ? ' is-on' : ''}`} onClick={() => st.setPrefs({ autoNext: !st.prefs.autoNext })} aria-pressed={st.prefs.autoNext} title="Tocar o próximo episódio sozinho"><Ico d={P.auto} size={16} /> Automático</button>}
            <button type="button" className={`cine-tool${inList ? ' is-on' : ''}`} onClick={() => st.toggleList(item)}><Ico d={inList ? P.check : P.plus} size={16} /> Minha lista</button>
            <button type="button" className="cine-tool" onClick={() => st.showDetail(item.id)}>Detalhes</button>
            <a className="cine-tool" href={item.pageUrl} target="_blank" rel="noreferrer"><Ico d={P.ext} size={16} /> Archive</a>
          </div>
          <p className="cine-tip">Atalhos: espaço pausa · ←/→ 5 s · J/L 10 s · F tela cheia · M mudo · C legenda{many ? ' · N próximo' : ''}</p>
        </div>
      </div>
      <aside className="cine-watch-side">
        {many ? <EpisodeList item={item} current={epIdx} onPick={(i) => st.play(item, i, { startAt: 0 })} compact /> : <Related item={item} onOpen={onOpen} />}
      </aside>
    </div>
  );
}

// ---------------- Player (sempre montado) ----------------
export function CinemaHost() {
  const playing = useCinema((s) => s.playing);
  const open = useCinema((s) => s.open);
  const view = useCinema((s) => s.view);
  const ytMini = useYouTubeApp((s) => !!s.video && !(s.open && s.view === 'watch'));
  const vRef = useRef(null);
  const [rect, setRect] = useState(null);
  const [subUrl, setSubUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(true);
  const [countdown, setCountdown] = useState(null);
  const watching = open && view === 'watch';
  const ep = playing ? playing.item.episodes[playing.epIdx] : null;
  const src = ep?.sources[playing.srcIdx] || ep?.sources[0];

  // Legenda: busca pelo servidor (SRT -> WebVTT) e entrega como blob.
  useEffect(() => {
    let alive = true; let url = null;
    setSubUrl(null);
    if (!playing?.sub) return undefined;
    cineSubtitle(playing.item.id, playing.sub).then((vtt) => {
      if (!alive) return;
      url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      setSubUrl(url);
    }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [playing?.item?.id, playing?.sub]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v = vRef.current; if (!v) return;
    const t = v.textTracks?.[0];
    if (t) t.mode = subUrl ? 'showing' : 'disabled';
  }, [subUrl]);

  // Salva o progresso (a cada 5 s, ao pausar e ao sair).
  // O progresso vale para o arquivo que está DE FATO carregado no <video>
  // (na troca de episódio, eventos do vídeo antigo chegam com o estado novo).
  const loadedRef = useRef(null); // { item, epIdx }
  const timeRef = useRef({ t: 0, d: 0 });
  const saveNow = useCallback(() => {
    const L = loadedRef.current; if (!L) return;
    const v = vRef.current;
    if (v && v.readyState >= 1) timeRef.current = { t: v.currentTime, d: v.duration || timeRef.current.d };
    const { t, d } = timeRef.current;
    if (!t) return;
    const ep = L.item.episodes[L.epIdx];
    useCinema.getState().saveProgress(L.item, ep, L.epIdx, t, d || ep.duration || 0);
  }, []);
  // Troca de fonte (episódio/qualidade): retoma do ponto pedido.
  useEffect(() => {
    const v = vRef.current; if (!v || !src) return undefined;
    saveNow(); // fecha a conta do arquivo anterior
    loadedRef.current = { item: playing.item, epIdx: playing.epIdx };
    timeRef.current = { t: 0, d: ep.duration || 0 };
    setFailed(false); setCountdown(null);
    const at = playing.startAt || 0;
    const onMeta = () => { if (at > 0 && at < (v.duration || Infinity) - 5) { try { v.currentTime = at; } catch { /* ignora */ } } };
    v.addEventListener('loadedmetadata', onMeta, { once: true });
    v.src = src.url;
    v.load();
    v.play().catch(() => setPaused(true));
    return () => v.removeEventListener('loadedmetadata', onMeta);
  }, [src?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => { if (vRef.current && !vRef.current.paused) saveNow(); }, 5000);
    const onHide = () => saveNow();
    window.addEventListener('pagehide', onHide);
    return () => { clearInterval(id); window.removeEventListener('pagehide', onHide); saveNow(); };
  }, [playing?.item?.id, playing?.epIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Só uma coisa tocando por vez: pausa música e YouTube; e vice-versa.
  useEffect(() => {
    const onYt = () => vRef.current?.pause();
    window.addEventListener('pc-yt-play', onYt);
    return () => window.removeEventListener('pc-yt-play', onYt);
  }, []);
  const musicPlaying = useMusic((s) => s.playing);
  useEffect(() => { if (musicPlaying) vRef.current?.pause(); }, [musicPlaying]);

  // Media Session (tela de bloqueio / teclas de mídia).
  useEffect(() => {
    if (!playing || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: playing.item.episodes.length > 1 ? `${ep.title}` : playing.item.title,
        artist: playing.item.episodes.length > 1 ? playing.item.title : (playing.item.creator || 'Cinema · Project Club'),
        artwork: [{ src: playing.item.thumbnail, sizes: '512x512' }],
      });
      navigator.mediaSession.setActionHandler('nexttrack', playing.epIdx < playing.item.episodes.length - 1 ? () => useCinema.getState().nextEpisode() : null);
    } catch { /* ignora */ }
  }, [playing?.item?.id, playing?.epIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Próximo episódio automático com contagem regressiva.
  useEffect(() => {
    if (countdown == null) return undefined;
    if (countdown <= 0) { setCountdown(null); useCinema.getState().nextEpisode(); return undefined; }
    const t = setTimeout(() => setCountdown((c) => (c == null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const onEnded = () => {
    saveNow();
    const s = useCinema.getState(); const p = s.playing;
    if (p && s.prefs.autoNext && p.epIdx < p.item.episodes.length - 1) setCountdown(6);
  };
  const onError = () => {
    // Formato que o navegador não toca (ex.: .ogv no iPhone): tenta a próxima qualidade.
    const p = useCinema.getState().playing; if (!p) return;
    const list = p.item.episodes[p.epIdx].sources;
    if (p.srcIdx < list.length - 1) useCinema.getState().setSource(p.srcIdx + 1, vRef.current?.currentTime || p.startAt || 0);
    else setFailed(true);
  };

  // Atalhos de teclado na tela de assistir.
  useEffect(() => {
    if (!watching) return undefined;
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (e.ctrlKey || e.metaKey || e.altKey || tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      const v = vRef.current; if (!v) return;
      const k = e.key.toLowerCase();
      const seek = (d) => { v.currentTime = Math.max(0, Math.min((v.duration || 1e9) - 0.5, v.currentTime + d)); };
      if (k === ' ' || k === 'k') { if (tag === 'button' && k === ' ') return; e.preventDefault(); if (v.paused) v.play().catch(() => {}); else v.pause(); }
      else if (k === 'arrowleft') { e.preventDefault(); seek(-5); }
      else if (k === 'arrowright') { e.preventDefault(); seek(5); }
      else if (k === 'j') seek(-10);
      else if (k === 'l') seek(10);
      else if (k === 'm') v.muted = !v.muted;
      else if (k === 'f') { if (document.fullscreenElement) document.exitFullscreen?.(); else (v.requestFullscreen || v.webkitEnterFullscreen)?.call(v); }
      else if (k === 'n') useCinema.getState().nextEpisode();
      else if (k === 'c') {
        const s = useCinema.getState(); const p = s.playing; const subs = p?.item.episodes[p.epIdx].subtitles || [];
        if (subs.length) s.setSub(p.sub ? null : (subs.find((x) => x.lang.startsWith('pt')) || subs[0]).file);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [watching]);

  // Acompanha o lugar do player na tela de assistir.
  useEffect(() => {
    if (!watching || !playing) { setRect(null); return undefined; }
    let raf = 0;
    const tick = () => {
      const raw = document.querySelector('.cine-slot')?.getBoundingClientRect();
      const z = Number(document.documentElement.currentCSSZoom || parseFloat(getComputedStyle(document.documentElement).zoom)) || 1;
      const r = raw && { top: raw.top / z, left: raw.left / z, width: raw.width / z, height: raw.height / z };
      setRect((old) => {
        if (!r) return old;
        if (old && Math.abs(old.top - r.top) < 0.5 && Math.abs(old.left - r.left) < 0.5 && Math.abs(old.width - r.width) < 0.5 && Math.abs(old.height - r.height) < 0.5) return old;
        return r;
      });
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [watching, !!playing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!playing) return null;
  const isMini = !watching;
  const style = !isMini && rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : undefined;
  const nextEp = playing.item.episodes[playing.epIdx + 1];
  return (
    <div className={`cine-host${isMini ? ' is-mini' : ' is-big'}${open && isMini ? ' over-app' : ''}${isMini && ytMini ? ' above-yt' : ''}`} style={style}>
      <div className="cine-frame">
        <video
          ref={vRef}
          className="cine-video"
          controls
          playsInline
          preload="metadata"
          poster={playing.item.thumbnail}
          onPlay={() => { setPaused(false); try { useMusic.getState().setPlaying(false); } catch { /* ignora */ } window.dispatchEvent(new Event('pc-cine-play')); }}
          onPause={() => { setPaused(true); saveNow(); }}
          onTimeUpdate={(e) => { const v = e.currentTarget; if (v.readyState >= 1 && v.currentTime > 0) timeRef.current = { t: v.currentTime, d: v.duration || timeRef.current.d }; }}
          onEnded={onEnded}
          onError={onError}
        >
          {subUrl && <track key={subUrl} kind="subtitles" src={subUrl} srcLang={(ep.subtitles.find((s) => s.file === playing.sub)?.lang || 'pt').slice(0, 2)} label={ep.subtitles.find((s) => s.file === playing.sub)?.label || 'Legenda'} default />}
        </video>
        {failed && (
          <div className="cine-fail">
            <Ico d={P.warn} size={28} />
            <strong>Não deu para tocar este vídeo aqui.</strong>
            <span>O arquivo pode estar fora do ar ou num formato que o seu navegador não toca.</span>
            <a className="cine-btn" href={playing.item.pageUrl} target="_blank" rel="noreferrer"><Ico d={P.ext} /> Abrir no Archive</a>
          </div>
        )}
        {countdown != null && nextEp && (
          <div className="cine-next">
            <small>Próximo episódio em {countdown}s</small>
            <strong data-no-translate>{nextEp.title}</strong>
            <div>
              <button type="button" className="cine-btn is-primary" onClick={() => { setCountdown(null); useCinema.getState().nextEpisode(); }}><Ico d={P.play} fill /> Assistir agora</button>
              <button type="button" className="cine-btn" onClick={() => setCountdown(null)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
      {isMini && (
        <div className="cine-mini-bar">
          <button type="button" className="cine-mini-title" onClick={() => useCinema.getState().restore()} title="Abrir">
            <strong className="truncate" data-no-translate>{playing.item.title}</strong>
            <small className="truncate" data-no-translate>{playing.item.episodes.length > 1 ? `Ep. ${playing.epIdx + 1} · ${ep.title}` : 'Cinema'}</small>
          </button>
          <button type="button" className="cine-mini-btn" onClick={() => { const v = vRef.current; if (v) { if (v.paused) v.play().catch(() => {}); else v.pause(); } }} aria-label={paused ? 'Tocar' : 'Pausar'} title={paused ? 'Tocar' : 'Pausar'}><Ico d={paused ? P.play : P.pause} size={16} fill /></button>
          <button type="button" className="cine-mini-btn" onClick={() => useCinema.getState().restore()} aria-label="Ampliar" title="Ampliar"><Ico d={P.expand} size={16} /></button>
          <button type="button" className="cine-mini-btn" onClick={() => useCinema.getState().close()} aria-label="Fechar" title="Fechar"><Ico d={P.close} size={16} /></button>
        </div>
      )}
    </div>
  );
}

// ---------------- App ----------------
export default function CinemaApp() {
  const st = useCinema();
  const [nav, setNav] = useState({ type: 'home' });
  const [q, setQ] = useState('');
  const mainRef = useRef(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!st.open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) useCinema.getState().minimize(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [st.open]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);

  if (!st.open) return null;

  const go = (n) => { setNav(n); if (n.type !== 'search') setQ(''); st.browse(); mainRef.current?.scrollTo?.({ top: 0 }); };
  const onOpen = (it) => st.showDetail(it.id);
  // Assistir direto de um cartão: carrega o item e retoma o episódio salvo.
  const onPlay = async (it, resume) => {
    try {
      const full = await loadItem(it.id);
      if (!full.episodes.length) { st.showDetail(it.id); return; }
      const prog = useCinema.getState().progress[it.id];
      const idx = resume && prog ? Math.max(0, full.episodes.findIndex((e) => e.key === prog.ep)) : (typeof resume === 'number' ? resume : 0);
      st.play(full, idx);
    } catch { setToast('Não consegui abrir esse título agora.'); }
  };
  const playFromDetail = (item, idx, startAt) => st.play(item, idx, startAt === 0 ? { startAt: 0 } : {});
  const submit = (e) => { e.preventDefault(); const t = q.trim(); if (t) go({ type: 'search', q: t, cat: nav.cat && nav.type !== 'home' ? nav.cat : 'populares' }); };
  const watching = st.view === 'watch' && st.playing;

  return (
    <div className="cine-back" onMouseDown={(e) => { if (e.target === e.currentTarget) st.minimize(); }}>
      <div className="cine" role="dialog" aria-modal="true" aria-label="Cinema">
        <header className="cine-head">
          <button type="button" className="cine-brand" onClick={() => go({ type: 'home' })} title="Início do Cinema">
            <span className="cine-logo"><Ico d={P.film} size={20} /></span>
            <span className="cine-brand-t"><strong>Cinema</strong><small>filmes · séries · desenhos</small></span>
          </button>
          <form className="cine-search" onSubmit={submit} role="search">
            <Ico d={P.search} size={17} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar filmes, séries, desenhos…" aria-label="Buscar no Cinema" enterKeyHint="search" />
          </form>
          <nav className="cine-nav">
            <button type="button" className={`cine-icon${st.view === 'browse' && nav.type === 'home' ? ' is-on' : ''}`} onClick={() => go({ type: 'home' })} title="Início" aria-label="Início"><Ico d={P.home} /></button>
            <button type="button" className={`cine-icon${st.view === 'browse' && nav.type !== 'home' ? ' is-on' : ''}`} onClick={() => go({ type: 'cat', cat: nav.cat || 'filmes' })} title="Categorias" aria-label="Categorias"><Ico d={P.grid} /></button>
            {st.playing && !watching && <button type="button" className="cine-icon is-live" onClick={st.restore} title="Voltar ao vídeo" aria-label="Voltar ao vídeo"><Ico d={P.play} fill /></button>}
            <button type="button" className="cine-icon" onClick={st.minimize} title={st.playing ? 'Minimizar (continua tocando)' : 'Fechar'} aria-label="Minimizar"><Ico d={st.playing ? P.mini : P.close} /></button>
            {st.playing && <button type="button" className="cine-icon" onClick={st.close} title="Fechar e parar" aria-label="Fechar"><Ico d={P.close} /></button>}
          </nav>
        </header>
        <div className="cine-body" ref={mainRef}>
          {watching ? <WatchView onOpen={onOpen} />
            : st.view === 'detail' && st.detailId ? (
              <>
                <button type="button" className="cine-back-btn" onClick={() => st.browse()}><Ico d={P.back} size={16} /> Voltar</button>
                <DetailView id={st.detailId} onPlay={playFromDetail} go={go} />
              </>
            )
              : nav.type === 'home' ? <HomeView go={go} onOpen={onOpen} onPlay={onPlay} />
                : <GridView view={nav} go={go} onOpen={onOpen} mainRef={mainRef} />}
        </div>
        {toast && <div className="cine-toast" role="status">{toast}</div>}
      </div>
    </div>
  );
}

