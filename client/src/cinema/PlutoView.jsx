import { useCallback, useEffect, useRef, useState } from 'react';
import { plutoMeta, plutoList } from '../api/endpoints';
import { useStore } from '../store/useStore';
import { P, Ico, CineCard, Skeletons } from './ui.jsx';
import { toCard } from './CatalogViews.jsx';

// ============================================================
// Filmes e Séries → Grátis na Pluto TV.
// A Pluto TV não tem API pública nem player incorporável, e os Termos
// de Uso dela proíbem robôs nas páginas. Então o catálogo vem do TMDB
// (dados licenciados do JustWatch: o que está na Pluto TV no Brasil) e o
// vídeo abre no site oficial (grátis, com anúncios, sem cadastro).
// ============================================================

export const PLUTO_HOME = 'https://pluto.tv/br/on-demand';
const TYPES = [['all', 'Tudo'], ['movie', 'Filmes'], ['tv', 'Séries']];
const YEARS = [['2001', 'De 2001 em diante'], ['2010', 'De 2010 em diante'], ['2020', 'De 2020 em diante'], ['0', 'Qualquer ano']];
const SORTS = [['populares', 'Mais populares'], ['recentes', 'Mais recentes'], ['nota', 'Mais bem avaliados'], ['titulo', 'Título (A–Z)']];
const DEFAULTS = { type: 'all', yearFrom: '2001', genre: '', lang: '', sort: 'populares' };
const SS_KEY = 'pc-cine-pluto-filters';

const loadFilters = () => { try { return { ...DEFAULTS, ...JSON.parse(sessionStorage.getItem(SS_KEY) || '{}') }; } catch { return { ...DEFAULTS }; } };

export function PlutoLogo({ size = 22 }) {
  return <span className="pluto-logo" style={{ width: size, height: size }} aria-hidden="true"><Ico d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM3 13c4 2 14 2 18-2" size={size * 0.68} /></span>;
}

