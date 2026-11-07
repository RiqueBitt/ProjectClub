import { memo } from 'react';

// Fundos de batalha. A staff pode subir uma imagem por mesa; sem imagem,
// a mesa usa uma destas cenas ilustradas (SVG leve, sem arquivos externos).

export const BOARD_THEMES = {
  floresta: { label: 'Floresta Antiga', accent: '#62c24a' },
  vulcao: { label: 'Forja do Vulcão', accent: '#ff7a3c' },
  templo: { label: 'Templo Dourado', accent: '#ffd34d' },
  abismo: { label: 'Abismo Eterno', accent: '#a46bff' },
  oceano: { label: 'Recife Profundo', accent: '#3aa0ff' },
  gelo: { label: 'Picos Gelados', accent: '#9fe3ff' },
  noite: { label: 'Cidadela Noturna', accent: '#8b9cff' },
};
export const THEME_KEYS = Object.keys(BOARD_THEMES);

const pines = (x0, y, n, step, h, fill) => Array.from({ length: n }, (_, i) => {
  const x = x0 + i * step;
  const hh = h * (0.75 + ((i * 37) % 10) / 30);
  return <path key={i} d={`M${x} ${y} l${hh * 0.32} 0 l${-hh * 0.32} ${-hh} l${-hh * 0.32} ${hh}z`} fill={fill} />;
});

