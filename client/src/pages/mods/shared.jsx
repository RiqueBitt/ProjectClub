import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { steamCoverUrl } from '../../utils/mods';
import { proxyImage } from '../../utils/imageProxy';

// Peças visuais compartilhadas do sistema de Mods (álbum, gerenciador,
// telas de cada fonte). Ícones são SVG de traço locais — emoji vira
// quadradinho no Linux, então nada de emoji como ícone de interface.
const PATHS = {
  play: 'M7 4.5v15l12-7.5-12-7.5Z',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-12Z',
  upload: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M4 20h16',
  back: 'm15 18-6-6 6-6',
  next: 'm9 18 6-6-6-6',
  search: 'm20 20-4.2-4.2M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z',
  puzzle: 'M9.5 4.5a2.5 2.5 0 0 1 5 0V6H18a1 1 0 0 1 1 1v3.5h-1.5a2.5 2.5 0 0 0 0 5H19V19a1 1 0 0 1-1 1h-3.5v-1.5a2.5 2.5 0 0 0-5 0V20H6a1 1 0 0 1-1-1v-3.5h1.5a2.5 2.5 0 0 0 0-5H5V7a1 1 0 0 1 1-1h3.5V4.5Z',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15.5 8.5l-2 5-5 2 2-5 5-2Z',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  layers: 'm12 3 9 5-9 5-9-5 9-5ZM3 12.5l9 5 9-5M3 16.5l9 5 9-5',
  file: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  thumb: 'M7 11v9H4v-9h3Zm0 0 4-7a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.3 20H7',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4',
  pin: 'M9 4h6l-1 6 3 3H7l3-3-1-6ZM12 13v7',
  alert: 'M12 3 2 20h20L12 3ZM12 10v4M12 17h.01',
  monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
  gamepad: 'M6 9h12a4 4 0 0 1 3.9 4.8l-.8 3.6a2.3 2.3 0 0 1-3.9 1L15 16H9l-2.2 2.4a2.3 2.3 0 0 1-3.9-1l-.8-3.6A4 4 0 0 1 6 9ZM8 11.5v3M6.5 13h3M15.5 12.5h.01M17.5 14.5h.01',
  box: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3ZM4 7.5l8 4.5 8-4.5M12 12v9',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  sort: 'M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  chat: 'M4 5h16v11H8l-4 4V5Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6l1-7Z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM15.5 5.2l3.8-1 3.2 14.6-3.8 1z',
};

