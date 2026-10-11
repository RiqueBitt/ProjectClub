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

// v2: novas habilidades + feitiços e equipamentos.
const S = (slug, name, element, rarity, cost, ability, abilityValue, flavor) => ({
  slug, name, element, rarity, cost, attack: 0, health: 1, ability, abilityValue, flavor, collection: 'Arcanos', kind: 'SPELL',
});
const SEED_CARDS_V2 = [
  C('raposa-sombra', 'Raposa da Sombra', 'SOMBRA', 'INCOMUM', 2, 3, 2, 'FURTIVO', 0, 'Você só a vê quando já é tarde.', 'Arcanos'),
  C('lobo-glacial', 'Lobo Glacial', 'AGUA', 'RARA', 4, 3, 5, 'CONGELA', 0, 'Seu uivo congela o ar.', 'Arcanos'),
  C('capita-recrutas', 'Capitã dos Recrutas', 'LUZ', 'RARA', 4, 3, 3, 'INVOCAR', 2, 'Nunca luta sozinha.', 'Arcanos'),
  C('cacto-guardiao', 'Cacto Guardião', 'TERRA', 'INCOMUM', 3, 1, 6, 'ESPINHOS', 2, 'Abraços não são recomendados.', 'Arcanos'),
  C('sacerdote-vento', 'Sacerdote do Vento', 'AR', 'EPICA', 5, 3, 5, 'PROTEGER', 0, 'Uma brisa que vira muralha.', 'Arcanos'),
  C('assassina-lua', 'Assassina da Lua', 'SOMBRA', 'EPICA', 5, 6, 3, 'FURTIVO', 0, 'Golpeia de onde ninguém olha.', 'Arcanos'),
  C('fera-magma', 'Fera de Magma', 'FOGO', 'RARA', 5, 5, 5, 'ESPINHOS', 2, 'Tocar nela queima.', 'Arcanos'),
  C('dragao-gelo', 'Dragão do Gelo Eterno', 'AGUA', 'LENDARIA', 8, 7, 8, 'CONGELA', 0, 'Seu sopro para o tempo.', 'Arcanos'),
  S('bola-fogo', 'Bola de Fogo', 'FOGO', 'COMUM', 2, 'FEITICO_DANO', 3, 'Clássica. Eficiente. Quente.'),
  S('chuva-meteoros', 'Chuva de Meteoros', 'FOGO', 'EPICA', 6, 'FEITICO_AREA', 3, 'O céu inteiro desaba.'),
  S('pocao-vida', 'Poção de Vida', 'LUZ', 'COMUM', 1, 'FEITICO_CURA', 5, 'Gosto de morango.'),
  S('pergaminho-antigo', 'Pergaminho Antigo', 'AR', 'RARA', 2, 'FEITICO_COMPRA', 2, 'Escrito por quem já viu tudo.'),
  S('espada-runica', 'Espada Rúnica', 'TERRA', 'INCOMUM', 2, 'FEITICO_BUFF', 2, 'Equipamento: brilha na mão certa.'),
  S('armadura-sagrada', 'Armadura Sagrada', 'LUZ', 'RARA', 3, 'FEITICO_BUFF', 3, 'Equipamento: forjada na aurora.'),
  S('bolha-protetora', 'Bolha Protetora', 'AGUA', 'INCOMUM', 1, 'FEITICO_ESCUDO', 0, 'Pop! Mas só depois do golpe.'),
  S('prisao-gelo', 'Prisão de Gelo', 'AGUA', 'INCOMUM', 2, 'FEITICO_CONGELAR', 1, 'Fica aí e pensa no que fez.'),
  S('raio-sombrio', 'Raio Sombrio', 'SOMBRA', 'RARA', 4, 'FEITICO_DANO', 5, 'Nem a luz escapa.'),
  S('furacao', 'Furacão', 'AR', 'LENDARIA', 7, 'FEITICO_AREA', 4, 'Leva tudo, menos você.'),
];

// Campanha inicial (a staff edita depois).
const SEED_CAMPAIGN = [
  { position: 0, name: 'O Primeiro Duelo', botName: 'Aprendiz Pip', difficulty: 'FACIL', heroHp: 20, rewardCoins: 60, story: 'Pip encontrou um baralho velho no sótão e jura que é o melhor duelista da vila. Mostre a ele como se joga de verdade.' },
  { position: 1, name: 'A Floresta Sussurrante', botName: 'Druida Mel', difficulty: 'FACIL', heroHp: 26, rewardCoins: 90, story: 'As árvores comentam sobre um novato habilidoso. A druida Mel quer testar se os boatos são verdadeiros.' },
  { position: 2, name: 'Porto das Marés', botName: 'Capitã Nora', difficulty: 'MEDIO', heroHp: 28, rewardCoins: 130, story: 'No porto, a Capitã Nora só deixa passar quem vence uma partida. A maré não espera ninguém.' },
  { position: 3, name: 'Forja do Vulcão', botName: 'Ferreiro Brasa', difficulty: 'MEDIO', heroHp: 32, rewardCoins: 180, story: 'O ferreiro forja cartas lendárias — e só entrega uma a quem sobreviver ao calor do seu baralho de fogo.' },
  { position: 4, name: 'Torre dos Ventos', botName: 'Mestre Kael', difficulty: 'DIFICIL', heroHp: 32, rewardCoins: 260, story: 'Kael pensa uma jogada à frente. No topo da torre, cada erro custa caro.' },
  { position: 5, name: 'O Trono do Eclipse', botName: 'Arquimaga Vex', difficulty: 'LENDARIO', heroHp: 36, rewardCoins: 500, story: 'A Arquimaga reúne as cartas mais raras do mundo. Vencê-la faz de você uma lenda da Arena.' },
];

