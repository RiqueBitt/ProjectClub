// Retratos ilustrados dos bots (SVG gerado). Cada bot conhecido tem um
// visual próprio; nomes novos (fases criadas pela staff) ganham um rosto
// determinístico a partir do nome.
const LOOKS = {
  'Aprendiz Pip': { skin: '#ffd2a8', hair: '#7a4b2a', hat: 'cap', color: '#4cc76b', eyes: 'round' },
  'Druida Mel': { skin: '#f3c79d', hair: '#3f7d34', hat: 'leaf', color: '#62c24a', eyes: 'soft' },
  'Duelista Nora': { skin: '#e8b48a', hair: '#1d2b53', hat: 'band', color: '#3b8bff', eyes: 'sharp' },
  'Capitã Nora': { skin: '#e8b48a', hair: '#1d2b53', hat: 'tricorn', color: '#3aa0ff', eyes: 'sharp' },
  'Ferreiro Brasa': { skin: '#c98a5e', hair: '#a8331f', hat: 'goggles', color: '#ff5a3c', eyes: 'round', beard: true },
  'Mestre Kael': { skin: '#d9a77c', hair: '#e6e6e6', hat: 'hood', color: '#b55cff', eyes: 'sharp', beard: true },
  'Arquimaga Vex': { skin: '#e7c1ff', hair: '#2a0d4a', hat: 'crown', color: '#ffb020', eyes: 'glow' },
};

function hashLook(name = '') {
  let h = 7;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const skins = ['#ffd2a8', '#e8b48a', '#c98a5e', '#8d5a3b', '#f3c79d'];
  const hairs = ['#2b1a12', '#7a4b2a', '#d4a017', '#a8331f', '#1d2b53', '#e6e6e6'];
  const hats = ['cap', 'band', 'hood', 'leaf', 'crown', 'goggles'];
  const colors = ['#4cc76b', '#3b8bff', '#b55cff', '#ff5a3c', '#ffb020', '#5fe0d0'];
  return { skin: skins[h % 5], hair: hairs[(h >> 3) % 6], hat: hats[(h >> 6) % 6], color: colors[(h >> 9) % 6], eyes: ['round', 'sharp', 'soft'][(h >> 12) % 3], beard: (h >> 14) % 3 === 0 };
}

export default function BotPortrait({ name, size = 72, className = '' }) {
  const L = LOOKS[name] || hashLook(name);
  const eye = (cx) => {
    if (L.eyes === 'sharp') return <path d={`M${cx - 5} 47 L${cx + 5} 45 L${cx + 4} 49 L${cx - 4} 50 Z`} fill="#1a1a1a" />;
    if (L.eyes === 'glow') return <circle cx={cx} cy="47" r="3.5" fill="#fff" style={{ filter: `drop-shadow(0 0 3px ${L.color})` }} />;
    if (L.eyes === 'soft') return <path d={`M${cx - 4} 47 Q${cx} 44 ${cx + 4} 47`} stroke="#1a1a1a" strokeWidth="2.2" fill="none" strokeLinecap="round" />;
    return <circle cx={cx} cy="47" r="3.2" fill="#1a1a1a" />;
  };
  return (
    <svg className={`tcg-botp ${className}`} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={name}>
      <defs>
        <radialGradient id={`bg-${name}`} cx="50%" cy="35%" r="75%">
          <stop offset="0%" stopColor={L.color} stopOpacity=".9" />
          <stop offset="100%" stopColor="#0b0b10" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" rx="22" fill={`url(#bg-${name})`} />
      {/* ombros */}
      <path d="M18 100 Q22 76 50 74 Q78 76 82 100 Z" fill={L.color} opacity=".95" />
      <path d="M40 74 L50 86 L60 74" fill="none" stroke="#0b0b10" strokeWidth="2" opacity=".4" />
      {/* cabelo atrás */}
      <ellipse cx="50" cy="45" rx="25" ry="27" fill={L.hair} />
      {/* rosto */}
      <ellipse cx="50" cy="49" rx="20" ry="22" fill={L.skin} />
      {eye(42)}{eye(58)}
      <path d="M44 60 Q50 64 56 60" stroke="#7a3a2a" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="38" cy="56" r="3" fill="#ff7a7a" opacity=".25" />
      <circle cx="62" cy="56" r="3" fill="#ff7a7a" opacity=".25" />
      {L.beard && <path d="M32 54 Q34 74 50 76 Q66 74 68 54 Q62 66 50 66 Q38 66 32 54 Z" fill={L.hair} />}
      {/* franja */}
      <path d="M30 42 Q36 24 50 24 Q66 24 70 42 Q60 32 50 34 Q40 32 30 42 Z" fill={L.hair} />
      {L.hat === 'cap' && <path d="M28 36 Q30 18 50 18 Q70 18 72 36 Z M66 34 L84 38 L70 40 Z" fill={L.color} stroke="#0b0b10" strokeWidth="1.5" />}
      {L.hat === 'band' && <rect x="29" y="31" width="42" height="6" rx="3" fill={L.color} />}
      {L.hat === 'hood' && <path d="M22 60 Q20 16 50 14 Q80 16 78 60 Q74 30 50 28 Q26 30 22 60 Z" fill="#2a2140" stroke={L.color} strokeWidth="2" />}
      {L.hat === 'leaf' && <path d="M50 22 Q62 10 74 18 Q64 28 50 22 Z M50 22 Q38 10 28 18 Q38 28 50 22 Z" fill="#4cc76b" />}
      {L.hat === 'crown' && <path d="M32 26 L36 10 L44 20 L50 6 L56 20 L64 10 L68 26 Z" fill="#ffd34d" stroke="#8a5a00" strokeWidth="1.5" />}
      {L.hat === 'goggles' && <g><rect x="31" y="30" width="38" height="5" fill="#3b2a1a" /><circle cx="41" cy="32" r="6" fill="#5fe0d0" stroke="#3b2a1a" strokeWidth="2" /><circle cx="59" cy="32" r="6" fill="#5fe0d0" stroke="#3b2a1a" strokeWidth="2" /></g>}
      {L.hat === 'tricorn' && <path d="M22 34 Q50 4 78 34 Q50 26 22 34 Z" fill="#1a1a2a" stroke={L.color} strokeWidth="2" />}
    </svg>
  );
}
