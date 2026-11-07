import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCinema } from './cinemaStore';
import { catHome, catList, catSearch, catItem } from '../api/endpoints';
import { useMusic } from '../music/musicStore';
import { useYouTubeApp } from '../youtube/youtubeStore';
import { useStore } from '../store/useStore';
import { P, Ico, KIND, fmtDur, Art, CineCard, Skeletons, Row, translateUrl } from './ui.jsx';

// ============================================================
// Cinema → Lançamentos: filmes, séries e anime recentes (anos 2020).
// Só catálogo, trailers e ONDE ASSISTIR legalmente — o vídeo completo
// fica nos serviços oficiais (Netflix, Prime, Crunchyroll...).
// ============================================================

const KINDS = [['todos', 'Tudo'], ['filme', 'Filmes'], ['serie', 'Séries'], ['anime', 'Anime']];
const SOURCE = { tmdb: 'TMDB', mal: 'MyAnimeList', tvm: 'TVmaze', itn: 'Apple TV' };
export const toCard = (c) => (c ? { ...c, thumbnail: c.poster, duration: null } : null);

// Pausa o resto (música, YouTube, player do Cinema) quando um trailer começa.
const pauseOthers = () => {
  try { useMusic.getState().setPlaying(false); } catch { /* ignora */ }
  window.dispatchEvent(new Event('pc-cine-play'));
  window.dispatchEvent(new Event('pc-trailer-play'));
};

