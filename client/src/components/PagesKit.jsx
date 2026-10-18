import { CoinIcon, GemIcon } from './CurrencyIcon.jsx';
import '../styles/pages-kit.css';

// Peças visuais compartilhadas por Economia, Casas, Figurinhas,
// Notificações e Busca: ícones de traço (SVG — emoji vira quadradinho no
// Linux), cabeçalho "herói", abas em pílula, estado vazio, esqueleto de
// carregamento e aviso flutuante.
const PATHS = {
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.6l1.3 2.65 2.9.42-2.1 2.05.5 2.9L12 14.25l-2.6 1.37.5-2.9-2.1-2.05 2.9-.42z',
  gem: 'M7 3.5h10l4.5 5.2L12 21 2.5 8.7zM2.5 8.7h19M9.6 8.7 12 21l2.4-12.3M7 3.5l2.6 5.2L12 3.5l2.4 5.2L17 3.5',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0',
  swap: 'M4 8h15l-4-4M20 16H5l4 4',
  font: 'M4 20 10 4h4l6 16M7 14h10',
  chest: 'M3 10h18v10H3zM3 10V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2M10 10v3h4v-3',
  flame: 'M12 21c-3.9 0-7-2.7-7-6.5 0-3 2-5.3 3.5-6.8.4 1.6 1.3 2.8 2.5 3.3-.3-3.3 1.2-6.4 3.5-8 .2 3 1.9 4.6 3.3 6.2A7.3 7.3 0 0 1 19 14.5c0 3.8-3.1 6.5-7 6.5Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  checkAll: 'm2 12.5 4.5 4.5L16 7.5M12 15.5l1.5 1.5L23 7.5',
  house: 'M3 11 12 4l9 7M5 9.5V20h14V9.5M10 20v-6h4v6',
  sofa: 'M4 11V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2v-5ZM5 18v2M19 18v2',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01',
  store: 'M4 9h16l-1-5H5L4 9ZM4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5 11v9h14v-9M10 20v-5h4v5',
  cards: 'M7 3h11a2 2 0 0 1 2 2v13M4 7h11a2 2 0 0 1 2 2v11H6a2 2 0 0 1-2-2z',
  frame: 'M3 4h18v16H3zM7 8h10v8H7z',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  flip: 'M12 3v18M8 7 3 12l5 5V7ZM16 7l5 5-5 5V7Z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z',
  sticker: 'M14 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h8l7-7V6a3 3 0 0 0-3-3h-4ZM14 21v-4a3 3 0 0 1 3-3h4M8.5 10h.01M14.5 10h.01M9 14.5c1.5 1 3.5 1 5 0',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5ZM4 19a2 2 0 0 1 2-2h13M9 7h6',
  capsule: 'M12 3a8 8 0 0 1 8 8H4a8 8 0 0 1 8-8ZM4 11a8 8 0 0 0 16 0M10 7.5h.01',
  sparkles: 'M10 3l1.8 4.7L16.5 9.5l-4.7 1.8L10 16l-1.8-4.7L3.5 9.5l4.7-1.8L10 3ZM18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14Z',
  question: 'M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 18h.01',
  left: 'm15 18-6-6 6-6',
  right: 'm9 6 6 6-6 6',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2ZM10 20a2 2 0 0 0 4 0',
  at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm0 0v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
  chat: 'M4 5h16v11H8l-4 4V5Z',
  reply: 'M10 8 5 12.5 10 17M5.5 12.5H14a5 5 0 0 1 5 5V19',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  userPlus: 'M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM3 20a7 7 0 0 1 11.5-5.4M19 14v6M16 17h6',
  heart: 'M12 20s-7.5-4.5-9-9.5C2 6.9 4.4 4 7.4 4c2 0 3.6 1.1 4.6 2.7C13 5.1 14.6 4 16.6 4c3 0 5.4 2.9 4.4 6.5-1.5 5-9 9.5-9 9.5Z',
  pen: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
  search: 'm20 20-4.2-4.2M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z',
  hash: 'M5 9h14M5 15h14M10 4 8 20M16 4l-2 16',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20a8 8 0 0 1 16 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 20a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 13.5a7 7 0 0 1 4 6.5',
  doc: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  close: 'M6 6l12 12M18 6 6 18',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6l1-7Z',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  pause: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM10 9v6M14 9v6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6M10 17h4',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3Z',
  volume: 'M4 9v6h4l5 4V5L8 9H4ZM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  palette: 'M12 21a9 9 0 1 1 9-9c0 2.2-1.8 3-3.5 3H16a2 2 0 0 0-1.5 3.3c.8 1-.1 2.7-2.5 2.7ZM7.5 11h.01M10 7h.01M15 7h.01M17.5 11h.01',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2V5ZM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5M8 16h3',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  login: 'M14 4h5v16h-5M10 8l4 4-4 4M14 12H3',
  menu: 'M4 7h16M4 12h16M4 17h16',
  inbox: 'M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
  crown: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5L3 8ZM5 21h14',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  tag: 'M3 12V4h8l10 10-8 8L3 12ZM7.5 8.5h.01',
  bag: 'M5 8h14l-1 12H6L5 8ZM9 8V6a3 3 0 0 1 6 0v2',
  phone: 'M7 2h10v20H7zM11 18h2',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
};