export function Icon({ name, size = 18, strokeWidth = 1.8, filled = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mdx-icon">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function formatCount(n) {
  if (!n) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// Cada fonte de mods com seu nome e uma cor de identificação (só pro
// pontinho/realce do chip — o resto segue o tema).
export const SOURCE_META = {
  modio: { label: 'mod.io', long: 'mod.io', color: '#07c1d8' },
  workshop: { label: 'Workshop', long: 'Steam Workshop', color: '#66c0f4' },
  gamebanana: { label: 'GameBanana', long: 'GameBanana', color: '#f5c542' },
  thunderstore: { label: 'Thunderstore', long: 'Thunderstore', color: '#a78bfa' },
  nexus: { label: 'Nexus', long: 'Nexus Mods', color: '#e6873c' },
};
export const SOURCE_ORDER = ['nexus', 'modio', 'thunderstore', 'workshop', 'gamebanana'];

// Item pedido: "não precisa mostrar que os mods são do Nexus etc.,
// mostre só mods" — o chip de origem não aparece mais em lugar nenhum.
// eslint-disable-next-line no-unused-vars
export function SourceChip({ source, long = false }) {
  const meta = null;
  if (!meta) return null;
  return (
    <span className="mdx-source-chip" style={{ '--src': meta.color }}>
      <span className="mdx-source-dot" />
      {long ? meta.long : meta.label}
    </span>
  );
}

// Cor estável por nome (mesmo jogo = mesma capa gerada sempre).
export function hashHue(text) {
  let h = 0;
  for (const ch of String(text || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// Capa gerada (gradiente + nome do jogo) — usada quando a Steam não
// tem a arte vertical do jogo, ou quando a imagem não carrega.
export function GeneratedCover({ name, iconUrl }) {
  const hue = hashHue(name);
  const [iconFailed, setIconFailed] = useState(false);
  return (
    <div className="mdx-gen-cover" style={{ '--h1': hue, '--h2': (hue + 48) % 360 }}>
      <span className="mdx-gen-cover-glyph"><Icon name="gamepad" size={22} /></span>
      {iconUrl && !iconFailed && (
        <img className="mdx-gen-cover-icon" src={proxyImage(iconUrl)} alt="" onError={() => setIconFailed(true)} />
      )}
      <span className="mdx-gen-cover-name">{name}</span>
    </div>
  );
}

// Capa vertical do jogo (library_600x900 da Steam) com reserva bonita.
export function GameCover({ appId, name, iconUrl }) {
  const [failed, setFailed] = useState(!appId);
  if (failed) return <GeneratedCover name={name} iconUrl={iconUrl} />;
  return <img className="mdx-cover-img" src={steamCoverUrl(appId)} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function EmptyState({ icon = 'info', title, children, tone, action }) {
  return (
    <div className={`mdx-empty ${tone ? `tone-${tone}` : ''}`}>
      <span className="mdx-empty-icon"><Icon name={icon} size={26} /></span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function SkeletonGrid({ count = 8, variant = 'mod' }) {
  return (
    <div className={variant === 'poster' ? 'mdx-album-grid' : 'mdx-mod-grid'} aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`mdx-skel mdx-skel-${variant}`} style={{ animationDelay: `${(i % 6) * 0.08}s` }} />
      ))}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder }) {
  return (
    <label className="mdx-search">
      <Icon name="search" size={17} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {value && (
        <button type="button" className="mdx-search-clear" onClick={() => onChange('')} aria-label="Limpar busca"><Icon name="close" size={14} /></button>
      )}
    </label>
  );
}

export function ChipRow({ options, value, onChange, label }) {
  return (
    <div className="mdx-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={`mdx-chip ${value === o.value ? 'active' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count != null && <span className="mdx-chip-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// Miniatura 16:9 com reserva (img de verdade + onError, pra nunca
// sobrar uma caixa cinza vazia sem explicação).
export function ModThumb({ url, fallbackIcon = 'puzzle', seed }) {
  // Tenta pelo nosso servidor primeiro, depois direto na fonte, e só
  // então mostra o ícone padrão.
  const sources = useMemo(() => (url ? [...new Set([proxyImage(url), url])] : []), [url]);
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [sources]);
  const failed = idx >= sources.length;
  const hue = hashHue(seed || url || '');
  return (
    <div className="mdx-thumb" style={{ '--h1': hue }}>
      {!failed && <img src={sources[idx]} alt="" loading="lazy" onError={() => setIdx((i) => i + 1)} />}
      {failed && <span className="mdx-thumb-fallback"><Icon name={fallbackIcon} size={30} /></span>}
    </div>
  );
}

// Cartão de mod da grade "Explorar" (todas as fontes usam o mesmo).
export function ModTile({ thumb, fallbackIcon, title, author, stats = [], installed, installedLabel = 'Instalado', pinned, onClick, children }) {
  const body = (
    <>
      <div className="mdx-tile-media">
        <ModThumb url={thumb} fallbackIcon={fallbackIcon} seed={title} />
        {installed && <span className="mdx-tile-badge"><Icon name="check" size={13} strokeWidth={2.6} /> {installedLabel}</span>}
        {pinned && <span className="mdx-tile-pin" title="Fixado"><Icon name="pin" size={13} /></span>}
      </div>
      <div className="mdx-tile-body">
        <span className="mdx-tile-title">{title}</span>
        {author && <span className="mdx-tile-author">{author}</span>}
        {stats.length > 0 && (
          <div className="mdx-tile-stats">
            {stats.filter(Boolean).map((s) => (
              <span key={s.icon} className="mdx-stat"><Icon name={s.icon} size={13} /> {s.value}</span>
            ))}
          </div>
        )}
      </div>
    </>
  );
  if (onClick) {
    return <button type="button" className="mdx-tile" onClick={onClick}>{body}</button>;
  }
  return <div className="mdx-tile">{body}{children && <div className="mdx-tile-actions">{children}</div>}</div>;
}

export function LoadMore({ busy, onClick, label = 'Ver mais' }) {
  return (
    <button type="button" className="mdx-load-more" disabled={busy} onClick={onClick}>
      {busy ? 'Carregando...' : label}
    </button>
  );
}

export function progressLabel(p) {
  if (!p) return '';
  if (p.phase === 'downloading') return `Baixando ${p.percent ?? 0}%`;
  if (p.phase === 'extracting') return 'Extraindo arquivos...';
  if (p.phase === 'installing') return 'Instalando...';
  if (p.phase === 'done') return 'Concluído!';
  return 'Preparando...';
}

export function ProgressBar({ percent, indeterminate }) {
  return (
    <div className={`mdx-progress ${indeterminate ? 'indeterminate' : ''}`}>
      <span style={{ width: indeterminate ? undefined : `${Math.max(3, percent || 0)}%` }} />
    </div>
  );
}

// Esqueleto comum das páginas de detalhe de mod (mod.io, GameBanana,
// Thunderstore): cabeçalho grande com miniatura + estatísticas + botão
// de instalar, e embaixo duas colunas (conteúdo / lateral).
// ---------- Galeria de imagens do mod (estilo Nexus) ----------
// Faixa rolável de screenshots com setas, contador e tela cheia.
// images: lista de URLs (ou { thumb, full }).
export function ModGallery({ images }) {
  const list = useMemo(() => (images || []).map((i) => (typeof i === 'string' ? { thumb: i, full: i } : i)).filter((i) => i.thumb || i.full), [images]);
  const stripRef = useRef(null);
  const [open, setOpen] = useState(null); // índice aberto em tela cheia
  const [edges, setEdges] = useState({ start: true, end: false });
  const updateEdges = () => {
    const el = stripRef.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(() => { updateEdges(); }, [list.length]);
  useEffect(() => {
    if (open == null) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen((i) => (i + 1) % list.length);
      if (e.key === 'ArrowLeft') setOpen((i) => (i - 1 + list.length) % list.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, list.length]);
  if (list.length === 0) return null;
  const scrollBy = (dir) => stripRef.current?.scrollBy({ left: dir * stripRef.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <div className="mdx-gallery">
      <div className="mdx-gallery-strip" ref={stripRef} onScroll={updateEdges}>
        {list.map((img, i) => (
          <GalleryShot key={`${img.thumb}-${i}`} img={img} onOpen={() => setOpen(i)} />
        ))}
      </div>
      {!edges.start && <button type="button" className="mdx-gallery-arrow prev" aria-label="Imagens anteriores" onClick={() => scrollBy(-1)}><Icon name="back" size={18} /></button>}
      {!edges.end && <button type="button" className="mdx-gallery-arrow next" aria-label="Próximas imagens" onClick={() => scrollBy(1)}><Icon name="next" size={18} /></button>}
      {list.length > 1 && <span className="mdx-gallery-count">{list.length} imagens</span>}
      {open != null && createPortal(
        <div className="mdx-lightbox" role="dialog" aria-modal="true" aria-label="Imagem do mod" onClick={() => setOpen(null)}>
          <img src={proxyImage(list[open].full || list[open].thumb)} alt="" onClick={(e) => e.stopPropagation()} />
          <button type="button" className="mdx-lightbox-close" aria-label="Fechar" onClick={() => setOpen(null)}><Icon name="close" size={20} /></button>
          {list.length > 1 && (
            <>
              <button type="button" className="mdx-lightbox-nav prev" aria-label="Anterior" onClick={(e) => { e.stopPropagation(); setOpen((i) => (i - 1 + list.length) % list.length); }}><Icon name="back" size={22} /></button>
              <button type="button" className="mdx-lightbox-nav next" aria-label="Próxima" onClick={(e) => { e.stopPropagation(); setOpen((i) => (i + 1) % list.length); }}><Icon name="next" size={22} /></button>
              <span className="mdx-lightbox-count">{open + 1} / {list.length}</span>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function GalleryShot({ img, onOpen }) {
  const sources = useMemo(() => [...new Set([proxyImage(img.thumb || img.full), img.thumb || img.full])], [img]);
  const [idx, setIdx] = useState(0);
  if (idx >= sources.length) return null; // imagem quebrada: some da faixa
  return (
    <button type="button" className="mdx-gallery-shot" onClick={onOpen}>
      <img src={sources[idx]} alt="" loading="lazy" onError={() => setIdx((i) => i + 1)} />
    </button>
  );
}

// ---------- Ficha do mod (datas, autor, verificação de vírus) ----------
// items: [{ label, value, tone?: 'ok' | 'bad' | 'accent', icon? }]
export function ModInfoGrid({ items }) {
  const list = (items || []).filter((i) => i && i.value);
  if (list.length === 0) return null;
  return (
    <dl className="mdx-infogrid">
      {list.map((i) => (
        <div key={i.label} className="mdx-infogrid-item">
          <dt>{i.label}</dt>
          <dd className={i.tone ? `tone-${i.tone}` : undefined}>
            {i.tone === 'ok' && <Icon name="check" size={14} strokeWidth={2.6} />}
            {i.tone === 'bad' && <Icon name="alert" size={14} />}
            {i.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function formatModDate(value) {
  if (!value) return null;
  const d = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ModBanner({ url }) {
  const sources = useMemo(() => (url ? [...new Set([proxyImage(url), url])] : []), [url]);
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [sources]);
  if (idx >= sources.length) return null;
  return (
    <div className="mdx-detail-cover">
      <img src={sources[idx]} alt="" onError={() => setIdx((i) => i + 1)} />
    </div>
  );
}

export function ModDetailLayout({ onBack, backLabel, thumb, fallbackIcon, title, subtitle, stats, actions, notices, main, side, gallery, info }) {
  const firstShot = gallery?.[0];
  const bannerUrl = (typeof firstShot === 'string' ? firstShot : firstShot?.full || firstShot?.thumb) || thumb || null;
  return (
    <div className="mdx-detail">
      <button type="button" className="mdx-back-link" onClick={onBack}><Icon name="back" size={16} /> {backLabel}</button>
      {/* Banner do mod (item pedido): imagem grande no topo da página —
          a 1ª screenshot (mais larga) ou a imagem principal do mod. */}
      <ModBanner url={bannerUrl} />
      <div className={`mdx-detail-head ${bannerUrl ? 'has-banner' : ''}`}>
        {thumb && <div className="mdx-detail-banner" aria-hidden="true" style={{ backgroundImage: `url("${proxyImage(thumb)}"), url("${thumb}")` }} />}
        <div className="mdx-detail-media"><ModThumb url={thumb} fallbackIcon={fallbackIcon} seed={title} /></div>
        <div className="mdx-detail-info">
          <h2>{title}</h2>
          {subtitle && <p className="mdx-detail-sub">{subtitle}</p>}
          {stats && <div className="mdx-detail-stats">{stats}</div>}
          {actions && <div className="mdx-detail-actions">{actions}</div>}
          {notices}
        </div>
      </div>
      {(gallery?.length > 0 || info?.length > 0) && (
        <div className="mdx-detail-showcase">
          <ModGallery images={gallery} />
          <ModInfoGrid items={info} />
        </div>
      )}
      <div className={`mdx-detail-cols ${side ? '' : 'single'}`}>
        <div className="mdx-detail-main">{main}</div>
        {side && <aside className="mdx-detail-side">{side}</aside>}
      </div>
    </div>
  );
}

export function DetailStat({ icon, children }) {
  return <span className="mdx-detail-stat"><Icon name={icon} size={14} /> {children}</span>;
}

export function Section({ title, icon, children, right, className = '' }) {
  return (
    <section className={`mdx-section ${className}`}>
      {(title || right) && (
        <div className="mdx-section-head">
          {title && <h3>{icon && <Icon name={icon} size={16} />} {title}</h3>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

// Contexto do gerenciador do jogo: deixa as telas de cada fonte saberem
// o que já está instalado e avisarem o cartão de progresso lá embaixo,
// sem precisar passar props por todo lado.
export const ModsManagerContext = createContext({
  installedFolders: new Set(),
  refreshInstalled: () => {},
  trackInstall: () => {},
  untrackInstall: () => {},
  completeInstall: () => {},
  progressById: {},
  workshopIds: [],
});
export function useModsManager() {
  return useContext(ModsManagerContext);
}
