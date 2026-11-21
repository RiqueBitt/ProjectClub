// Ícones das telas de login/cadastro em SVG inline — antes eram emoji
// (👁/🙈) e PNGs: emoji depende da fonte do sistema e vira um quadrado
// vazio em muitas distros Linux sem fonte de emoji instalada. SVG
// renderiza igual em Windows, Linux, Android e iOS, e herda a cor do
// texto (currentColor).
const base = {
  width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false',
};

export const MailIcon = (p) => (
  <svg {...base} {...p}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>
);
export const LockIcon = (p) => (
  <svg {...base} {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
);
export const UserIcon = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></svg>
);
export const AtIcon = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="3.6" /><path d="M15.6 12v1.4a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.6 7.1" /></svg>
);
export const ShieldIcon = (p) => (
  <svg {...base} {...p}><path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const CalendarIcon = (p) => (
  <svg {...base} {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
);
export const EyeIcon = (p) => (
  <svg {...base} {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const EyeOffIcon = (p) => (
  <svg {...base} {...p}><path d="M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.5 7A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.6-1.2" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" /></svg>
);
export const ArrowLeftIcon = (p) => (
  <svg {...base} {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
);
export const CheckIcon = (p) => (
  <svg {...base} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
export const AlertIcon = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>
);
