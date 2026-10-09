// Ícones do Social (SVG de traço, herdam a cor) — sem emoji.
const PATHS = {
  friends: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 19v-1a4 4 0 0 0-3-3.87M15.5 4.13a3 3 0 0 1 0 5.74',
  chat: 'M4 5h16v11H8l-4 4V5Z',
  club: 'M12 3 4 7v6c0 4 3.5 7 8 8 4.5-1 8-4 8-8V7l-8-4Z',
  add: 'M15 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M8.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 8v6M16 11h6',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6 6 18',
  block: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  search: 'm20 20-4.2-4.2M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  inbox: 'M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
  wave: 'M7 11V6a1.5 1.5 0 0 1 3 0v4M10 9V4.5a1.5 1.5 0 0 1 3 0V9M13 9V5.5a1.5 1.5 0 0 1 3 0V12M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-12.5 4.3L4 14.6a1.5 1.5 0 0 1 2.3-1.9L7 13.5V8',
};
export default function SocialIcon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
