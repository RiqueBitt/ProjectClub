// Ícones de traço da barra de chamada / janelinha flutuante (mesmo estilo
// do NavIcons.jsx). Mapa local pra não mexer nos ícones compartilhados.
const PATHS = {
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  micOff: <><path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.9 2.3" /><path d="M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18" /></>,
  headphones: <><path d="M4 15v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="14" width="5" height="7" rx="2" /><rect x="16" y="14" width="5" height="7" rx="2" /></>,
  headphonesOff: <><path d="M4 15v-3a8 8 0 0 1 12.7-6.5M20 12v3" /><rect x="3" y="14" width="5" height="7" rx="2" /><path d="M16 16v3a2 2 0 0 0 2 2h1M3 3l18 18" /></>,
  camera: <><rect x="3" y="7" width="12" height="10" rx="2" /><path d="m15 10 6-3v10l-6-3" /></>,
  screen: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  screenOn: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4M12 13V7M9 10l3-3 3 3" /></>,
  hangup: <path d="M4.5 14.5c4.6-3.9 10.4-3.9 15 0l-1.6 2.9-3.2-1.1v-2.2a8.5 8.5 0 0 0-5.4 0v2.2l-3.2 1.1-1.6-2.9Z" />,
  hand: <path d="M7 11V6a1.5 1.5 0 0 1 3 0v4M10 9V4.5a1.5 1.5 0 0 1 3 0V9M13 9V5.5a1.5 1.5 0 0 1 3 0V12M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-12.5 4.3L4 14.6a1.5 1.5 0 0 1 2.3-1.9L7 13.5V8" />,
  caret: <path d="m7 10 5 5 5-5" />,
  caretUp: <path d="m7 14 5-5 5 5" />,
  check: <path d="m5 12 5 5 9-10" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  speaker: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></>,
  people: <><path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" /><circle cx="9.5" cy="7" r="3" /><path d="M21 19v-1a4 4 0 0 0-3-3.9M15.5 4.1a3 3 0 0 1 0 5.8" /></>,
  expand: <path d="M15 4h5v5M9 20H4v-5M20 4l-7 7M4 20l7-7" />,
  minimize: <path d="M5 12h14" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
  grip: <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />,
  quality: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
};

export default function CallIcon({ name, size = 18, strokeWidth = 2, className = '' }) {
  return (
    <svg
      className={`call-icon ${className}`} width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {PATHS[name] || null}
    </svg>
  );
}

// Barrinhas de sinal (qualidade do Agora: 0 desconhecida, 1 excelente …
// 6 caiu). Cor e quantidade de barras acesas seguem a qualidade.
const SIGNAL = {
  0: { bars: 0, tone: 'unknown' },
  1: { bars: 4, tone: 'good' },
  2: { bars: 3, tone: 'good' },
  3: { bars: 2, tone: 'ok' },
  4: { bars: 1, tone: 'bad' },
  5: { bars: 1, tone: 'bad' },
  6: { bars: 0, tone: 'bad' },
};
export const QUALITY_LABELS = {
  0: 'Medindo a conexão',
  1: 'Conexão excelente',
  2: 'Conexão boa',
  3: 'Conexão razoável',
  4: 'Conexão ruim',
  5: 'Conexão muito ruim',
  6: 'Sem conexão',
};
export function signalTone(quality) {
  return (SIGNAL[quality] || SIGNAL[0]).tone;
}
export function SignalBars({ quality = 0, size = 16 }) {
  const { bars } = SIGNAL[quality] || SIGNAL[0];
  return (
    <svg className="call-signal" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i} x={1 + i * 3.8} y={12 - i * 3} width="2.6" height={3 + i * 3} rx="1"
          className={i < bars ? 'is-lit' : ''}
        />
      ))}
    </svg>
  );
}