// ---------------- Destaque rotativo ----------------
function CatalogHero({ items, onOpen }) {
  const [i, setI] = useState(0);
  const [hover, setHover] = useState(false);
  const list = items.slice(0, 6);
  useEffect(() => {
    if (list.length < 2 || hover) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % list.length), 8000);
    return () => clearInterval(t);
  }, [list.length, hover]);
  const it = list[i % Math.max(1, list.length)];
  if (!it) return <div className="cine-hero is-skel" />;
  return (
    <section className={`cine-hero is-cat${it.backdrop ? ' has-backdrop' : ''}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <img key={it.id} className={`cine-hero-bg${it.backdrop ? ' is-backdrop' : ''}`} src={it.backdrop || it.poster} alt="" referrerPolicy="no-referrer" aria-hidden="true" />
      <div className="cine-hero-in">
        <img className="cine-hero-poster" src={it.poster} alt="" referrerPolicy="no-referrer" />
        <div className="cine-hero-txt">
          <span className="cine-pill">{[KIND[it.kind], it.year].filter(Boolean).join(' · ')}{it.rating ? ` · ★ ${it.rating.toFixed(1)}` : ''}</span>
          <h2 data-no-translate>{it.title}</h2>
          {it.genres?.length > 0 && <p className="cine-sub">{it.genres.join(' · ')}</p>}
          {it.overview && <p>{it.overview}</p>}
          <div className="cine-hero-act">
            <button type="button" className="cine-btn is-primary" onClick={() => onOpen(it, { trailer: true })}><Ico d={P.play} fill /> Ver trailer</button>
            <button type="button" className="cine-btn" onClick={() => onOpen(it)}><Ico d={P.tv} /> Onde assistir</button>
          </div>
        </div>
      </div>
      {list.length > 1 && (
        <div className="cine-dots" role="tablist" aria-label="Destaques">
          {list.map((x, n) => <button key={x.id} type="button" role="tab" aria-selected={n === i} aria-label={x.title} className={n === i ? 'is-on' : ''} onClick={() => setI(n)} />)}
        </div>
      )}
    </section>
  );
}

// ---------------- Início ----------------
export function CatalogHome({ go, onOpen }) {
  const { list, toggleList } = useCinema();
  const isStaff = useStore((s) => ['ADMIN', 'MODERATOR'].includes(s.user?.platformRole));
  const [kind, setKind] = useState(() => { try { return sessionStorage.getItem('pc-cine-kind') || 'todos'; } catch { return 'todos'; } });
  const [data, setData] = useState({ rows: null, tmdb: true, error: false });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setData((d) => ({ ...d, error: false }));
    catHome().then((r) => alive && setData({ rows: r.rows || [], tmdb: !!r.tmdb, error: false }))
      .catch(() => alive && setData({ rows: [], tmdb: true, error: true }));
    return () => { alive = false; };
  }, [nonce]);
  const pick = (k) => { setKind(k); try { sessionStorage.setItem('pc-cine-kind', k); } catch { /* ignora */ } };
  const rows = useMemo(() => (data.rows || []).map((r) => ({ ...r, items: r.items.filter((x) => kind === 'todos' || x.kind === kind).map(toCard) }))
    .filter((r) => r.items.length >= 4), [data.rows, kind]);
  const heroItems = useMemo(() => {
    const all = rows.flatMap((r) => r.items).filter((x) => x.overview && (x.backdrop || x.poster));
    const seen = new Set();
    return all.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))).sort((a, b) => (b.backdrop ? 1 : 0) - (a.backdrop ? 1 : 0)).slice(0, 6);
  }, [rows]);
  const myList = list.filter((x) => String(x.id).includes(':') && (kind === 'todos' || x.kind === kind));

  return (
    <>
      <div className="cine-chips" role="tablist" aria-label="Tipo">
        {KINDS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={kind === id} className={`cine-chip${kind === id ? ' is-on' : ''}`} onClick={() => pick(id)}>{label}</button>)}
      </div>
      {data.error ? (
        <div className="cine-notice" role="status"><Ico d={P.warn} /> Não consegui carregar o catálogo agora. <button type="button" className="cine-link" onClick={() => setNonce((n) => n + 1)}>Tentar de novo</button></div>
      ) : data.rows === null ? <div className="cine-hero is-skel" /> : <CatalogHero items={heroItems} onOpen={onOpen} />}
      {!data.tmdb && isStaff && data.rows !== null && (
        <div className="cine-notice is-staff" role="note">
          <Ico d={P.spark} /> <span><strong>Staff:</strong> para liberar filmes e séries em português, os lançamentos dos cinemas e o “onde assistir” completo, crie uma chave grátis em <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">themoviedb.org</a> e coloque em <code>TMDB_API_KEY</code> na Shard Cloud.</span>
        </div>
      )}
      <Row title="Minha lista" items={myList} onOpen={onOpen} onRemove={(it) => toggleList(it)} />
      {data.rows === null
        ? ['Em alta', 'Anime da temporada', 'Séries'].map((t) => <Row key={t} title={t} loading />)
        : rows.map((r) => <Row key={r.list} title={r.label} items={r.items} onOpen={onOpen} onMore={() => go({ type: 'list', list: r.list, label: r.label, kind })} />)}
      <p className="cine-foot">
        Aqui você descobre lançamentos, vê trailers e acha <strong>onde assistir legalmente</strong> no Brasil.
        Filmes completos e grátis ficam em <button type="button" className="cine-link" onClick={() => go({ section: 'classicos' })}>Clássicos grátis</button>.
        {' '}Dados: {data.tmdb ? 'TMDB, ' : ''}MyAnimeList (Jikan), TVmaze e Apple.{data.tmdb ? ' Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB.' : ''}
      </p>
    </>
  );
}

// ---------------- Lista completa ("Ver tudo") ----------------
export function CatalogList({ view, onOpen, mainRef }) {
  const [st, setSt] = useState({ items: [], page: 0, hasMore: true, loading: true, error: false });
  const busy = useRef(false);
  const stRef = useRef(st); stRef.current = st;
  const load = useCallback(async (page) => {
    if (busy.current) return;
    busy.current = true;
    setSt((s) => ({ ...s, loading: true, error: false }));
    try {
      const r = await catList(view.list, page);
      setSt((s) => {
        const seen = new Set(s.items.map((x) => x.id));
        return { items: [...(page === 1 ? [] : s.items), ...r.items.filter((x) => !seen.has(x.id)).map(toCard)], page, hasMore: r.hasMore, loading: false, error: false };
      });
    } catch { setSt((s) => ({ ...s, loading: false, error: true, hasMore: false })); }
    finally { busy.current = false; }
  }, [view.list]);
  useEffect(() => { busy.current = false; setSt({ items: [], page: 0, hasMore: true, loading: true, error: false }); load(1); mainRef.current?.scrollTo?.({ top: 0 }); }, [load, mainRef]);
  const sentinel = useRef(null);
  useEffect(() => {
    const el = sentinel.current; if (!el) return undefined;
    const io = new IntersectionObserver((ents) => {
      const s = stRef.current;
      if (ents.some((e) => e.isIntersecting) && s.hasMore && !s.loading && s.page > 0) load(s.page + 1);
    }, { root: mainRef.current, rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [load, mainRef]);
  const items = st.items.filter((x) => !view.kind || view.kind === 'todos' || x.kind === view.kind);
  return (
    <>
      <div className="cine-grid-h"><h3>{view.label}</h3></div>
      {st.error && <div className="cine-notice" role="status"><Ico d={P.warn} /> Não consegui carregar agora. <button type="button" className="cine-link" onClick={() => load(1)}>Tentar de novo</button></div>}
      <div className="cine-grid">
        {items.map((it) => <CineCard key={it.id} it={it} onOpen={onOpen} />)}
        {st.loading && <Skeletons n={items.length ? 6 : 18} />}
      </div>
      <div ref={sentinel} className="cine-sentinel" aria-hidden="true" />
    </>
  );
}

// ---------------- Busca ----------------
export function CatalogSearch({ view, go, onOpen }) {
  const [st, setSt] = useState({ items: null, error: false });
  const kind = view.kind || 'todos';
  useEffect(() => {
    let alive = true;
    setSt({ items: null, error: false });
    catSearch(view.q, kind).then((r) => alive && setSt({ items: (r.items || []).map(toCard), error: false })).catch(() => alive && setSt({ items: [], error: true }));
    return () => { alive = false; };
  }, [view.q, kind]);
  return (
    <>
      <div className="cine-chips" role="tablist" aria-label="Tipo">
        {KINDS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={kind === id} className={`cine-chip${kind === id ? ' is-on' : ''}`} onClick={() => go({ ...view, kind: id })}>{label}</button>)}
      </div>
      <div className="cine-grid-h"><h3>Resultados para “<span data-no-translate>{view.q}</span>”</h3>{st.items && <small>{st.items.length} títulos</small>}</div>
      {st.error && <div className="cine-notice" role="status"><Ico d={P.warn} /> Não consegui buscar agora.</div>}
      {st.items && !st.items.length && !st.error && (
        <div className="cine-empty"><Ico d={P.search} size={30} /><strong>Nada encontrado</strong><span>Confira a grafia ou tente o nome original (ex.: “Shingeki no Kyojin”, “Dune”).</span></div>
      )}
      <div className="cine-grid">
        {st.items === null ? <Skeletons n={12} /> : st.items.map((it) => <CineCard key={it.id} it={it} onOpen={onOpen} />)}
      </div>
      <p className="cine-foot">Procurando um filme antigo e grátis? <button type="button" className="cine-link" onClick={() => go({ section: 'classicos', q: view.q })}>Buscar “{view.q}” nos Clássicos grátis</button></p>
    </>
  );
}

// ---------------- Detalhes ----------------
const itemCache = new Map();

function Trailer({ t, title }) {
  useEffect(() => { pauseOthers(); }, [t]);
  if (t.youtubeId) {
    const src = `https://www.youtube-nocookie.com/embed/${t.youtubeId}?autoplay=1&rel=0&modestbranding=1&playsinline=1&hl=pt-BR&cc_lang_pref=pt`;
    return <iframe className="cine-trailer-frame" src={src} title={`Trailer: ${title}`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />;
  }
  return <video className="cine-trailer-frame" src={t.url} controls autoPlay playsInline onPlay={pauseOthers} />;
}

function Providers({ it }) {
  const pv = it.providers;
  const groups = pv ? [['Streaming', pv.stream, P.tv], ['Grátis', pv.free, P.gift], ['Alugar', pv.rent, P.ticket], ['Comprar', pv.buy, P.ticket]].filter(([, l]) => l?.length) : [];
  const jw = `https://www.justwatch.com/br/busca?q=${encodeURIComponent(it.original || it.title)}`;
  return (
    <section className="cine-where" id="cine-where">
      <h3>Onde assistir no Brasil</h3>
      {groups.length ? groups.map(([label, list, icon]) => (
        <div key={label} className="cine-where-g">
          <span className="cine-where-l"><Ico d={icon} size={15} /> {label}</span>
          <div className="cine-where-list">
            {list.map((p) => {
              const href = p.url || pv.link;
              const inner = (<>{p.logo ? <img src={p.logo} alt="" referrerPolicy="no-referrer" /> : <span className="cine-prov-ph">{p.name.slice(0, 1)}</span>}<span>{p.name}</span></>);
              return href
                ? <a key={p.name} className="cine-prov" href={href} target="_blank" rel="noreferrer" title={`Abrir em ${p.name}`}>{inner}</a>
                : <span key={p.name} className="cine-prov">{inner}</span>;
            })}
          </div>
        </div>
      )) : <p className="cine-muted">Ainda não achei este título em nenhum serviço no Brasil.</p>}
      <div className="cine-where-foot">
        <a className="cine-link" href={pv?.link || jw} target="_blank" rel="noreferrer"><Ico d={P.ext} size={14} /> Ver todas as opções{pv?.attribution === 'JustWatch' ? ' (JustWatch)' : ' no JustWatch'}</a>
        {it.kind === 'anime' && (
          <button type="button" className="cine-link" onClick={() => { useCinema.getState().minimize(); useYouTubeApp.getState().searchFor(`${it.original || it.title} episódio 1 oficial`); }}>
            <Ico d={P.yt} size={14} /> Procurar episódios oficiais no YouTube
          </button>
        )}
      </div>
    </section>
  );
}

export function CatalogDetail({ id, openTrailer, fromPluto = false, onOpen, go }) {
  const [st, setSt] = useState(() => ({ it: itemCache.get(id) || null, loading: !itemCache.has(id), error: null }));
  const [nonce, setNonce] = useState(0);
  const [trailer, setTrailer] = useState(null);
  const [more, setMore] = useState(false);
  const { list, toggleList } = useCinema();
  const topRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setTrailer(null); setMore(false);
    if (itemCache.has(id)) { setSt({ it: itemCache.get(id), loading: false, error: null }); return undefined; }
    setSt({ it: null, loading: true, error: null });
    catItem(id).then((it) => { itemCache.set(id, it); if (alive) setSt({ it, loading: false, error: null }); })
      .catch((e) => alive && setSt({ it: null, loading: false, error: e?.response?.status === 404 ? 'Título não encontrado.' : 'Não consegui carregar agora.' }));
    return () => { alive = false; };
  }, [id, nonce]);
  // "Ver trailer" no destaque: já abre tocando.
  useEffect(() => { if (openTrailer && st.it?.trailers?.length) setTrailer(st.it.trailers[0]); }, [openTrailer, st.it]);

  if (st.loading) return <div className="cine-detail"><div className="cine-hero is-skel" /></div>;
  if (st.error || !st.it) return <div className="cine-notice" role="status"><Ico d={P.warn} /> {st.error || 'Erro.'} <button type="button" className="cine-link" onClick={() => setNonce((n) => n + 1)}>Tentar de novo</button></div>;
  const it = st.it;
  const inList = list.some((x) => x.id === it.id);
  const pills = [KIND[it.kind], it.year, it.runtime ? fmtDur(it.runtime * 60) : '', it.seasons?.length ? `${it.seasons.length} temporada${it.seasons.length > 1 ? 's' : ''}` : it.episodes ? `${it.episodes} episódios` : '', it.certification].filter(Boolean);
  const playTrailer = (t) => { setTrailer(t); topRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); };
  const english = it.overviewLang === 'en';
  const onPluto = !!it.providers?.pluto;
  // Link do título na Pluto: a página "onde assistir" do TMDB/JustWatch leva
  // direto à página oficial; sem ela, abre o catálogo da Pluto.
  const plutoHref = it.providers?.link || 'https://pluto.tv/br/on-demand';

  return (
    <div className="cine-detail" ref={topRef}>
      {trailer ? (
        <section className="cine-trailer">
          <Trailer t={trailer} title={it.title} />
          <div className="cine-trailer-bar">
            <span><strong data-no-translate>{trailer.title}</strong>{trailer.lang ? <small> · {trailer.lang}</small> : null}{trailer.fromSearch ? <small> · encontrado no YouTube</small> : null}</span>
            <button type="button" className="cine-tool" onClick={() => setTrailer(null)}><Ico d={P.close} size={15} /> Fechar trailer</button>
          </div>
        </section>
      ) : (
        <section className={`cine-hero is-detail is-cat${it.backdrop ? ' has-backdrop' : ''}`}>
          <img className={`cine-hero-bg${it.backdrop ? ' is-backdrop' : ''}`} src={it.backdrop || it.poster} alt="" referrerPolicy="no-referrer" aria-hidden="true" />
          <div className="cine-hero-in">
            <img className="cine-hero-poster" src={it.poster} alt="" referrerPolicy="no-referrer" />
            <div className="cine-hero-txt">
              <span className="cine-pill">{pills.join(' · ')}</span>
              <h2 data-no-translate>{it.title}</h2>
              {it.original && <p className="cine-sub" data-no-translate>{it.original}</p>}
              <div className="cine-meta-row">
                {it.rating ? <span className="cine-score"><Ico d={P.star} size={15} fill /> {it.rating.toFixed(1)}<small>/10 · {SOURCE[it.source]}</small></span> : null}
                {it.status && <span className="cine-meta-chip">{it.status}</span>}
                {it.season && <span className="cine-meta-chip">{it.season}</span>}
                {it.network && <span className="cine-meta-chip" data-no-translate>{it.network}</span>}
              </div>
              {it.tagline && <p className="cine-tagline">“{it.tagline}”</p>}
              <div className="cine-hero-act">
                {onPluto && <a className="cine-btn is-pluto" href={plutoHref} target="_blank" rel="noreferrer" title="Abre o título no site oficial da Pluto TV (grátis, sem cadastro)"><Ico d={P.play} fill /> Assistir grátis na Pluto TV</a>}
                {it.trailers.length > 0 && <button type="button" className={`cine-btn${onPluto ? '' : ' is-primary'}`} onClick={() => playTrailer(it.trailers[0])}><Ico d={P.play} fill={!onPluto} /> Ver trailer</button>}
                <button type="button" className="cine-btn" onClick={() => document.getElementById('cine-where')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><Ico d={P.tv} /> Onde assistir</button>
                <button type="button" className={`cine-btn${inList ? ' is-on' : ''}`} onClick={() => toggleList(toCard(it))}><Ico d={inList ? P.check : P.plus} /> {inList ? 'Na minha lista' : 'Minha lista'}</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {fromPluto && !onPluto && (
        <div className="cine-notice" role="status">
          <Ico d={P.warn} /> <span>Este título <strong>não está mais na Pluto TV</strong> (o catálogo grátis muda toda semana). Veja abaixo onde ele está disponível agora.</span>
        </div>
      )}
      {onPluto && (
        <div className="cine-notice is-pluto" role="note">
          <Ico d={P.tv} /> <span>Grátis na Pluto TV, com anúncios e sem cadastro. O vídeo abre no site oficial da Pluto TV (ela não permite tocar em outros sites); áudio e legendas são escolhidos no player de lá.</span>
        </div>
      )}
      {it.trailers.length > 1 && (
        <section className="cine-trailers">
          <h3>Trailers</h3>
          <div className="cine-trailer-list">
            {it.trailers.map((t) => (
              <button key={t.youtubeId || t.url} type="button" className={`cine-trailer-chip${trailer === t ? ' is-on' : ''}`} onClick={() => playTrailer(t)}>
                {t.youtubeId ? <img src={`https://i.ytimg.com/vi/${t.youtubeId}/mqdefault.jpg`} alt="" referrerPolicy="no-referrer" /> : <span className="cine-art-fallback"><Ico d={P.play} /></span>}
                <span><strong data-no-translate>{t.title}</strong>{t.lang && <small>{t.lang}</small>}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="cine-detail-grid">
        <div>
          {it.overview && (
            <section className="cine-about">
              <h3>Sinopse</h3>
              <p className={more ? '' : 'is-clamped'} lang={english ? 'en' : 'pt'}>{it.overview}</p>
              <div className="cine-about-act">
                {it.overview.length > 320 && <button type="button" className="cine-link" onClick={() => setMore((m) => !m)}>{more ? 'Mostrar menos' : 'Mostrar mais'}</button>}
                {english && <a className="cine-link" href={translateUrl(it.overview)} target="_blank" rel="noreferrer"><Ico d={P.translate} size={15} /> Traduzir para português</a>}
              </div>
              {it.genres?.length > 0 && <div className="cine-tags">{it.genres.map((g) => <span key={g} className="cine-tag is-static">{g}</span>)}</div>}
              {it.creators?.length > 0 && <p className="cine-muted">{it.kind === 'filme' ? 'Direção' : 'Criação'}: <span data-no-translate>{it.creators.join(', ')}</span></p>}
            </section>
          )}
          {it.cast?.length > 0 && (
            <section className="cine-cast">
              <h3>Elenco</h3>
              <div className="cine-cast-list">
                {it.cast.map((c) => (
                  <div key={`${c.name}-${c.role}`} className="cine-person">
                    {c.photo ? <img src={c.photo} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="cine-person-ph">{c.name.slice(0, 1)}</span>}
                    <strong data-no-translate>{c.name}</strong>
                    {c.role && <small data-no-translate>{c.role}</small>}
                  </div>
                ))}
              </div>
            </section>
          )}
          {it.seasons?.length > 0 && (
            <section className="cine-seasons">
              <h3>Temporadas</h3>
              <div className="cine-season-list">
                {it.seasons.map((s) => (
                  <div key={s.number} className="cine-season">
                    {s.poster ? <img src={s.poster} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="cine-season-ph">T{s.number}</span>}
                    <span><strong data-no-translate>{s.name}</strong><small>{[s.episodes ? `${s.episodes} episódios` : '', s.year].filter(Boolean).join(' · ')}</small></span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <aside>
          <Providers it={it} />
          {it.links?.length > 0 && (
            <section className="cine-links">
              <h3>Links</h3>
              <div className="cine-tags">{it.links.map((l) => <a key={l.url} className="cine-tag" href={l.url} target="_blank" rel="noreferrer"><Ico d={P.ext} size={12} /> {l.name}</a>)}</div>
            </section>
          )}
        </aside>
      </div>

      <Row title="Você também pode gostar" items={(it.recommendations || []).map(toCard)} onOpen={onOpen} />
      <p className="cine-foot">Fonte: {SOURCE[it.source]}{it.providers?.attribution === 'JustWatch' ? ' · onde assistir: JustWatch' : ''}. <button type="button" className="cine-link" onClick={() => go({ section: 'classicos', q: it.original || it.title })}>Procurar nos Clássicos grátis</button></p>
    </div>
  );
}