const SCENES = {
  floresta: () => (
    <>
      <defs><linearGradient id="bs-f-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0f2a24" /><stop offset=".55" stopColor="#163d2a" /><stop offset="1" stopColor="#06120b" /></linearGradient></defs>
      <rect width="1600" height="900" fill="url(#bs-f-sky)" />
      <circle cx="1180" cy="170" r="90" fill="#d9ffb8" opacity=".12" />
      <path d="M0 420 260 250 470 380 700 220 960 390 1180 260 1420 380 1600 300V900H0z" fill="#12301f" opacity=".9" />
      <path d="M0 520 200 420 420 500 640 400 880 520 1120 420 1360 520 1600 440V900H0z" fill="#0c2416" />
      {pines(-20, 640, 7, 70, 300, '#081a0f')}
      {pines(1170, 640, 7, 70, 300, '#081a0f')}
      {pines(30, 900, 6, 95, 420, '#040d07')}
      {pines(1080, 900, 6, 95, 420, '#040d07')}
      <rect y="560" width="1600" height="120" fill="#bff5c9" opacity=".05" />
    </>
  ),
  vulcao: () => (
    <>
      <defs>
        <linearGradient id="bs-v-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1a0503" /><stop offset=".6" stopColor="#3d0d05" /><stop offset="1" stopColor="#0b0201" /></linearGradient>
        <radialGradient id="bs-v-glow" cx=".5" cy=".3" r=".5"><stop offset="0" stopColor="#ff8a1f" stopOpacity=".8" /><stop offset="1" stopColor="#ff3d00" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#bs-v-sky)" />
      <ellipse cx="800" cy="210" rx="420" ry="220" fill="url(#bs-v-glow)" />
      <path d="M380 560 700 190h200l320 370z" fill="#200603" />
      <path d="M700 190h200l-40 40-60-20-60 25z" fill="#ff6a1a" />
      <path d="M770 220c10 90-30 160-10 260M840 225c-15 110 25 180 5 280" stroke="#ff5a14" strokeWidth="8" fill="none" opacity=".75" />
      <path d="M0 900V430l90-120 60 160 80-240 70 260 90-110 60 600zM1600 900V430l-90-120-60 160-80-240-70 260-90-110-60 600z" fill="#120302" />
      <path d="M0 900h1600V760c-200 30-420-40-800-10S200 790 0 760z" fill="#3a0c04" />
      <path d="M0 810c260-30 520 40 800 10s560-30 800 0" stroke="#ff7a1f" strokeWidth="5" fill="none" opacity=".55" />
    </>
  ),
  templo: () => (
    <>
      <defs><linearGradient id="bs-t-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2a1a05" /><stop offset=".55" stopColor="#5a3a0c" /><stop offset="1" stopColor="#120a02" /></linearGradient></defs>
      <rect width="1600" height="900" fill="url(#bs-t-sky)" />
      <circle cx="800" cy="300" r="190" fill="#ffd34d" opacity=".14" />
      <circle cx="800" cy="300" r="110" fill="#ffe08a" opacity=".16" />
      <path d="M560 210 800 90l240 120z" fill="#3a2506" />
      <rect x="560" y="210" width="480" height="24" fill="#4a3009" />
      {[0, 1, 2, 3, 4].map((i) => <rect key={`l${i}`} x={40 + i * 92} y={220 + i * 18} width="46" height={680 - i * 18} fill={i % 2 ? '#2d1d05' : '#3a2607'} />)}
      {[0, 1, 2, 3, 4].map((i) => <rect key={`r${i}`} x={1514 - i * 92} y={220 + i * 18} width="46" height={680 - i * 18} fill={i % 2 ? '#2d1d05' : '#3a2607'} />)}
      <path d="M0 200h520l-40 30H0zM1600 200h-520l40 30h480z" fill="#4a3009" />
      <path d="M0 900h1600V780H0z" fill="#1e1303" />
      {[0, 1, 2].map((i) => <rect key={i} x={260 - i * 60} y={780 + i * 30} width={1080 + i * 120} height="10" fill="#5a3d0d" opacity={0.7 - i * 0.2} />)}
    </>
  ),
  abismo: () => (
    <>
      <defs>
        <radialGradient id="bs-a-sky" cx=".5" cy=".45" r=".75"><stop offset="0" stopColor="#2b0f52" /><stop offset=".6" stopColor="#12062a" /><stop offset="1" stopColor="#05020c" /></radialGradient>
        <radialGradient id="bs-a-ring" cx=".5" cy=".5" r=".5"><stop offset=".7" stopColor="#a46bff" stopOpacity="0" /><stop offset=".86" stopColor="#c9a6ff" stopOpacity=".35" /><stop offset="1" stopColor="#a46bff" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#bs-a-sky)" />
      {Array.from({ length: 60 }, (_, i) => <circle key={i} cx={(i * 263) % 1600} cy={(i * 151) % 900} r={(i % 3) * 0.8 + 0.6} fill="#e6d6ff" opacity={0.2 + (i % 5) / 10} />)}
      <ellipse cx="800" cy="430" rx="620" ry="250" fill="url(#bs-a-ring)" />
      <path d="M80 330h260l-60 70-50 90-50-60-40 40z" fill="#1d0b38" />
      <path d="M120 300l30-60 25 60zM230 305l40-90 30 90z" fill="#8a52ff" opacity=".7" />
      <path d="M1260 290h270l-50 80-70 70-40-60-60 50z" fill="#1d0b38" />
      <path d="M1330 260l30-70 30 70zM1440 270l22-50 20 50z" fill="#8a52ff" opacity=".7" />
      <path d="M0 900V720l140-60 120 80 90-40 120 110zM1600 900V700l-160-50-100 90-110-30-110 190z" fill="#0d0520" />
    </>
  ),
  oceano: () => (
    <>
      <defs><linearGradient id="bs-o-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0d4a7a" /><stop offset=".5" stopColor="#06294a" /><stop offset="1" stopColor="#020c18" /></linearGradient></defs>
      <rect width="1600" height="900" fill="url(#bs-o-sky)" />
      {[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M${250 + i * 280} 0l${80 + i * 10} 0-${160 + i * 40} 900h-90z`} fill="#bfe6ff" opacity=".05" />)}
      <path d="M0 900V640c60-40 90 40 140 0s50-120 110-90 30 120 90 110 40-60 90-40v280z" fill="#0b2340" />
      <path d="M1600 900V620c-60-40-100 40-150 0s-40-110-100-80-40 120-100 110-30-60-80-30v280z" fill="#0b2340" />
      <path d="M70 900c-10-120 30-170 10-240M110 900c10-90-20-140 15-210M1500 900c10-110-30-160-5-230M1540 900c-15-90 20-150-10-200" stroke="#ff6f91" strokeWidth="14" strokeLinecap="round" fill="none" opacity=".55" />
      <path d="M0 900h1600v-70c-260 20-520-30-800-10S240 850 0 830z" fill="#04162a" />
    </>
  ),
  gelo: () => (
    <>
      <defs><linearGradient id="bs-g-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b1d33" /><stop offset=".6" stopColor="#1d4466" /><stop offset="1" stopColor="#081626" /></linearGradient></defs>
      <rect width="1600" height="900" fill="url(#bs-g-sky)" />
      <path d="M0 160c300-80 520 60 800 0s520-90 800-20" stroke="#6effc8" strokeWidth="40" fill="none" opacity=".12" />
      <path d="M0 210c320-70 560 50 820-10s500-70 780 0" stroke="#9fe3ff" strokeWidth="26" fill="none" opacity=".1" />
      <path d="M0 560 180 300 300 420 420 260 560 520 760 340 880 480 1040 280 1180 460 1320 300 1460 440 1600 330V900H0z" fill="#2d5a80" />
      <path d="M180 300l-30 60 30-12 25 30zM420 260l-26 70 30-20 20 34zM1040 280l-30 66 34-18 22 30zM1320 300l-26 60 30-16 20 28z" fill="#e8f7ff" opacity=".85" />
      <path d="M0 900V660l220-80 200 70 240-40 300 60 260-50 380 70v210z" fill="#173550" />
      <path d="M0 900h1600v-90c-300 20-560-30-800 0S260 830 0 820z" fill="#cfeaff" opacity=".18" />
    </>
  ),
  noite: () => (
    <>
      <defs><linearGradient id="bs-n-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#070a1f" /><stop offset=".65" stopColor="#141a42" /><stop offset="1" stopColor="#05060f" /></linearGradient></defs>
      <rect width="1600" height="900" fill="url(#bs-n-sky)" />
      {Array.from({ length: 70 }, (_, i) => <circle key={i} cx={(i * 211) % 1600} cy={(i * 97) % 520} r={(i % 3) * 0.7 + 0.5} fill="#fff" opacity={0.25 + (i % 4) / 8} />)}
      <circle cx="1240" cy="170" r="70" fill="#f3f0d8" opacity=".9" />
      <circle cx="1268" cy="152" r="62" fill="#141a42" opacity=".85" />
      <path d="M0 900V520h60v-60h30v60h50v-120h40v-40l30-50 30 50v40h40v160h60v-80h40v80h60V900zM1600 900V540h-70v-90h-30l-25-50-25 50h-30v110h-60v-60h-40v60h-70V900z" fill="#0a0d24" />
      <path d="M150 470h12v16h-12zM1490 520h12v16h-12zM360 600h10v14h-10z" fill="#ffd34d" opacity=".75" />
      <path d="M0 900h1600v-60c-280 20-560-20-800 0S240 860 0 850z" fill="#04050d" />
    </>
  ),
};

function Particles({ theme }) {
  const kind = { floresta: 'firefly', vulcao: 'ember', templo: 'dust', abismo: 'spark', oceano: 'bubble', gelo: 'snow', noite: 'spark' }[theme] || 'dust';
  return (
    <div className={`tcgb-particles is-${kind}`} aria-hidden="true">
      {Array.from({ length: 18 }, (_, i) => <i key={i} style={{ '--x': `${(i * 53) % 100}%`, '--d': `${(i * 7) % 11}s`, '--s': `${8 + (i % 5) * 2}s`, '--z': `${0.6 + (i % 4) * 0.25}` }} />)}
    </div>
  );
}

// Fundo da mesa: imagem da staff (com escurecimento) ou a cena do tema.
export const BoardBackdrop = memo(function BoardBackdrop({ board }) {
  const theme = SCENES[board?.theme] ? board.theme : 'floresta';
  const Scene = SCENES[theme];
  return (
    <div className="tcgb-bg" aria-hidden="true">
      {board?.imageUrl ? (
        <div className="tcgb-bg-img" style={{ backgroundImage: `url(${JSON.stringify(board.imageUrl)})` }} />
      ) : (
        <svg className="tcgb-bg-svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"><Scene /></svg>
      )}
      <div className="tcgb-bg-dim" style={{ opacity: Math.max(0, Math.min(0.85, (board?.dim ?? 35) / 100)) }} />
      <Particles theme={theme} />
    </div>
  );
});

// Miniatura (painel da staff e seletores).
export function BoardThumb({ board, className = '' }) {
  return (
    <span className={`tcgb-thumb ${className}`} style={{ '--accent': board?.accent || BOARD_THEMES[board?.theme]?.accent || '#8b6bff' }}>
      <BoardBackdrop board={board} />
      <span className="tcgb-thumb-mat" />
    </span>
  );
}