const W_BASIC = { COMUM: 62, INCOMUM: 25, RARA: 9, EPICA: 3, LENDARIA: 0.9, MITICA: 0.1 };
const W_PLUS = { COMUM: 40, INCOMUM: 32, RARA: 18, EPICA: 7, LENDARIA: 2.5, MITICA: 0.5 };
const W_LEG = { COMUM: 0, INCOMUM: 30, RARA: 40, EPICA: 20, LENDARIA: 8, MITICA: 2 };

const SEED_PACKS = [
  { name: 'Pacote Origens', description: '5 cartas da coleção Origens. Ótimo para começar a coleção.', color: '#7c5cff', priceCoins: 150, cardsPerPack: 5, weights: W_BASIC, guaranteed: 'INCOMUM', sort: 0 },
  { name: 'Pacote Elemental', description: '6 cartas com mais chance de Raras e Épicas.', color: '#ff7a3d', priceCoins: 400, cardsPerPack: 6, weights: W_PLUS, guaranteed: 'RARA', sort: 1 },
  { name: 'Pacote Lendário', description: '5 cartas sem Comuns, com uma Épica ou melhor garantida.', color: '#f5c542', priceGems: 30, cardsPerPack: 5, weights: W_LEG, guaranteed: 'EPICA', sort: 2, dailyLimit: 3 },
];

// v3 — expansão "Ecos do Abismo" (pacote por tempo limitado).
const SEED_CARDS_V3 = [
  C('vigia-abissal', 'Vigia Abissal', 'SOMBRA', 'COMUM', 2, 2, 3, 'GUARDA', 0, 'Seus olhos nunca piscam.', 'Ecos do Abismo'),
  C('enguia-voltaica', 'Enguia Voltaica', 'AGUA', 'COMUM', 1, 2, 1, 'INVESTIDA', 0, 'Um choque e some.', 'Ecos do Abismo'),
  C('coral-ancestral', 'Coral Ancestral', 'TERRA', 'INCOMUM', 3, 1, 5, 'REGENERA', 2, 'Cresce mesmo partido.', 'Ecos do Abismo'),
  C('lanterneiro', 'Peixe-Lanterneiro', 'LUZ', 'INCOMUM', 2, 2, 2, 'GRITO_COMPRA', 1, 'Ilumina o que estava perdido.', 'Ecos do Abismo'),
  C('arraia-tempestade', 'Arraia da Tempestade', 'AR', 'RARA', 4, 4, 3, 'GRITO_RAIO', 2, 'Voa debaixo d\'água.', 'Ecos do Abismo'),
  C('sereia-sombria', 'Sereia Sombria', 'SOMBRA', 'RARA', 4, 3, 4, 'ROUBO_VIDA', 0, 'Canta e drena.', 'Ecos do Abismo'),
  C('magma-profundo', 'Magma Profundo', 'FOGO', 'RARA', 5, 5, 4, 'ULTIMO_SUSPIRO', 3, 'Até o mar ferve.', 'Ecos do Abismo'),
  C('kraken-jovem', 'Kraken Jovem', 'AGUA', 'EPICA', 6, 5, 7, 'FURIA', 0, 'Oito braços, dois ataques.', 'Ecos do Abismo'),
  C('oraculo-mares', 'Oráculo dos Mares', 'LUZ', 'EPICA', 5, 3, 6, 'AURA', 1, 'Vê o fim de cada batalha.', 'Ecos do Abismo'),
  C('leviata-eclipse', 'Leviatã do Eclipse', 'SOMBRA', 'LENDARIA', 8, 8, 8, 'VENENO', 0, 'Quando ele sobe, a luz desce.', 'Ecos do Abismo'),
  { ...S('maremoto', 'Maremoto', 'AGUA', 'EPICA', 6, 'FEITICO_AREA', 3, 'Nada fica de pé.'), collection: 'Ecos do Abismo' },
  { ...S('corrente-fria', 'Corrente Fria', 'AGUA', 'COMUM', 2, 'FEITICO_CONGELAR', 1, 'O frio do fundo.'), collection: 'Ecos do Abismo' },
];

module.exports = { SEED_CARDS, SEED_CARDS_V2, SEED_CARDS_V3, SEED_PACKS, SEED_CAMPAIGN };