export function Ico({ name, size = 18, strokeWidth = 1.8, className }) {
  // Moedas e gemas: ícones coloridos novos (components/CurrencyIcon.jsx).
  if (name === 'coin') return <CoinIcon size={size} className={className} />;
  if (name === 'gem') return <GemIcon size={size} className={className} />;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] || PATHS.star} />
    </svg>
  );
}

// Cabeçalho "herói" — ícone + título + descrição curta; `aside` vai à
// direita (saldo, progresso...) e desce pra baixo no celular.
export function PageHero({ icon, eyebrow, title, desc, aside, children }) {
  return (
    <header className="pk-hero">
      <div className="pk-hero-main">
        <span className="pk-hero-icon"><Ico name={icon} size={26} /></span>
        <div className="pk-hero-text">
          {eyebrow && <span className="pk-eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
          {desc && <p>{desc}</p>}
        </div>
      </div>
      {aside && <div className="pk-hero-aside">{aside}</div>}
      {children}
    </header>
  );
}

export function PillTabs({ tabs, value, onChange, label, className = '' }) {
  return (
    <div className={`pk-tabs ${className}`} role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id} type="button" role="tab" aria-selected={value === t.id}
          className={`pk-tab ${value === t.id ? 'active' : ''}${t.className ? ` ${t.className}` : ''}`} onClick={() => onChange(t.id)}
        >
          {t.icon && <Ico name={t.icon} size={17} />}
          <span>{t.label}</span>
          {t.count > 0 && <span className="pk-tab-count">{t.count > 99 ? '99+' : t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, text, action, compact }) {
  return (
    <div className={`pk-empty ${compact ? 'compact' : ''}`}>
      <span className="pk-empty-icon"><Ico name={icon} size={compact ? 22 : 28} /></span>
      {title && <h3>{title}</h3>}
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

// Esqueleto pulsando no lugar do "Carregando..." solto.
export function Skeleton({ rows = 3, height = 58, grid }) {
  return (
    <div className={`pk-skeleton ${grid ? 'grid' : ''}`} aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }).map((_, i) => <span key={i} style={{ height, animationDelay: `${(i % 6) * 0.12}s` }} />)}
    </div>
  );
}

// Mesmo papel do SystemUnavailable (staff desligou o sistema), no visual novo.
export function Unavailable({ icon }) {
  return (
    <div className="pk-page">
      <div className="pk-inner">
        <EmptyState icon={icon || 'pause'} title="Indisponível no momento" text="A equipe desativou temporariamente esta seção. Volte mais tarde." />
      </div>
    </div>
  );
}

export function Toast({ children }) {
  if (!children) return null;
  return <div className="pk-toast" role="status"><Ico name="bell" size={16} />{children}</div>;
}

export function Price({ value, free = 'Grátis' }) {
  if (value === 0) return <span className="pk-price free">{free}</span>;
  return <span className="pk-price"><Ico name="coin" size={14} strokeWidth={2} />{Math.floor(Number(value) || 0).toLocaleString('pt-BR')}</span>;
}
