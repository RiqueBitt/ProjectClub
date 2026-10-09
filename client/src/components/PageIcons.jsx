// Ícones de traço (SVG) usados em Progresso e Suporte — herdam a cor do
// texto e aparecem iguais em qualquer sistema (emoji vira quadradinho no Linux).
const PATHS = {
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6M10 17h4',
  medal: 'M8 3l2 6M16 3l-2 6M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM12 13v4',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6l1-7Z',
  hash: 'M5 9h14M5 15h14M10 4 8 20M16 4l-2 16',
  headset: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2M20 15a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2M17 17c0 2-2 3-5 3',
  plus: 'M12 5v14M5 12h14',
  back: 'm15 18-6-6 6-6',
  send: 'M4 12 20 4l-6 16-3-7-7-1Z',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  chat: 'M4 5h16v11H8l-4 4V5Z',
  search: 'm20 20-4.2-4.2M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20a8 8 0 0 1 16 0',
  key: 'M14 10a4 4 0 1 0-3.5 4L9 15.5V18H6.5v2.5H4V18l6.5-6.5M15 7h.01',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.7.5 1 1.2 1 2.1h5c0-.9.3-1.6 1-2.1A6 6 0 0 0 12 3Z',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM14.5 9a2.5 2.5 0 0 0-2.5-1.5c-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2A2.6 2.6 0 0 1 9.5 15M12 6v1.5M12 16.5V18',
  inbox: 'M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
  close: 'M6 6l12 12M18 6 6 18',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
};

export default function PageIcon({ name, size = 18, strokeWidth = 1.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