export default function PlutoView({ q, onOpen, mainRef, clearSearch }) {
  const isStaff = useStore((s) => ['ADMIN', 'MODERATOR'].includes(s.user?.platformRole));
  const [meta, setMeta] = useState(null); // null = carregando
  const [f, setF] = useState(loadFilters);
  const [st, setSt] = useState({ items: [], page: 0, total: 0, hasMore: true, loading: true, error: false, building: false });
  const busy = useRef(false);
  const stRef = useRef(st); stRef.current = st;
  const key = JSON.stringify({ ...f, q: q || '' });
  const keyRef = useRef(key);

  const set = (patch) => setF((old) => { const n = { ...old, ...patch }; try { sessionStorage.setItem(SS_KEY, JSON.stringify(n)); } catch { /* ignora */ } return n; });

  useEffect(() => {
    let alive = true;
    plutoMeta().then((m) => alive && setMeta(m)).catch(() => alive && setMeta({ enabled: true, error: true, genres: [], langs: [] }));
    return () => { alive = false; };
  }, []);

  const load = useCallback(async (page) => {
    const k = keyRef.current;
    busy.current = true;
    setSt((s) => ({ ...(page === 1 ? { items: [], total: 0 } : s), page: page === 1 ? 0 : s.page, hasMore: true, loading: true, error: false, building: s.building }));
    try {
      const r = await plutoList({ ...f, q: q || '', page });
      if (keyRef.current !== k) return;
      setSt((s) => {
        const seen = new Set(page === 1 ? [] : s.items.map((x) => x.id));
        return { items: [...(page === 1 ? [] : s.items), ...r.items.filter((x) => !seen.has(x.id)).map(toCard)], page, total: r.total, hasMore: r.hasMore, loading: false, error: false, building: !!r.building };
      });
    } catch (e) {
      if (keyRef.current === k) setSt((s) => ({ ...s, loading: false, hasMore: false, error: e?.response?.status === 503 ? 'off' : true }));
    } finally { if (keyRef.current === k) busy.current = false; }
  }, [f, q]);

  useEffect(() => {
    if (meta && meta.enabled === false) return;
    keyRef.current = key; busy.current = false;
    load(1); mainRef.current?.scrollTo?.({ top: 0 });
  }, [key, meta?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Índice ainda montando no servidor (primeira vez): recarrega em alguns segundos.
  useEffect(() => {
    if (!st.building) return undefined;
    const t = setTimeout(() => { load(1); plutoMeta().then(setMeta).catch(() => {}); }, 6000);
    return () => clearTimeout(t);
  }, [st.building, load]);

  const sentinel = useRef(null);
  useEffect(() => {
    const el = sentinel.current; if (!el) return undefined;
    const io = new IntersectionObserver((ents) => {
      const s = stRef.current;
      if (ents.some((e) => e.isIntersecting) && s.hasMore && !s.loading && !busy.current && s.page > 0) load(s.page + 1);
    }, { root: mainRef.current, rootMargin: '700px' });
    io.observe(el);
    return () => io.disconnect();
  }, [load, mainRef]);

  if (meta && meta.enabled === false) {
    return (
      <div className="pluto-off">
        <PlutoLogo size={56} />
        <h3>Catálogo da Pluto TV ainda não está ativado</h3>
        <p>A Pluto TV é grátis (com anúncios) e não pede cadastro. Enquanto o catálogo não é ativado aqui, você pode abrir a Pluto TV direto no site oficial.</p>
        <a className="cine-btn is-primary" href={PLUTO_HOME} target="_blank" rel="noreferrer"><Ico d={P.ext} /> Abrir a Pluto TV</a>
        {isStaff && (
          <p className="pluto-off-staff">
            <strong>Staff:</strong> a lista do que está na Pluto TV vem do TMDB (dados do JustWatch). Crie uma chave grátis em{' '}
            <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">themoviedb.org</a> e coloque em <code>TMDB_API_KEY</code> na Shard Cloud.
          </p>
        )}
      </div>
    );
  }

  const changed = f.type !== DEFAULTS.type || f.yearFrom !== DEFAULTS.yearFrom || f.genre || f.lang || f.sort !== DEFAULTS.sort || q;
  const genres = meta?.genres || [];
  return (
    <>
      <section className="pluto-banner">
        <PlutoLogo size={40} />
        <div>
          <strong>Grátis na Pluto TV</strong>
          <span>Filmes e séries liberados de graça (com anúncios), sem cadastro. Escolha aqui e assista no site oficial da Pluto TV.</span>
        </div>
        <a className="cine-btn" href={PLUTO_HOME} target="_blank" rel="noreferrer"><Ico d={P.ext} /> Abrir a Pluto TV</a>
      </section>

      <div className="pluto-filters">
        <div className="pluto-seg" role="tablist" aria-label="Tipo">
          {TYPES.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={f.type === id} className={f.type === id ? 'is-on' : ''} onClick={() => set({ type: id })}>{label}{meta?.counts && id !== 'all' ? <small>{id === 'movie' ? meta.counts.movie : meta.counts.tv}</small> : null}</button>)}
        </div>
        <label className="cine-select"><span>Ano</span>
          <select value={f.yearFrom} onChange={(e) => set({ yearFrom: e.target.value })}>{YEARS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="cine-select"><span>Idioma original</span>
          <select value={f.lang} onChange={(e) => set({ lang: e.target.value })}>
            <option value="">Todos</option>
            {(meta?.langs || []).map((l) => <option key={l.code} value={l.code}>{l.name} ({l.count})</option>)}
          </select>
        </label>
        <label className="cine-select"><span>Ordenar</span>
          <select value={f.sort} onChange={(e) => set({ sort: e.target.value })}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        {changed && <button type="button" className="cine-link" onClick={() => { set(DEFAULTS); clearSearch?.(); }}>Limpar filtros</button>}
      </div>

      <div className="cine-chips" role="tablist" aria-label="Gêneros">
        <button type="button" role="tab" aria-selected={!f.genre} className={`cine-chip${!f.genre ? ' is-on' : ''}`} onClick={() => set({ genre: '' })}>Todos os gêneros</button>
        {meta === null ? <span className="cine-chip is-skel" /> : genres.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={String(f.genre) === String(g.id)} className={`cine-chip${String(f.genre) === String(g.id) ? ' is-on' : ''}`} onClick={() => set({ genre: String(g.id) })}>{g.name}</button>
        ))}
      </div>

      <div className="cine-grid-h">
        <h3>{q ? <>Resultados para “<span data-no-translate>{q}</span>”</> : 'Na Pluto TV agora'}</h3>
        {!st.loading || st.items.length ? <small>{st.total.toLocaleString('pt-BR')} títulos</small> : null}
        {st.building && <small className="pluto-building">· atualizando o catálogo…</small>}
      </div>

      {st.error && (
        <div className="cine-notice" role="status"><Ico d={P.warn} /> Não consegui carregar o catálogo agora. <button type="button" className="cine-link" onClick={() => load(1)}>Tentar de novo</button> <a className="cine-link" href={PLUTO_HOME} target="_blank" rel="noreferrer">Abrir a Pluto TV</a></div>
      )}
      {!st.loading && !st.error && !st.items.length && (
        <div className="cine-empty">
          <PlutoLogo size={40} />
          <strong>Nenhum título com esses filtros</strong>
          <span>{q ? 'Esse título pode não estar na Pluto TV no momento.' : 'Tente outro gênero, idioma ou “Qualquer ano”.'}</span>
          {changed && <button type="button" className="cine-btn" onClick={() => { set(DEFAULTS); clearSearch?.(); }}>Limpar filtros</button>}
        </div>
      )}
      <div className="cine-grid">
        {st.items.map((it) => <CineCard key={it.id} it={it} onOpen={(x) => onOpen(x, { pluto: true })} />)}
        {st.loading && <Skeletons n={st.items.length ? 6 : 18} />}
      </div>
      <div ref={sentinel} className="cine-sentinel" aria-hidden="true" />
      <p className="cine-foot">
        O áudio (dublado ou original) e as legendas variam por título; a Pluto TV mostra as opções no próprio player.
        Disponibilidade: JustWatch via TMDB, atualizada a cada 12 h. Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB. Pluto TV é marca da Paramount.
      </p>
    </>
  );
}
