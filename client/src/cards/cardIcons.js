// Ícones (traço, 24×24) de cada carta da nova era: aparecem na arte da carta
// enquanto a staff não envia uma imagem. Desenhos originais e genéricos —
// objetos e símbolos que remetem à carta, não reproduções de personagens.

const c = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;

export const CARD_ICONS = {
  // ---------------- Memes BR ----------------
  caramelo: 'M6 9 4 4l5 3M18 9l2-5-5 3M6 9c0-2 3-4 6-4s6 2 6 4v5a6 6 0 0 1-12 0zM9.5 12h.01M14.5 12h.01M11 16h2l-1 1z',
  'capivara-zen': 'M3 15c0-4 3-7 8-7h4c3 0 6 2 6 5v2H3zM17 8l1-2 1 2M19 11h.01M5 15v4M9 15v4M15 15v4M19 15v4',
  'pombo-praca': 'M5 14c0-4 3-7 7-7 2 0 3 1 4 2l4-1-3 3c0 4-3 7-8 7H4zM15 10h.01M10 18l-1 3M13 18l1 3',
  'tio-pave': 'M4 13h16l-2 6H6zM6 13c0-2 2-4 6-4s6 2 6 4M12 9V6M10 6h4M8 16h8',
  'gato-julgador': 'M5 20V9l3-5 3 4h2l3-4 3 5v11zM8 13l3 1M16 13l-3 1M11 17h2',
  chihuahua: 'M4 4l4 6M20 4l-4 6M8 10c0-1 2-2 4-2s4 1 4 2v4a4 4 0 0 1-8 0zM10 12h.01M14 12h.01M11.5 15h1',
  'gato-vibe': 'M3 21v-8l2-4 2 3h2l2-3 2 4v8zM7 16h.01M11 16h.01M18 3v9a2 2 0 1 1-2-2h2M18 3l3-1v3l-3 1',
  doguinho: 'M5 18V8l3-4 3 4h2l3-4 3 4v10a4 4 0 0 1-4 2H9a4 4 0 0 1-4-2zM9 12h.01M15 12h.01M10 16c1 1 3 1 4 0',
  stonks: 'M3 20h18M4 16l5-5 4 3 7-8M15 6h5v5',
  nazare: 'M4 6h6M7 3v6M14 4l6 5M20 4l-6 5M4 17h6M15 15a2.5 2.5 0 1 1 3 2.4V19M17.5 21.5h.01',
  'tia-zap': 'M4 5h16v11H9l-5 4zM8 10v2M11 8v6M14 9v4M17 10v2',
  impostor: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12zM12 9v3M12 15h.01',
  'ta-tudo-bem': 'M5 11h10v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM15 13h2a2 2 0 0 1 0 4h-2M8 3c1 2-1 3 0 5M12 3c1 2-1 3 0 5M19 4c2 2 0 4 2 6M3 4c-1 2 1 4-1 6',
  'big-floppa': 'M4 2l3 8M20 2l-3 8M7 10c1-1 3-2 5-2s4 1 5 2v5a5 5 0 0 1-10 0zM10 13h.01M14 13h.01M11 16h2',
  'gato-arco-iris': 'M2 19a10 10 0 0 1 20 0M5.5 19a6.5 6.5 0 0 1 13 0M9 19a3 3 0 0 1 6 0M19 3l.6 1.4L21 5l-1.4.6L19 7l-.6-1.4L17 5l1.4-.6z',
  'capivara-suprema': 'M4 17 3 8l5 4 4-7 4 7 5-4-1 9zM4 20h16',
  'chinelo-mae': 'M9 3c3 0 5 3 5 8s-1 10-4 10-4-3-4-8 0-10 3-10zM10 7l-3 4M10 7l3 4',
  'biscoito-bolacha': 'M12 3a9 9 0 1 0 9 9 3 3 0 0 1-3-3 3 3 0 0 1-3-3 3 3 0 0 1-3-3zM8 10h.01M10 15h.01M15 14h.01',
  'pastel-vento': 'M3 15a9 9 0 0 1 18 0zM6 15l1 2M10 15l1 2M14 15l1 2M18 15l1 2',
  'danca-caixao': 'M9 2h6l3 5-2 15H8L6 7zM12 7v6M10 9h4',

  // ---------------- Club Penguin (objetos de cada personagem) ----------------
  'puffle-vermelho': `M4 15l11-7 3 4-11 7zM19 5l2-2M20 9h2M17 3l1-2${c(5, 20, 2)}`,
  'puffle-azul': 'M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z',
  'puffle-verde': 'M4 16a8 8 0 0 1 16 0zM2 16h20M12 8V5M8 4h8',
  'puffle-rosa': 'M5 3h2v6H5zM17 3h2v6h-2zM6 9c0 11 12 11 12 0',
  'puffle-amarelo': 'M18 3l3 3-9 9-3-3zM9 12l-3 1c-2 1-2 4-3 6 2-1 5-1 6-3l1-3',
  'puffle-roxo': 'M9 18V6l10-2v12M9 18a2 2 0 1 1-2-2h2M19 16a2 2 0 1 1-2-2h2',
  rookie: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6zM9 12l2 2 4-4',
  'puffle-preto': 'M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-6 0 2 1 3 2 3 0-3-1-5 1-8z',
  klutzy: 'M5 14c-2-2-2-6 1-8l2 3-2 2 3 1c0 2-2 3-4 2zM9 13c2 3 6 3 8 0M17 13l3 3M12 15v4M15 15l1 4M9 15l-1 4',
  gary: `${c(12, 12, 4)}M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1`,
  'tia-artica': 'M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M7 8h7M7 11h7M7 14h4',
  ph: `M3 10h10a5 5 0 1 1-4.5 7H3zM13 10V7h4${c(10, 14, 1)}`,
  jetpack: 'M12 2c4 3 5 8 3 13H9C7 10 8 5 12 2zM9 15l-3 4 4-1M15 15l3 4-4-1M12 9h.01M10 19l2 3 2-3',
  cadence: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z',
  sensei: `M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z${c(12, 12, 1)}`,
  herbert: `M12 12c3 0 5 3 5 6 0 2-2 3-5 3s-5-1-5-3c0-3 2-6 5-6z${c(6, 10, 1.6)}${c(9.5, 6, 1.6)}${c(14.5, 6, 1.6)}${c(18, 10, 1.6)}`,
  rockhopper: `${c(12, 5, 2)}M12 7v14M8 11h8M4 14c0 4 4 7 8 7s8-3 8-7M4 14l-1 2M20 14l1 2`,
  iceberg: 'M2 14h20M7 14l3-8 2 3 2-4 4 9M5 14l3 7h8l3-7M9 18h2',
  'bola-neve': `${c(12, 14, 7)}M4 3l2 2M2 8h2M20 3l-2 2M22 8h-2M12 2v2`,
  'pizza-pizzatron': `M12 21 3 6c6-3 12-3 18 0zM5 9c4-2 10-2 14 0${c(10, 11, 1.2)}${c(14, 12, 1.2)}${c(12, 16, 1.2)}`,

  // ---------------- Cultura Pop ----------------
  chaves: 'M6 4h12c1 3 1 13 0 16H6C5 17 5 7 6 4zM5.5 9h13M5.5 15h13',
  kiko: `${c(12, 12, 9)}M12 3c-3 4-3 14 0 18M12 3c3 4 3 14 0 18M3 12h18`,
  'burro-falante': 'M3 5h12v8H8l-4 3v-3H3zM15 9h6v8h-1v3l-3-3h-5v-3',
  'bob-esponja': 'M13 3h7v6h-7zM16.5 9 6 20M15 4v4M18 4v4',
  'lula-molusco': 'M5 19 17 7M17 7l2-2 1 1-2 2M3 21l2-2 1 1-1 1zM9 13h.01M11 11h.01M13 9h.01',
  'fita-k7': `M3 6h18v12H3zM6 18l2-4h8l2 4${c(8, 10, 1.5)}${c(16, 10, 1.5)}M9.5 10h5`,
  'seu-madruga': 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  disquete: 'M4 4h13l3 3v13H4zM7 4v5h9V4M7 20v-6h10v6M13 5v3',
  cartucho: 'M5 3h14v14l-2 2v2H7v-2l-2-2zM8 6h8v6H8zM9 19v2M12 19v2M15 19v2',
  'bichinho-virtual': 'M12 2c5 0 8 6 8 11a8 8 0 0 1-16 0c0-5 3-11 8-11zM8 9h8v5H8zM9 17h.01M12 18h.01M15 17h.01',
  sonic: 'M4 16c0-3 2-5 4-6l3-4 3 3h3c3 0 5 2 5 4v3H4zM4 19h18M9 10l2 2M12 8l2 2M1 12h2M0 16h2',
  mario: 'M4 4h16v16H4zM10 9a2 2 0 1 1 3 1.7c-1 .5-1 1-1 2.3M12 16h.01',
  tijolao: 'M8 6h8v15H8zM10 2v4M10 9h4M10 13h.01M12 13h.01M14 13h.01M10 16h.01M12 16h.01M14 16h.01',
  discador: `M4 10c0-3 4-5 8-5s8 2 8 5l-3 1-1-2H8l-1 2zM6 12h12l2 8H4z${c(12, 16, 2)}`,
  chapolin: 'M3 5h10v7H3zM8 12v9M13 7h3v3h-3',
  pikachu: 'M13 2 4 14h7l-1 8 9-12h-7z',
  'lan-house': 'M3 4h18v12H3zM8 20h8M12 16v4M7 9l2 2-2 2M11 13h4',
  shrek: 'M12 3c-1 2-5 5-5 10a5 5 0 0 0 10 0c0-5-4-8-5-10zM12 3v15M9 8c-1 3-1 6 0 9M15 8c1 3 1 6 0 9M10 2l2 1 2-1',
  'mestre-magos': `${c(12, 10, 7)}M7 20h10M9 17l-1 3M15 17l1 3M10 7l1 2 2 .5-2 .5-1 2`,
  goku: `${c(15, 12, 5)}${c(15, 12, 2)}M1 9h6M0 12h7M1 15h6`,
};

export const cardIcon = (card) => (card?.slug && CARD_ICONS[card.slug]) || null;
