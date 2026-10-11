// Catálogo dos Mini-Jogos que já vêm instalados no Project Club.
// Cada jogo é um site estático em client/public/minigames/<slug>/ (servido
// pelo próprio app, mesma origem — sem nada externo). Pra adicionar um
// jogo novo: copie a pasta pra public/minigames/<slug>/, gere cover.webp
// (16:9) e icon.webp (quadrado) e acrescente uma entrada aqui.
//
// Os jogos atuais vêm do zip enviado pelo dono (recriação feita por fãs
// dos mini-jogos do Club Penguin, em HTML5).

export const MINIJOGOS_CATEGORIES = [
  { id: 'acao', name: 'Ação e reflexo', description: 'Rapidez nos dedos e atenção total.' },
  { id: 'casual', name: 'Casual', description: 'Partidas rápidas pra jogar a qualquer hora.' },
  { id: 'corrida', name: 'Corrida', description: 'Desça a montanha o mais rápido que puder.' },
];

export const MINIJOGOS = [
  {
    slug: 'beancounters',
    name: 'Bean Counters',
    description: 'Pegue os sacos de café que caem do caminhão e empilhe na plataforma.',
    category: 'acao',
    controls: 'Mouse ou setas pra andar, clique ou Espaço pra soltar o saco.',
    featured: true,
  },
  {
    slug: 'pizzatron',
    name: 'Pizzatron 3000',
    description: 'Monte as pizzas dos pedidos na esteira antes que elas passem.',
    category: 'casual',
    controls: 'Arraste os ingredientes com o mouse até a pizza.',
    featured: true,
  },
  {
    slug: 'sledracing',
    name: 'Sled Racing',
    description: 'Desça a montanha de boia desviando de pedras e troncos.',
    category: 'corrida',
    controls: 'Setas pra esquerda e direita pra desviar.',
    featured: true,
  },
].map((g) => ({
  ...g,
  path: `/minigames/${g.slug}/index.html`,
  cover: `/minigames/${g.slug}/cover.webp`,
  icon: `/minigames/${g.slug}/icon.webp`,
}));

export function findMinijogo(slug) {
  return MINIJOGOS.find((g) => g.slug === slug) || null;
}
