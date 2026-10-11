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
  { id: 'puffles', name: 'Puffles', description: 'Cuide, alimente e brinque com os puffles.' },
  { id: 'arcade', name: 'Arcade clássico', description: 'Os fliperamas do clube, em Flash.' },
  { id: 'musica', name: 'Música', description: 'Ritmo e dança.' },
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

// Jogos em Flash (.swf), rodando no Ruffle (emulador em WebAssembly servido
// pelo próprio app). Vieram do segundo zip do dono (recriação de fã).
const FLASH = [
  ['thinice', 'Thin Ice', 'Derreta todo o gelo do labirinto sem ficar preso.', 'arcade', true],
  ['astrobarrier', 'Astro Barrier', 'Atire nos alvos que passam e avance de fase.', 'arcade', true],
  ['cartsurfer', 'Cart Surfer', 'Surfe no carrinho da mina fazendo manobras.', 'corrida', true],
  ['icefishing', 'Ice Fishing', 'Pesque peixes no gelo sem perder a linha.', 'casual', false],
  ['aquagrabber', 'Aqua Grabber', 'Explore o fundo do mar com o submarino.', 'arcade', false],
  ['catchinwaves', "Catchin' Waves", 'Pegue as ondas e faça manobras na prancha.', 'acao', false],
  ['dance', 'Dance Contest', 'Acerte as setas no ritmo da música.', 'musica', true],
  ['systemdefender', 'System Defender', 'Defenda o sistema das ondas de robôs.', 'arcade', false],
  ['hydrohopper', 'Hydro Hopper', 'Pilote o barco e desvie dos obstáculos.', 'acao', false],
  ['balloonpop', 'Balloon Pop', 'Estoure os balões e faça pontos.', 'casual', false],
  ['feedapuffle', 'Feed-A-Puffle', 'Alimente os puffles antes que fiquem com fome.', 'puffles', false],
  ['pufflepaddle', 'Puffle Paddle', 'Rebata os puffles e não deixe nenhum cair.', 'puffles', false],
  ['puffleroundup', 'Puffle Roundup', 'Junte todos os puffles no cercado.', 'puffles', false],
  ['pufflesoaker', 'Puffle Soaker', 'Molhe os alvos com os puffles.', 'puffles', false],
  ['fluffy', 'Fluffy the Fish', 'Pesque com o Fluffy.', 'casual', false],
].map(([slug, name, description, category, featured]) => ({
  slug, name, description, category, featured, flash: true,
  controls: 'Mouse e teclado (setas e Espaço).',
  path: `/minigames/flash/player.html?swf=${slug}/${slug === 'fluffy' ? 'fluffy.swf' : 'pcshell.swf'}`,
  cover: `/minigames/flash/${slug}/cover.webp`,
  icon: `/minigames/flash/${slug}/icon.webp`,
}));
MINIJOGOS.push(...FLASH);

export function findMinijogo(slug) {
  return MINIJOGOS.find((g) => g.slug === slug) || null;
}
