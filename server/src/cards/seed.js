// Catálogo inicial ORIGINAL do Project Club (criado do zero — nenhuma carta
// de outro jogo). Só é inserido quando o banco ainda não tem cartas; depois
// disso a staff edita tudo pelo painel.
const C = (slug, name, element, rarity, cost, attack, health, ability = 'NONE', abilityValue = 0, flavor = '', collection = 'Origens') => ({
  slug, name, element, rarity, cost, attack, health, ability, abilityValue, flavor, collection,
});

const SEED_CARDS = [
  // FOGO
  C('faisca', 'Faísca Saltitante', 'FOGO', 'COMUM', 1, 2, 1, 'INVESTIDA', 0, 'Pequena, rápida e sempre com pressa.'),
  C('lobo-brasa', 'Lobo de Brasa', 'FOGO', 'COMUM', 2, 3, 2, 'NONE', 0, 'Deixa pegadas que ainda queimam.'),
  C('guarda-forja', 'Guardião da Forja', 'FOGO', 'INCOMUM', 3, 2, 5, 'GUARDA', 0, 'Ninguém passa pela bigorna.'),
  C('alquimista-chama', 'Alquimista da Chama', 'FOGO', 'RARA', 3, 2, 3, 'GRITO_DANO', 3, 'Toda receita termina em explosão.'),
  C('fenix-rubra', 'Fênix Rubra', 'FOGO', 'EPICA', 5, 5, 4, 'ULTIMO_SUSPIRO', 4, 'Cai em cinzas para nascer de novo.'),
  C('titan-vulcao', 'Titã do Vulcão', 'FOGO', 'LENDARIA', 8, 8, 8, 'FURIA', 0, 'Quando acorda, o chão inteiro treme.'),
  // ÁGUA
  C('girino-bolha', 'Girino Bolha', 'AGUA', 'COMUM', 1, 1, 3, 'NONE', 0, 'Faz bolhas quando está feliz.'),
  C('curandeira-mare', 'Curandeira da Maré', 'AGUA', 'COMUM', 2, 1, 3, 'GRITO_CURA', 4, 'A maré leva as feridas embora.'),
  C('tartaruga-coral', 'Tartaruga de Coral', 'AGUA', 'INCOMUM', 4, 2, 7, 'GUARDA', 0, 'Carrega um recife inteiro nas costas.'),
  C('oraculo-abissal', 'Oráculo Abissal', 'AGUA', 'RARA', 4, 3, 4, 'GRITO_COMPRA', 2, 'Lê o futuro no fundo do mar.'),
  C('serpente-gelo', 'Serpente de Gelo', 'AGUA', 'EPICA', 5, 4, 5, 'VENENO', 0, 'Uma mordida e tudo congela.'),
  C('leviata', 'Leviatã Ancestral', 'AGUA', 'MITICA', 9, 9, 10, 'ESCUDO', 0, 'Mais antigo que os próprios oceanos.'),
  // TERRA
  C('broto-pedra', 'Broto de Pedra', 'TERRA', 'COMUM', 1, 1, 2, 'GUARDA', 0, 'Pequeno, mas teimoso.'),
  C('javali-musgo', 'Javali de Musgo', 'TERRA', 'COMUM', 3, 3, 4, 'NONE', 0, 'Abre caminho na floresta com a cabeça.'),
  C('golem-argila', 'Golem de Argila', 'TERRA', 'INCOMUM', 4, 4, 5, 'REGENERA', 2, 'Se remenda com a lama do caminho.'),
  C('druida-raiz', 'Druida das Raízes', 'TERRA', 'RARA', 3, 2, 4, 'AURA', 1, 'As raízes falam e o exército escuta.'),
  C('colosso-jade', 'Colosso de Jade', 'TERRA', 'EPICA', 6, 5, 8, 'GUARDA', 0, 'Uma montanha que aprendeu a andar.'),
  C('mae-montanha', 'Mãe Montanha', 'TERRA', 'LENDARIA', 7, 6, 9, 'REGENERA', 4, 'Protege tudo que cresce em suas encostas.'),
  // AR
  C('pardal-vento', 'Pardal do Vento', 'AR', 'COMUM', 1, 1, 1, 'GRITO_COMPRA', 1, 'Traz notícias de longe.'),
  C('arqueira-nuvem', 'Arqueira das Nuvens', 'AR', 'COMUM', 2, 2, 2, 'GRITO_RAIO', 1, 'Nunca erra um alvo lá de cima.'),
  C('falcao-tempestade', 'Falcão da Tempestade', 'AR', 'INCOMUM', 3, 3, 2, 'INVESTIDA', 0, 'Chega antes do trovão.'),
  C('monge-brisa', 'Monge da Brisa', 'AR', 'RARA', 2, 2, 3, 'ENERGIA', 2, 'Respira fundo e o mundo acelera.'),
  C('dragao-ciclone', 'Dragão Ciclone', 'AR', 'EPICA', 6, 5, 5, 'FURIA', 0, 'Gira tão rápido que ataca duas vezes.'),
  C('rainha-ceus', 'Rainha dos Céus', 'AR', 'LENDARIA', 7, 6, 6, 'GRITO_RAIO', 5, 'Seu raio cai onde ela aponta.'),
  // LUZ
  C('vagalume', 'Vagalume Guardião', 'LUZ', 'COMUM', 1, 1, 2, 'ESCUDO', 0, 'Uma luzinha que não se apaga.'),
  C('escudeiro-sol', 'Escudeiro do Sol', 'LUZ', 'COMUM', 2, 2, 3, 'GUARDA', 0, 'Leva o escudo mais pesado do reino.'),
  C('cleriga-aurora', 'Clériga da Aurora', 'LUZ', 'INCOMUM', 3, 2, 4, 'GRITO_CURA', 5, 'Cada amanhecer é uma nova chance.'),
  C('paladino-prisma', 'Paladino Prisma', 'LUZ', 'RARA', 4, 4, 4, 'ESCUDO', 0, 'A luz se dobra ao redor da armadura.'),
  C('arcanjo', 'Arcanjo Radiante', 'LUZ', 'EPICA', 6, 5, 6, 'ROUBO_VIDA', 0, 'Cura aliados com cada golpe.'),
  C('estrela-primordial', 'Estrela Primordial', 'LUZ', 'MITICA', 10, 10, 10, 'AURA', 2, 'A primeira luz do universo.'),
  // SOMBRA
  C('morcego-eco', 'Morcego Eco', 'SOMBRA', 'COMUM', 1, 2, 1, 'ROUBO_VIDA', 0, 'Ouve tudo, inclusive o seu medo.'),
  C('ladino-nevoa', 'Ladino da Névoa', 'SOMBRA', 'COMUM', 2, 3, 1, 'INVESTIDA', 0, 'Quando você vê, ele já passou.'),
  C('aranha-sombria', 'Aranha Sombria', 'SOMBRA', 'INCOMUM', 2, 1, 2, 'VENENO', 0, 'Pequena, silenciosa e letal.'),
  C('bruxa-lua', 'Bruxa da Lua Nova', 'SOMBRA', 'RARA', 4, 3, 3, 'GRITO_DANO', 4, 'Seus feitiços só funcionam no escuro.'),
  C('cavaleiro-eclipse', 'Cavaleiro do Eclipse', 'SOMBRA', 'EPICA', 5, 5, 4, 'ROUBO_VIDA', 0, 'Cavalga entre o dia e a noite.'),
  C('rei-abismo', 'Rei do Abismo', 'SOMBRA', 'LENDARIA', 8, 7, 7, 'VENENO', 0, 'Seu trono fica onde a luz não chega.'),
];

