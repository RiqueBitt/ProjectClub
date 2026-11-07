// Ícones/card das seções do perfil — num arquivo próprio (antes viviam em
// UserProfileModal.jsx) pra que o painel de perfil da DM possa usá-los sem
// puxar o modal de perfil inteiro pro pacote inicial: o modal agora é
// carregado só quando algum perfil é aberto (ver MainApp.jsx).
// O CSS do perfil fica importado aqui (pacote inicial), igual antes.
import '../../styles/profile.css';

// Ícones de traço do perfil (SVG, herdam a cor do texto) — mapa local pra
// não mexer no PageIcons.jsx compartilhado. Emoji vira quadradinho no Linux.
const PF_PATHS = {
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20a8 8 0 0 1 16 0',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.8',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7L19 16Z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6M10 17h4',
  medal: 'M8 3l2 6M16 3l-2 6M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM12 13v4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01',
  poll: 'M5 20V10M12 20V4M19 20v-7',
  flame: 'M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-3 4.5-3 8a6 6 0 0 0 6 6Z',
  chat: 'M4 5h16v11H8l-4 4V5Z',
  quote: 'M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  cake: 'M4 21h16M5 21v-7h14v7M5 16c2 1.3 3.3 1.3 5 0 1.7 1.3 3.3 1.3 5 0 1.7 1.3 3 1.3 4 0M12 14V9M12 6.5V5',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  up: 'M12 19V5M5 12l7-7 7 7',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6l1-7Z',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  send: 'M4 12 20 4l-6 16-3-7-7-1Z',
  play: 'M8 5v14l11-7L8 5Z',
  alert: 'M12 3 2 20h20L12 3ZM12 10v4M12 17h.01',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  layers: 'm12 3 9 5-9 5-9-5 9-5ZM3 12.5l9 5 9-5M3 16.5l9 5 9-5',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
};
export function PfIcon({ name, size = 16, strokeWidth = 1.9 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PF_PATHS[name]} />
    </svg>
  );
}

// Card das seções do perfil: título em frase normal com ícone, contador
// opcional e uma ação no canto (ex: "Ver tudo").
export function PfCard({ icon, title, count, action, className = '', innerRef, children }) {
  return (
    <section className={`pf-card ${className}`} ref={innerRef}>
      <header className="pf-card-head">
        <span className="pf-card-icon"><PfIcon name={icon} size={15} /></span>
        <h3 className="pf-card-title">{title}</h3>
        {count != null && count !== 0 && <span className="pf-card-count">{count}</span>}
        {action && <span className="pf-card-action">{action}</span>}
      </header>
      {children}
    </section>
  );
}

