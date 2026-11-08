// Coleções temáticas da Loja (criadas por scripts/seed-colecoes.js).
// Cada coleção junta estilos de perfil que JÁ existem (nada é apagado) com
// molduras, efeitos, uma fonte exclusiva e um banner próprios. As imagens
// ficam em client/public/loja/<slug>/ (banner.webp, moldura-N.webp,
// efeito-N.webp). O campo "art" só é usado pelo gerador das imagens.
//
// 10 coleções com 2 estilos (3 molduras, 2 efeitos, 1 fonte) e, pros
// estilos que sobraram, coleções de 1 estilo (2 molduras, 2 efeitos, 1 fonte).

const COLLECTIONS = [
  // ------------------------------------------------------------ 2 estilos
  {
    slug: 'rede-neon', name: 'Rede Neon', accent: '#05d9e8', styles: ['cyberpunk', 'matrix'],
    description: 'Hackers, letreiros de neon e código verde caindo numa cidade que nunca dorme.',
    font: { name: 'Neon Digital', family: 'Orbitron', description: 'Letras geométricas de painel futurista.' },
    frames: [
      { name: 'Fone Cyber', description: 'Fone de ouvido neon com microfone e luz piscando.' },
      { name: 'Terminal', description: 'Código verde em volta da foto e um terminal hackeando no canto.' },
      { name: 'Orelhas Neon', description: 'Orelhinhas de gato em neon que piscam.' },
    ],
    effects: [
      { name: 'Chuva de Código', description: 'Colunas de código verde descendo pelo perfil.' },
      { name: 'Varredura Neon', description: 'Uma linha de scanner atravessa o perfil com falhas de sinal.' },
    ],
  },
  {
    slug: 'fliperama', name: 'Fliperama', accent: '#ff00aa', styles: ['arcade', 'pixel'],
    description: 'Fichas, placar piscando e pixels de videogame antigo.',
    font: { name: 'Ficha Pixel', family: 'Press Start 2P', description: 'A letra de 8 bits dos placares de fliperama.' },
    frames: [
      { name: 'Pilha de Fichas', description: 'Pilhas de fichas douradas e moedinhas pulando.' },
      { name: 'Vida Extra', description: 'Três corações de vida em pixel em cima da foto.' },
      { name: 'Controle do Fliperama', description: 'Painel com joystick e botões, e o letreiro piscando.' },
    ],
    effects: [
      { name: 'Chuva de Fichas', description: 'Moedas de 8 bits pulando pelo perfil.' },
      { name: 'Invasão Pixel', description: 'Naves de pixel atravessando a tela em formação.' },
    ],
  },
  {
    slug: 'retrowave', name: 'Retrowave', accent: '#ff71ce', styles: ['vaporwave', 'sunset'],
    description: 'Sol listrado, palmeiras e grade neon de fita cassete dos anos 80.',
    font: { name: 'Neon Retrô', family: 'Monoton', description: 'Letreiro de neon em linhas paralelas.' },
    frames: [
      { name: 'Sol Listrado', description: 'O sol retrô listrado nascendo atrás da foto.' },
      { name: 'Palmeiras', description: 'Duas palmeiras balançando dos lados da foto.' },
      { name: 'Mixtape', description: 'Fita cassete girando e neon rosa e azul.' },
    ],
    effects: [
      { name: 'Estrelas Cadentes', description: 'Estrelas cor-de-rosa riscando o céu.' },
      { name: 'Horizonte Neon', description: 'Linhas de neon subindo como a grade do horizonte.' },
    ],
  },
  {
    slug: 'assombrado', name: 'Assombrado', accent: '#ff7518', styles: ['terror', 'halloween'],
    description: 'Lua cheia, morcegos, abóboras e uma névoa que ninguém sabe de onde vem.',
    font: { name: 'Arrepio', family: 'Creepster', description: 'Letras tortas de filme de terror.' },
    frames: [
      { name: 'Sangue Escorrendo', description: 'Anel vermelho com gotas escorrendo.' },
      { name: 'Abóboras', description: 'Abóboras iluminadas e uma vinha seca.' },
      { name: 'Teia de Aranha', description: 'Teia no canto, aranha descendo e um morcego.' },
    ],
    effects: [
      { name: 'Revoada de Morcegos', description: 'Morcegos voando pelo perfil.' },
      { name: 'Névoa Assombrada', description: 'Névoa e fantasminhas passando devagar.' },
    ],
  },
  {
    slug: 'cosmos', name: 'Cosmos', accent: '#8a6bff', styles: ['galaxia', 'aurora'],
    description: 'Nebulosas, planetas e cortinas de aurora dançando no céu.',
    font: { name: 'Estelar', family: 'Exo 2', description: 'Letra limpa de nave espacial.' },
    frames: [
      { name: 'Órbita', description: 'Um planeta com anéis e uma lua dando a volta na foto.' },
      { name: 'Lua e Estrelas', description: 'Uma constelação brilhando e a lua sorrindo.' },
      { name: 'Aurora', description: 'Anel de luz verde e roxa ondulando.' },
    ],
    effects: [
      { name: 'Chuva de Meteoros', description: 'Meteoros cruzando o perfil.' },
      { name: 'Cortina de Aurora', description: 'Faixas de aurora boreal dançando.' },
    ],
  },
  {
    slug: 'jardim-japones', name: 'Jardim Japonês', accent: '#ff4f9f', styles: ['anime', 'sakura'],
    description: 'Cerejeiras em flor, brilhos de anime e pétalas no vento.',
    font: { name: 'Mochi', family: 'Zen Maru Gothic', description: 'Letra arredondada e fofa.' },
    frames: [
      { name: 'Galho de Cerejeira', description: 'Galho com flores de sakura em volta da foto.' },
      { name: 'Orelhinhas Kawaii', description: 'Orelhas de coelho, coraçõezinhos e brilhos.' },
      { name: 'Laço de Fita', description: 'Fita cor-de-rosa com um laço grande.' },
    ],
    effects: [
      { name: 'Pétalas ao Vento', description: 'Pétalas de cerejeira caindo devagar.' },
      { name: 'Brilho de Anime', description: 'Explosão de brilhos de abertura de anime.' },
    ],
  },
  {
    slug: 'fogo-e-gelo', name: 'Fogo e Gelo', accent: '#ff3d00', styles: ['lava', 'inverno'],
    description: 'De um lado o vulcão, do outro a nevasca. Escolha o seu lado.',
    font: { name: 'Elemental', family: 'Russo One', description: 'Letra forte e pesada.' },
    frames: [
      { name: 'Anel de Fogo', description: 'Chamas subindo em volta da foto.' },
      { name: 'Cristal de Gelo', description: 'Cristais de gelo brilhando.' },
      { name: 'Brasa e Neve', description: 'Metade fogo, metade gelo.' },
    ],
    effects: [
      { name: 'Brasas Subindo', description: 'Faíscas de lava subindo.' },
      { name: 'Nevasca', description: 'Flocos de neve caindo com vento.' },
    ],
  },
  {
    slug: 'reino-antigo', name: 'Reino Antigo', accent: '#d4af37', styles: ['realeza', 'medieval'],
    description: 'Coroas, selos de cera e ouro de um castelo antigo.',
    font: { name: 'Real', family: 'Cinzel Decorative', description: 'Letra de inscrição real.' },
    frames: [
      { name: 'Coroa Real', description: 'Moldura dourada com coroa no topo.' },
      { name: 'Selo de Cera', description: 'Pergaminho com selo de cera vermelho.' },
      { name: 'Joias da Coroa', description: 'Aro de ouro cravejado de pedras.' },
    ],
    effects: [
      { name: 'Chuva de Ouro', description: 'Moedas e pó de ouro caindo.' },
      { name: 'Brilho Real', description: 'Um reflexo dourado passa pelo perfil.' },
    ],
  },
  {
    slug: 'velho-oeste', name: 'Velho Oeste', accent: '#c0582b', styles: ['faroeste', 'deserto'],
    description: 'Poeira, cactos, sol rachando e estrela de xerife.',
    font: { name: 'Saloon', family: 'Smokum', description: 'Letra de cartaz de procurado.' },
    frames: [
      { name: 'Chapéu de Xerife', description: 'Chapéu de vaqueiro e a estrela do xerife.' },
      { name: 'Laço de Corda', description: 'Laço de vaqueiro em volta da foto.' },
      { name: 'Cactos', description: 'Cactos e sol do deserto.' },
    ],
    effects: [
      { name: 'Bola de Feno', description: 'Bola de feno rolando com poeira.' },
      { name: 'Sol Escaldante', description: 'Raios de sol e ar tremendo de calor.' },
    ],
  },
  {
    slug: 'tarde-tranquila', name: 'Tarde Tranquila', accent: '#ffb88c', styles: ['lofi', 'cafe'],
    description: 'Café quentinho, disco tocando e chuva na janela.',
    font: { name: 'Bilhete', family: 'Caveat', description: 'Letra de mão, leve e solta.' },
    frames: [
      { name: 'Xícara de Café', description: 'Xícara fumegante e grãos de café.' },
      { name: 'Disco de Vinil', description: 'Um vinil girando atrás da foto e notas flutuando.' },
      { name: 'Plantinha', description: 'Vasinho de planta e folhas caindo pela foto.' },
    ],
    effects: [
      { name: 'Vapor de Café', description: 'Vapor subindo da xícara.' },
      { name: 'Notas Lo-fi', description: 'Notas musicais flutuando.' },
    ],
  },
  // ------------------------------------------------------------ 1 estilo
  {
    slug: 'erro-fatal', name: 'Erro Fatal', accent: '#ff2bd6', styles: ['bugado'],
    description: 'O perfil travou. As cores se separaram. Ninguém sabe consertar.',
    font: { name: 'Falha', family: 'Rubik Glitch', description: 'Letra com falhas de sinal.' },
    frames: [
      { name: 'Anel Bugado', description: 'Anel com as cores RGB separadas tremendo.' },
      { name: 'Pixels Quebrados', description: 'Blocos de pixel se desmontando.' },
    ],
    effects: [
      { name: 'Tela Bugada', description: 'Faixas de glitch atravessando o perfil.' },
      { name: 'Sinal Perdido', description: 'Chiado de TV fora do ar.' },
    ],
  },
  {
    slug: 'album-de-fotos', name: 'Álbum de Fotos', accent: '#b08350', styles: ['nostalgia'],
    description: 'Fotos reveladas, fita adesiva e lembranças em sépia.',
    font: { name: 'Dedicatória', family: 'Homemade Apple', description: 'Letra de quem escreve atrás da foto.' },
    frames: [
      { name: 'Polaroide', description: 'Sua foto numa polaroide antiga.' },
      { name: 'Fita Adesiva', description: 'Fotos antigas presas com fita colorida.' },
    ],
    effects: [
      { name: 'Fotos ao Vento', description: 'Polaroides caindo e girando.' },
      { name: 'Luz Sépia', description: 'Vazamento de luz de filme antigo.' },
    ],
  },
  {
    slug: 'oceano-profundo', name: 'Oceano Profundo', accent: '#3ee6d0', styles: ['oceano'],
    description: 'Luz entrando na água, bolhas e criaturas brilhantes.',
    font: { name: 'Maré', family: 'Baloo 2', description: 'Letra redondinha e leve.' },
    frames: [
      { name: 'Peixinhos', description: 'Peixinhos nadando em volta da foto e bolhas.' },
      { name: 'Conchas e Corais', description: 'Conchas, estrela-do-mar e corais.' },
    ],
    effects: [
      { name: 'Bolhas Subindo', description: 'Bolhas subindo até a superfície.' },
      { name: 'Águas-vivas', description: 'Águas-vivas brilhantes nadando.' },
    ],
  },
  {
    slug: 'floresta-encantada', name: 'Floresta Encantada', accent: '#7bd389', styles: ['floresta'],
    description: 'Musgo, cogumelos que brilham e vaga-lumes no escuro.',
    font: { name: 'Conto de Fadas', family: 'Uncial Antiqua', description: 'Letra de livro de contos antigo.' },
    frames: [
      { name: 'Vinha Encantada', description: 'Folhas de vinha crescendo em volta da foto.' },
      { name: 'Cogumelos', description: 'Cogumelos brilhantes e vaga-lumes.' },
    ],
    effects: [
      { name: 'Vaga-lumes', description: 'Vaga-lumes piscando pelo perfil.' },
      { name: 'Folhas Caindo', description: 'Folhas verdes caindo da copa.' },
    ],
  },
  {
    slug: 'volta-as-aulas', name: 'Volta às Aulas', accent: '#e53935', styles: ['caderno'],
    description: 'Lápis de cor, post-it e rabiscos na margem do caderno.',
    font: { name: 'Caderno', family: 'Patrick Hand', description: 'Letra de quem anota tudo à mão.' },
    frames: [
      { name: 'Lápis de Cor', description: 'Lápis coloridos e rabiscos de caneta.' },
      { name: 'Post-it', description: 'Post-its e um clipe presos na foto.' },
    ],
    effects: [
      { name: 'Aviõezinhos', description: 'Aviõezinhos de papel voando.' },
      { name: 'Rabiscos', description: 'Estrelinhas e rabiscos de caneta aparecendo.' },
    ],
  },
  {
    slug: 'engrenagens', name: 'Engrenagens', accent: '#c9a24a', styles: ['steampunk'],
    description: 'Latão, vapor e máquinas que nunca param de girar.',
    font: { name: 'Inventor', family: 'IM Fell English SC', description: 'Letra de manual antigo de máquinas.' },
    frames: [
      { name: 'Engrenagens', description: 'Engrenagens de latão girando e soltando vapor.' },
      { name: 'Relógio de Bolso', description: 'Relógio de bolso pendurado, com o ponteiro andando.' },
    ],
    effects: [
      { name: 'Vapor', description: 'Nuvens de vapor saindo das máquinas.' },
      { name: 'Peças Voando', description: 'Engrenagens soltas voando.' },
    ],
  },
  {
    slug: 'catedral', name: 'Catedral', accent: '#9b4dca', styles: ['gotico'],
    description: 'Vitrais coloridos, rosas negras e arcos de pedra.',
    font: { name: 'Gótica', family: 'UnifrakturMaguntia', description: 'Letra gótica de manuscrito.' },
    frames: [
      { name: 'Arco de Vitral', description: 'Arco gótico com vitrais coloridos.' },
      { name: 'Rosas Negras', description: 'Rosas escuras com espinhos.' },
    ],
    effects: [
      { name: 'Pétalas Negras', description: 'Pétalas escuras caindo.' },
      { name: 'Luz do Vitral', description: 'Luz colorida atravessando o vitral.' },
    ],
  },
  {
    slug: 'doceria', name: 'Doceria', accent: '#ff4fa0', styles: ['candy'],
    description: 'Pirulitos, granulado e bengalas doces.',
    font: { name: 'Bala', family: 'Sniglet', description: 'Letra gordinha de embalagem de doce.' },
    frames: [
      { name: 'Bengala Doce', description: 'Listras de bengala doce girando.' },
      { name: 'Rosquinha', description: 'Sua foto no meio de uma rosquinha com granulado.' },
    ],
    effects: [
      { name: 'Chuva de Balas', description: 'Balas embrulhadas caindo.' },
      { name: 'Confete de Granulado', description: 'Granulado estourando como confete.' },
    ],
  },
  {
    slug: 'noite-feliz', name: 'Noite Feliz', accent: '#e53935', styles: ['natal'],
    description: 'Pisca-pisca, guirlanda e neve caindo na noite de Natal.',
    font: { name: 'Cartão de Natal', family: 'Berkshire Swash', description: 'Letra de cartão de boas festas.' },
    frames: [
      { name: 'Gorro de Natal', description: 'Gorro de Papai Noel e pisca-pisca.' },
      { name: 'Guirlanda', description: 'Guirlanda com laço vermelho.' },
    ],
    effects: [
      { name: 'Neve de Natal', description: 'Flocos de neve e estrelinhas douradas.' },
      { name: 'Chuva de Presentes', description: 'Presentes e enfeites caindo.' },
    ],
  },
  {
    slug: 'cromado', name: 'Cromado', accent: '#7a5cff', styles: ['holografico'],
    description: 'Cromo líquido, prismas e reflexos de arco-íris.',
    font: { name: 'Prisma', family: 'Syncopate', description: 'Letra larga e futurista.' },
    frames: [
      { name: 'Cromo Líquido', description: 'Cromo escorrendo com reflexo de arco-íris.' },
      { name: 'Prismas', description: 'Cristais coloridos girando nos cantos.' },
    ],
    effects: [
      { name: 'Reflexo Holográfico', description: 'Faixa de arco-íris atravessando o perfil.' },
      { name: 'Brilhos Prismáticos', description: 'Brilhos coloridos estourando.' },
    ],
  },
  {
    slug: 'operacao-tatica', name: 'Operação Tática', accent: '#d4c35a', styles: ['militar'],
    description: 'Camuflagem, radar e alvo na mira.',
    font: { name: 'Estêncil', family: 'Stardos Stencil', description: 'Letra de caixa de munição.' },
    frames: [
      { name: 'Mira', description: 'Cantos de mira e alvo travado.' },
      { name: 'Capacete Camuflado', description: 'Capacete camuflado e plaqueta de identificação.' },
    ],
    effects: [
      { name: 'Radar', description: 'Varredura de radar encontrando alvos.' },
      { name: 'Fumaça Tática', description: 'Fumaça verde de sinalização.' },
    ],
  },
  {
    slug: 'arte-de-rua', name: 'Arte de Rua', accent: '#39ff14', styles: ['grafite'],
    description: 'Muro de tijolo, spray neon e tinta escorrendo.',
    font: { name: 'Pichação', family: 'Permanent Marker', description: 'Letra de marcador grosso.' },
    frames: [
      { name: 'Lata de Spray', description: 'Spray neon e a lata ainda soltando tinta.' },
      { name: 'Coroa de Grafite', description: 'Coroa pichada, estrela e respingos de tinta.' },
    ],
    effects: [
      { name: 'Respingos', description: 'Respingos de tinta neon estourando.' },
      { name: 'Tinta Escorrendo', description: 'Gotas de tinta escorrendo pelo perfil.' },
    ],
  },
  {
    slug: 'galeria', name: 'Galeria', accent: '#b8955a', styles: ['marmore'],
    description: 'Mármore branco, folha de ouro e silêncio de museu.',
    font: { name: 'Museu', family: 'Italiana', description: 'Letra fina e elegante.' },
    frames: [
      { name: 'Moldura de Museu', description: 'Sua foto exposta numa moldura de ouro e mármore.' },
      { name: 'Louros de Ouro', description: 'Coroa de louros dourada e folha de ouro caindo.' },
    ],
    effects: [
      { name: 'Poeira Dourada', description: 'Pó de ouro caindo devagar.' },
      { name: 'Luz de Museu', description: 'Uma luz suave passando pela obra.' },
    ],
  },
  {
    slug: 'cidade-sombria', name: 'Cidade Sombria', accent: '#e6e6e6', styles: ['noir'],
    description: 'Chuva, poste de luz e filme em preto e branco.',
    font: { name: 'Letreiro', family: 'Limelight', description: 'Letra de cinema antigo.' },
    frames: [
      { name: 'Rolo de Filme', description: 'Película de cinema dando a volta na foto.' },
      { name: 'Detetive', description: 'Chapéu de detetive e lupa.' },
    ],
    effects: [
      { name: 'Chuva Noir', description: 'Chuva fina em preto e branco.' },
      { name: 'Filme Antigo', description: 'Riscos e poeira de película velha.' },
    ],
  },
];

// Preços padrão (a staff muda no painel).
const PRICES = { frame: 1500, effect: 3000, font: 1200, style: 2500, bundleDouble: 12000, bundleSingle: 9000 };

module.exports = { COLLECTIONS, PRICES };