const W_BASIC = { COMUM: 62, INCOMUM: 25, RARA: 9, EPICA: 3, LENDARIA: 0.9, MITICA: 0.1 };
const W_PLUS = { COMUM: 40, INCOMUM: 32, RARA: 18, EPICA: 7, LENDARIA: 2.5, MITICA: 0.5 };
const W_LEG = { COMUM: 0, INCOMUM: 30, RARA: 40, EPICA: 20, LENDARIA: 8, MITICA: 2 };

const SEED_PACKS = [
  { name: 'Pacote Origens', description: '5 cartas da coleção Origens. Ótimo para começar a coleção.', color: '#7c5cff', priceCoins: 150, cardsPerPack: 5, weights: W_BASIC, guaranteed: 'INCOMUM', sort: 0 },
  { name: 'Pacote Elemental', description: '6 cartas com mais chance de Raras e Épicas.', color: '#ff7a3d', priceCoins: 400, cardsPerPack: 6, weights: W_PLUS, guaranteed: 'RARA', sort: 1 },
  { name: 'Pacote Lendário', description: '5 cartas sem Comuns, com uma Épica ou melhor garantida.', color: '#f5c542', priceGems: 30, cardsPerPack: 5, weights: W_LEG, guaranteed: 'EPICA', sort: 2, dailyLimit: 3 },
];

module.exports = { SEED_CARDS, SEED_PACKS };
