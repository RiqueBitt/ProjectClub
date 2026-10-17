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
    name: 'Pilha de Café',
    original: 'Bean Counters',
    touch: 'Arraste o dedo para andar; toque ou use o botão Soltar para soltar o saco.',
    description: 'Pegue os sacos de café que caem do caminhão e empilhe na plataforma.',
    category: 'acao',
    controls: 'Mouse ou setas pra andar, clique ou Espaço pra soltar o saco.',
    featured: true,
  },
  {
    slug: 'pizzatron',
    name: 'Pizzatron 3000',
    touch: 'Arraste o molho e os ingredientes até a pizza.',
    description: 'Monte as pizzas dos pedidos na esteira antes que elas passem.',
    category: 'casual',
    controls: 'Arraste os ingredientes com o mouse até a pizza.',
    featured: true,
  },
  {
    slug: 'sledracing',
    name: 'Corrida de Trenó',
    original: 'Sled Racing',
    touch: 'Toque ou segure ◀ ▶ para desviar.',
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

// Textos dos jogos em Flash traduzidos para pt-BR (lang/en/locale.swf).
// Jogos em Flash (.swf), rodando no Ruffle (emulador em WebAssembly servido
// pelo próprio app). Vieram do segundo zip do dono (recriação de fã).
const FLASH = [
  // [slug, nome em pt-BR, nome original, descrição, categoria, destaque, dica no toque]
  // (os controles na tela de cada jogo ficam em touch/schemes.js)
  ['thinice', 'Gelo Fino', 'Thin Ice', 'Derreta todo o gelo do labirinto sem ficar preso.', 'arcade', true, 'Use o direcional na tela para andar.'],
  ['astrobarrier', 'Astro Barreira', 'Astro Barrier', 'Atire nos alvos que passam e avance de fase.', 'arcade', true, '◀ ▶ movem a nave, o botão Atirar dispara e OK continua.'],
  ['cartsurfer', 'Surfe no Carrinho', 'Cart Surfer', 'Surfe no carrinho da mina fazendo manobras.', 'corrida', true, 'O direcional inclina e faz manobras; o botão Pular pula.'],
  ['icefishing', 'Pescaria no Gelo', 'Ice Fishing', 'Pesque peixes no gelo sem perder a linha.', 'casual', false, 'Arraste o dedo para subir e descer o anzol; toque para soltar o peixe.'],
  ['aquagrabber', 'Garra Submarina', 'Aqua Grabber', 'Explore o fundo do mar com o submarino.', 'arcade', false, 'Arraste o analógico para mover o submarino; o botão Garra pega e solta.'],
  ['catchinwaves', 'Pegando Onda', "Catchin' Waves", 'Pegue as ondas e faça manobras na prancha.', 'acao', false, 'Arraste o dedo para surfar e toque para manobrar.'],
  ['dance', 'Competição de Dança', 'Dance Contest', 'Acerte as setas no ritmo da música.', 'musica', true, 'Toque nas setas (← ↓ na esquerda, ↑ → na direita) no ritmo da música.'],
  ['systemdefender', 'Defensor do Sistema', 'System Defender', 'Defenda o sistema das ondas de robôs.', 'arcade', false, 'Toque no canhão e depois no quadrado onde quer construir.'],
  ['hydrohopper', 'Hidro Saltador', 'Hydro Hopper', 'Pilote o barco e desvie dos obstáculos.', 'acao', false, 'Arraste o dedo para mover e toque para pular.'],
  ['balloonpop', 'Estoura-Balão', 'Balloon Pop', 'Estoure os balões e faça pontos.', 'casual', false, 'Toque e segure para soprar o puffle.'],
  ['feedapuffle', 'Alimente o Puffle', 'Feed-A-Puffle', 'Alimente os puffles antes que fiquem com fome.', 'puffles', false, 'Arraste para mirar e toque para lançar a comida.'],
  ['pufflepaddle', 'Raquete Puffle', 'Puffle Paddle', 'Rebata os puffles e não deixe nenhum cair.', 'puffles', false, 'Arraste o dedo para mover a raquete.'],
  ['puffleroundup', 'Reunir Puffles', 'Puffle Roundup', 'Junte todos os puffles no cercado.', 'puffles', false, 'Arraste o dedo para guiar os puffles até o cercado.'],
  ['pufflesoaker', 'Molha-Puffle', 'Puffle Soaker', 'Molhe os alvos com os puffles.', 'puffles', false, 'O direcional move e muda a mira; o botão Atirar molha.'],
  ['fluffy', 'Fluffy, o Peixe', 'Fluffy the Fish', 'Pesque com o Fluffy.', 'casual', false, 'Arraste o dedo para mover o anzol.'],
].map(([slug, name, original, description, category, featured, touch]) => ({
  slug, name, original, description, category, featured, touch, flash: true,
  controls: 'Mouse e teclado (setas e Espaço).',
  path: `/minigames/flash/player.html?swf=${slug}/${slug === 'fluffy' ? 'fluffy.swf' : 'pcshell.swf'}`,
  cover: `/minigames/flash/${slug}/cover.webp`,
  icon: `/minigames/flash/${slug}/icon.webp`,
}));
MINIJOGOS.push(...FLASH);

export function findMinijogo(slug) {
  return MINIJOGOS.find((g) => g.slug === slug) || null;
}
