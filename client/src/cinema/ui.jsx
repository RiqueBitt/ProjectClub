import { useRef, useState } from 'react';

// Peças visuais compartilhadas do Cinema (Lançamentos e Clássicos grátis).

export const P = {
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
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  tv: 'M3 7h18v12H3zM8 3l4 4 4-4',
  yt: 'M3.5 8.2c.2-1.6 1.3-2.7 2.9-2.8C8.2 5.2 10 5.1 12 5.1s3.8.1 5.6.3c1.6.1 2.7 1.2 2.9 2.8.2 1.3.2 2.5.2 3.8s0 2.5-.2 3.8c-.2 1.6-1.3 2.7-2.9 2.8-1.8.2-3.6.3-5.6.3s-3.8-.1-5.6-.3c-1.6-.1-2.7-1.2-2.9-2.8C3.3 14.5 3.3 13.3 3.3 12s0-2.5.2-3.8ZM10 9v6l5-3-5-3Z',
  ticket: 'M3 8V6h18v2a2 2 0 0 0 0 4v2H3v-2a2 2 0 0 0 0-4zM3 14v4h18v-4M14 6v12',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0',
};
export const Ico = ({ d, size = 18, fill = false }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);


export const KIND = { filme: 'Filme', serie: 'Série', desenho: 'Desenho', anime: 'Anime' };

export function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return '';
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
export const fmtDur = (s) => {
  if (!s) return '';
  const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m ? `${m} min` : ''}`.trim() : `${m} min`;
};

// Cache simples dos itens já abertos (detalhe -> assistir sem refazer o pedido).

// ---------------- Cartões ----------------
export function Art({ src, alt = '' }) {
  const [bad, setBad] = useState(false);
  return (
    <span className="cine-art">
      {!bad && <img className="cine-art-bg" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" aria-hidden="true" />}
      {!bad ? <img className="cine-art-img" src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />
        : <span className="cine-art-fallback"><Ico d={P.film} size={34} /></span>}
    </span>
  );
}

export function CineCard({ it, prog, onOpen, onRemove }) {
  const pct = prog?.d ? Math.min(100, Math.max(2, (prog.t / prog.d) * 100)) : 0;
  return (
    <div className="cine-card">
      <button type="button" className="cine-card-btn" onClick={() => onOpen(it)} title={it.title}>
        <span className="cine-card-media">
          <Art src={it.thumbnail} alt="" />
          <span className="cine-card-kind">{KIND[it.kind] || 'Filme'}</span>
          {it.rating && !onRemove ? <span className="cine-card-dur is-rating">★ {Number(it.rating).toFixed(1)}</span>
            : it.duration && !onRemove ? <span className="cine-card-dur">{fmtDur(it.duration)}</span> : null}
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

export function Skeletons({ n = 8, row = false }) {
  return Array.from({ length: n }, (_, i) => <div key={i} className={`cine-card cine-skel${row ? ' in-row' : ''}`}><span className="cine-art" /><span className="cine-skel-l" /><span className="cine-skel-l short" /></div>);
}

export function Row({ title, items, progress, onOpen, onMore, onRemove, loading }) {
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


export const translateUrl = (text) => `https://translate.google.com/?sl=auto&tl=pt&op=translate&text=${encodeURIComponent(text.slice(0, 4500))}`;
