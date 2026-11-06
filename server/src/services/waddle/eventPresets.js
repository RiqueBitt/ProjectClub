'use strict';
// Modelos prontos de eventos da Praça — montados a partir do que os projetos
// de fãs fazem (CP Legacy: Island Quests com dificuldade e prêmio final; CP
// Journey/Zero: moeda de festa + loja; CP Rewritten: Festival of Lights; CPO:
// marcos da comunidade) usando SÓ itens e salas originais do Club Penguin
// (ids do catálogo do jogo — nada desenhado). A staff cria o evento a partir
// do modelo no Painel → Club Penguin → Eventos da Praça e ajusta o que quiser.
//
// Cada modelo: { key, name, when (mês sugerido), currencyName, quests[],
// shop[], advent[], cfc, completion, codes[] (códigos sugeridos) }.
const R = { // salas (ids do jogo)
  town: 100, coffee: 110, dance: 120, lounge: 121, shop: 130, village: 200, sport: 210, lodge: 220, attic: 221, mtn: 230,
  plaza: 300, pet: 310, dojo: 320, dojoext: 321, pizza: 330, stage: 340, beach: 400, light: 410, beacon: 411, dock: 800, forts: 801,
  rink: 802, boiler: 804, berg: 805, cave: 806, shack: 807, mine: 808, forest: 809, cove: 810, box: 811, lake: 814,
};
const TOUR = [R.town, R.plaza, R.forts, R.village, R.beach, R.dock, R.forest, R.cove, R.berg, R.dance];
const q = (key, title, desc, type, extra = {}) => ({ key, title, desc, type, difficulty: 'facil', ...extra });
const diff = (d) => ({ difficulty: d });

const PRESETS = [
  {
    key: 'halloween', name: 'Festa de Halloween', when: 'outubro', currencyName: 'Doces', party: 'Halloween Party',
    quests: [
      q('explorar', 'Explorador assombrado', 'Visite as salas decoradas.', 'visit', { rooms: TOUR, ...diff('facil'), reward: { eventCoins: 20 } }),
      q('fantasia', 'Monster Mash', 'Vista uma fantasia de monstro.', 'wear', { items: [244, 789, 246, 10246, 4138, 3180, 12078, 1186, 4271], ...diff('facil'), reward: { eventCoins: 15 } }),
      q('abobora', 'Cabeça de abóbora', 'Vista a Cabeça de Abóbora ou a Abóbora Brilhante.', 'wear', { items: [1095, 1323, 1718], ...diff('media'), reward: { eventCoins: 20 } }),
      q('historias', 'Histórias de fantasma', 'Junte 5 pinguins na Cabana da Montanha.', 'gather', { rooms: [R.lodge], count: 5, ...diff('media'), reward: { eventCoins: 25 } }),
      q('disco', 'Discoteca assombrada', 'Esteja na Danceteria com 20 pinguins.', 'gather', { rooms: [R.dance], count: 20, ...diff('extrema'), reward: { eventCoins: 80 } }),
      q('danca', 'Dança dos monstros', 'Dance fantasiado no Centro, na Praça e na Danceteria.', 'dance', { rooms: [R.town, R.plaza, R.dance], items: [244, 789, 246, 10246, 4138, 3180, 12078, 1186, 4271, 1095, 1323], ...diff('dificil'), reward: { eventCoins: 40 } }),
      q('pingu', 'Doce ou travessura com o Pingu', 'Encontre o Pingu numa visita.', 'mascot', { mascot: 'pingu', ...diff('media'), reward: { eventCoins: 30 } }),
      q('ficar', 'Noite inteira', 'Fique 30 minutos na ilha.', 'online', { minutes: 30, ...diff('media'), reward: { eventCoins: 25 } }),
      // caça com dicas em rima (modelo da caça aos ovos do CP Legacy)
      q('pista1', 'Pista 1: a dica', 'Decifre a rima e vá até lá.', 'visit', { rooms: [R.mine], hint: 'Onde o carrinho desce sem parar, esse doce foi se esconder lá.', ...diff('facil'), reward: { eventCoins: 10 } }),
      q('pista2', 'Pista 2: a dica', 'Decifre a rima e vá até lá.', 'visit', { rooms: [R.beacon], hint: 'Lá no alto, girando a luz, quem sobe a escada o doce conduz.', ...diff('facil'), reward: { eventCoins: 10 } }),
      q('pista3', 'Pista 3: a dica', 'Decifre a rima e vá até lá.', 'visit', { rooms: [R.boiler], hint: 'Quente, escondida, embaixo do chão: a caldeira guarda a tentação.', ...diff('media'), reward: { eventCoins: 15 } }),
      q('trivia1', 'TourBot: o Pingu', 'Encontre o TourBot no Centro e responda.', 'trivia', { rooms: [R.town], question: 'Qual é o mascote oficial do Project Club?', options: ['Rockhopper', 'Pingu', 'Gary', 'Cadence'], answer: 1, ...diff('facil'), reward: { eventCoins: 15 } }),
    ],
    pass: { levels: [{ points: 150, label: 'Nível 1', coins: 100 }, { points: 400, label: 'Nível 2', coins: 200, items: [185] }, { points: 800, label: 'Nível 3', coins: 400, items: [1191] }, { points: 1300, label: 'Nível 4', coins: 800, items: [246] }] },
    shop: [
      { key: 'asas', label: 'Asas de Morcego Roxas', itemIds: [1191], price: 60 },
      { key: 'vampiro', label: 'Capa de Vampiro', itemIds: [3180], price: 90 },
      { key: 'aranha', label: 'Fantasia de Aranha', itemIds: [4138], price: 120 },
      { key: 'bruxa', label: 'Chapéu de Bruxa', itemIds: [1186], price: 70 },
      { key: 'mumia', label: 'Fantasia de Múmia', itemIds: [789], price: 110 },
      { key: 'doces', label: 'Colar de Doces', itemIds: [185], price: 30 },
    ],
    completion: { label: 'Esqueleto completo', items: [246], coins: 500 },
    codes: [{ code: 'DOCEOUTRAVESSURA', label: 'Halloween', coins: 300, eventCoins: 30, items: [1119] }],
  },
  {
    key: 'natal', name: 'Festa de Natal', when: 'dezembro', currencyName: 'Flocos', party: 'Holiday Party',
    quests: [
      q('explorar', 'Tour natalino', 'Visite as salas decoradas.', 'visit', { rooms: TOUR, ...diff('facil'), reward: { eventCoins: 20 } }),
      q('gorro', 'No clima', 'Vista um Gorro de Papai Noel ou de Elfo.', 'wear', { items: [414, 10414, 1206, 447, 1331], ...diff('facil'), reward: { eventCoins: 15 } }),
      q('coral', 'Coral de Natal', 'Junte 10 pinguins na Cafeteria.', 'gather', { rooms: [R.coffee], count: 10, ...diff('dificil'), reward: { eventCoins: 40 } }),
      q('danca', 'Dança do Papai Noel', 'Dance de gorro no Centro, na Praça e na Cabana.', 'dance', { rooms: [R.town, R.plaza, R.lodge], items: [414, 10414, 1206, 447], ...diff('media'), reward: { eventCoins: 30 } }),
      q('rena', 'Passeio da rena', 'Passeie com um puffle até o Pico da Montanha e a Lagoa.', 'walk_puffle', { rooms: [R.mtn, R.berg], ...diff('media'), reward: { eventCoins: 30 } }),
      q('doar', 'Coins for Change', 'Doe 500 moedas.', 'donate', { count: 500, ...diff('media'), reward: { eventCoins: 40 } }),
      q('pingu', 'Pingu Noel', 'Encontre o Pingu numa visita.', 'mascot', { mascot: 'pingu', ...diff('media'), reward: { eventCoins: 30 } }),
      q('ficar', 'Noite feliz', 'Fique 40 minutos na ilha.', 'online', { minutes: 40, ...diff('dificil'), reward: { eventCoins: 40 } }),
    ],
    shop: [
      { key: 'rena', label: 'Chifres de Rena', itemIds: [471], price: 40 },
      { key: 'boneco', label: 'Cabeça de Boneco de Neve', itemIds: [1026], price: 120 },
      { key: 'gingerbread', label: 'Fantasia de Biscoito', itemIds: [4473], price: 150 },
      { key: 'bengala', label: 'Chapéu Bengala Doce', itemIds: [1119], price: 50 },
    ],
    advent: Array.from({ length: 25 }, (_, i) => ({ day: i + 1, coins: i === 24 ? 1000 : [6, 12, 18].includes(i + 1) ? 200 : 50, eventCoins: i % 5 === 4 ? 10 : 0, items: i + 1 === 12 ? [471] : i + 1 === 24 ? [414] : [] })),
    cfc: { goals: [{ amount: 20000, label: 'Meta 1 — 20 mil moedas', items: [629], coins: 100 }, { amount: 50000, label: 'Meta 2 — 50 mil moedas', items: [4042], coins: 250 }, { amount: 100000, label: 'Meta 3 — 100 mil moedas', items: [1105], coins: 500 }] },
    completion: { label: 'Fantasia de Rena', items: [4145], coins: 800 },
    codes: [{ code: 'FELIZNATAL', label: 'Natal', coins: 500, eventCoins: 25, items: [414] }],
  },
  {
    key: 'festival-luzes', name: 'Festival das Luzes (eclipse)', when: 'janeiro', currencyName: 'Luzes', party: null,
    quests: [
      q('explorar', 'Ilha à noite', 'Visite o Farol, o Holofote, a Lagoa e o Pico.', 'visit', { rooms: [R.light, R.beacon, R.berg, R.mtn], ...diff('facil'), reward: { eventCoins: 20 } }),
      q('oculos', 'Olhos protegidos', 'Vista os Óculos 3D pra ver o eclipse.', 'wear', { items: [103], ...diff('facil'), reward: { eventCoins: 15 } }),
      q('farol', 'Vigília no Farol', 'Junte 8 pinguins no Holofote.', 'gather', { rooms: [R.beacon], count: 8, ...diff('dificil'), reward: { eventCoins: 40 } }),
      q('montanhista', 'Montanhista', 'Fique 15 minutos na ilha durante o eclipse.', 'online', { minutes: 15, ...diff('media'), reward: { eventCoins: 25 } }),
      q('mascote', 'Jet Pack Guy', 'Encontre o mascote numa visita.', 'mascot', { mascot: 'jetpackguy', ...diff('media'), reward: { eventCoins: 30 } }),
    ],
    shop: [{ key: 'jetpack', label: 'Jet Pack', itemIds: [567], price: 100 }, { key: 'farol', label: 'Camisa do Farol', itemIds: [282], price: 40 }, { key: 'espaco', label: 'Capacete Espacial', itemIds: [458], price: 90 }],
    completion: { label: 'Jet Pack Dourado', items: [3187], coins: 600 },
    codes: [],
  },
  {
    key: 'puffle', name: 'Festa dos Puffles', when: 'março', currencyName: 'Biscoitos de Puffle', party: 'Puffle Party',
    quests: [
      q('explorar', 'Explorador', 'Visite as salas dos puffles.', 'visit', { rooms: [R.forest, R.cove, R.light, R.beacon, R.box, R.berg, R.mtn, R.dance, R.cave, R.lounge], ...diff('media'), reward: { eventCoins: 30 } }),
      q('azul', 'Puffle azul na Floresta', 'Passeie com um puffle azul até a Floresta.', 'walk_puffle', { puffles: [0], rooms: [R.forest], ...diff('facil'), reward: { eventCoins: 15 } }),
      q('vermelho', 'Puffle vermelho na Enseada', 'Passeie com um puffle vermelho até a Enseada.', 'walk_puffle', { puffles: [5], rooms: [R.cove], ...diff('facil'), reward: { eventCoins: 15 } }),
      q('roxo', 'Puffle roxo na pista', 'Passeie com um puffle roxo até a Danceteria.', 'walk_puffle', { puffles: [4], rooms: [R.dance], ...diff('facil'), reward: { eventCoins: 15 } }),
      q('preto', 'Puffle preto na Caverna', 'Passeie com um puffle preto até a Caverna.', 'walk_puffle', { puffles: [2], rooms: [R.cave], ...diff('media'), reward: { eventCoins: 20 } }),
      q('qualquer', 'Volta da ilha com o puffle', 'Passeie com qualquer puffle pelo Centro, pela Praça e pela Praia.', 'walk_puffle', { rooms: [R.town, R.plaza, R.beach], ...diff('media'), reward: { eventCoins: 25 } }),
      q('chapeu', 'Chapéu de puffle', 'Vista um Chapéu de Puffle.', 'wear', { items: [1225, 11225], ...diff('facil'), reward: { eventCoins: 10 } }),
      q('ph', 'Encontre a PH', 'Encontre a Treinadora de Puffles numa visita.', 'mascot', { mascot: 'ph', ...diff('media'), reward: { eventCoins: 30 } }),
      q('show', 'Show de puffles', 'Junte 10 pinguins no Pet Shop.', 'gather', { rooms: [R.pet], count: 10, ...diff('dificil'), reward: { eventCoins: 40 } }),
    ],
    shop: [{ key: 'chapeu', label: 'Chapéu de Puffle Azul', itemIds: [1225], price: 30 }, { key: 'pelucia', label: 'Pelúcia de Puffle Azul', itemIds: [5194], price: 80 }],
    completion: { label: 'Puffle de estimação (brinde)', items: [1235], coins: 500 },
    codes: [{ code: 'PUFFLEPARTY', label: 'Festa dos Puffles', coins: 200, eventCoins: 20, items: [1225] }],
  },
  {
    key: 'dance-a-thon', name: 'Dance-A-Thon (Music Jam)', when: 'julho', currencyName: 'Notas', party: 'Music Jam 2014',
    quests: [
      q('maratona', 'Maratona de dança', 'Dance com um instrumento no Centro, na Danceteria, no Lounge, na Praça e na Praia.', 'dance', { rooms: [R.town, R.dance, R.lounge, R.plaza, R.beach], items: [5016, 481, 335, 233, 234, 338, 730, 731, 180, 729, 732, 5066], ...diff('dificil'), reward: { eventCoins: 50 } }),
      q('instrumento', 'Afinado', 'Vista qualquer instrumento.', 'wear', { items: [5016, 481, 335, 233, 234, 338, 730, 731, 180, 729, 732, 5066, 340], ...diff('facil'), reward: { eventCoins: 15 } }),
      q('pista', 'Pista lotada', 'Esteja na Danceteria com 15 pinguins.', 'gather', { rooms: [R.dance], count: 15, ...diff('extrema'), reward: { eventCoins: 80 } }),
      q('cadence', 'Encontre a Cadence', 'Encontre a Cadence numa visita.', 'mascot', { mascot: 'cadence', ...diff('media'), reward: { eventCoins: 30 } }),
      q('palco', 'Show no Palco', 'Junte 8 pinguins no Palco.', 'gather', { rooms: [R.stage], count: 8, ...diff('media'), reward: { eventCoins: 30 } }),
    ],
    shop: [{ key: 'boombox', label: 'Boombox', itemIds: [5016], price: 60 }, { key: 'maracas', label: 'Maracas', itemIds: [335], price: 20 }, { key: 'guitarra', label: 'Guitarra Vermelha', itemIds: [233], price: 100 }, { key: 'bateria', label: 'Caixa de Bateria', itemIds: [180], price: 80 }, { key: 'hoodie', label: 'Moletom da Banda', itemIds: [773], price: 120 }],
    completion: { label: 'Microfone Dourado', items: [5160], coins: 700 },
    codes: [{ code: 'MUSICJAM', label: 'Music Jam', coins: 200, eventCoins: 20, items: [335] }],
  },
  {
    key: 'medieval', name: 'Festa Medieval', when: 'setembro', currencyName: 'Moedas de Ouro', party: 'Medieval Party 2013',
    quests: [
      q('explorar', 'Reino explorado', 'Visite as salas do reino.', 'visit', { rooms: TOUR, ...diff('facil'), reward: { eventCoins: 20 } }),
      q('cavaleiro', 'Cavaleiro', 'Vista uma armadura ou elmo de cavaleiro.', 'wear', { items: [668, 794, 1052, 1253, 1688, 1693], ...diff('facil'), reward: { eventCoins: 15 } }),
      q('mago', 'Mago aprendiz', 'Vista um Chapéu de Mago.', 'wear', { items: [443, 1093, 1284, 11093], ...diff('facil'), reward: { eventCoins: 15 } }),
      q('torneio', 'Torneio no Estádio', 'Esteja no Estádio com 20 pinguins vestindo um Tabardo.', 'gather', { rooms: [R.rink], count: 20, ...diff('extrema'), reward: { eventCoins: 80 } }),
      q('magos', 'Conselho dos magos', 'Dance de Chapéu de Mago no Estádio, na Floresta e na Enseada.', 'dance', { rooms: [R.rink, R.forest, R.cove], items: [443, 1093, 1284, 11093], ...diff('dificil'), reward: { eventCoins: 40 } }),
      q('dragao', 'Caça ao dragão', 'Fique 30 minutos na ilha.', 'online', { minutes: 30, ...diff('media'), reward: { eventCoins: 25 } }),
    ],
    shop: [{ key: 'tabardo-azul', label: 'Tabardo Azul', itemIds: [3070], price: 60 }, { key: 'tabardo-vermelho', label: 'Tabardo Vermelho', itemIds: [3068], price: 60 }, { key: 'escudo', label: 'Escudo Verde', itemIds: [723], price: 40 }, { key: 'princesa', label: 'Chapéu de Princesa', itemIds: [487], price: 50 }, { key: 'viking', label: 'Elmo Viking Azul', itemIds: [456], price: 90 }],
    completion: { label: 'Fantasia de Dragão', items: [795], coins: 800 },
    codes: [{ code: 'REINOPINGU', label: 'Medieval', coins: 300, eventCoins: 25, items: [443] }],
  },
  {
    key: 'feira', name: 'A Feira', when: 'fevereiro', currencyName: 'Tickets', party: 'The Fair 2015',
    quests: [
      q('explorar', 'Volta na feira', 'Visite as salas decoradas.', 'visit', { rooms: TOUR, ...diff('facil'), reward: { eventCoins: 20 } }),
      q('palhaco', 'Palhaço', 'Vista algo de palhaço.', 'wear', { items: [247, 354, 474, 1183, 1296], ...diff('facil'), reward: { eventCoins: 15 } }),
      q('bate-bate', 'Bate-bate no Estádio', 'Esteja no Estádio com 30 pinguins.', 'gather', { rooms: [R.rink], count: 30, ...diff('extrema'), reward: { eventCoins: 100 } }),
      q('algodao', 'Algodão doce', 'Vista o Algodão Doce.', 'wear', { items: [350, 649, 5004], ...diff('facil'), reward: { eventCoins: 10 } }),
      q('rockhopper', 'Encontre o Rockhopper', 'Encontre o Rockhopper numa visita.', 'mascot', { mascot: 'rockhopper', ...diff('media'), reward: { eventCoins: 30 } }),
      q('balao', 'Balões', 'Dance com um balão no Centro, na Praça e no Estádio.', 'dance', { rooms: [R.town, R.plaza, R.rink], items: [554, 621, 1176], ...diff('media'), reward: { eventCoins: 30 } }),
    ],
    shop: [{ key: 'balao', label: 'Balão', itemIds: [554], price: 15 }, { key: 'algodao', label: 'Algodão Doce', itemIds: [350], price: 20 }, { key: 'pirulito', label: 'Pirulito', itemIds: [336], price: 15 }, { key: 'palhaco', label: 'Peruca de Palhaço', itemIds: [1183], price: 60 }, { key: 'balonista', label: 'O Balonista', itemIds: [1303], price: 120 }],
    completion: { label: 'Fantasia de Palhaço', items: [247], coins: 600 },
    codes: [],
  },
  {
    key: 'copa', name: 'Copa dos Pinguins', when: 'junho', currencyName: 'Gols', party: 'Penguin Cup',
    quests: [
      q('camisa', 'Vestiu a camisa', 'Vista uma camisa de futebol.', 'wear', { items: [775, 778, 10775, 1879], ...diff('facil'), reward: { eventCoins: 15 } }),
      q('torcida', 'Torcida organizada', 'Esteja no Estádio com 15 pinguins.', 'gather', { rooms: [R.rink], count: 15, ...diff('dificil'), reward: { eventCoins: 50 } }),
      q('comemoracao', 'Comemoração', 'Dance de camisa no Estádio, no Centro e na Praça.', 'dance', { rooms: [R.rink, R.town, R.plaza], items: [775, 778, 10775], ...diff('media'), reward: { eventCoins: 30 } }),
      q('brasil', 'Verde e amarelo', 'Vista a bandeira do Brasil.', 'wear', { items: [505], ...diff('facil'), reward: { eventCoins: 10 } }),
      q('prorrogacao', 'Prorrogação', 'Fique 45 minutos na ilha.', 'online', { minutes: 45, ...diff('dificil'), reward: { eventCoins: 40 } }),
    ],
    shop: [{ key: 'bandeira', label: 'Bandeira do Brasil', itemIds: [505], price: 10 }, { key: 'camisa', label: 'Camisa Vermelha', itemIds: [775], price: 50 }, { key: 'bola', label: 'Bola de Futebol', itemIds: [561], price: 30 }, { key: 'juiz', label: 'Camisa de Juiz', itemIds: [722], price: 60 }],
    completion: { label: 'Craque', items: [1879], coins: 700 },
    codes: [{ code: 'VAIBRASIL', label: 'Copa', coins: 300, eventCoins: 20, items: [505] }],
  },
  {
    key: 'aniversario', name: 'Aniversário do Project Club', when: 'data do aniversário', currencyName: 'Fatias de Bolo', party: null,
    quests: [
      q('chapeu', 'Chapéu de festa', 'Vista um Chapéu de Festa.', 'wear', { items: [413, 430, 444, 1019, 1098, 1192], ...diff('facil'), reward: { eventCoins: 15 } }),
      q('bolo', 'Bolo na Cafeteria', 'Junte 10 pinguins na Cafeteria.', 'gather', { rooms: [R.coffee], count: 10, ...diff('media'), reward: { eventCoins: 30 } }),
      q('tour', 'Tour da ilha', 'Visite as salas principais.', 'visit', { rooms: TOUR, ...diff('facil'), reward: { eventCoins: 20 } }),
      q('equipe', 'Encontre a equipe', 'Encontre o Pingu numa visita.', 'mascot', { mascot: 'pingu', ...diff('media'), reward: { eventCoins: 30 } }),
      q('festa', 'Festa na Danceteria', 'Dance de chapéu de festa na Danceteria, no Centro e na Praça.', 'dance', { rooms: [R.dance, R.town, R.plaza], items: [413, 430, 444, 1019, 1098, 1192], ...diff('media'), reward: { eventCoins: 30 } }),
      // trivia com TourBots pela ilha (modelo do aniversário do CP Journey)
      q('bot1', 'TourBot do Centro', 'Fale com o TourBot no Centro.', 'trivia', { rooms: [R.town], question: 'Em que ano o Club Penguin original abriu?', options: ['2003', '2005', '2007', '2010'], answer: 1, ...diff('facil'), reward: { eventCoins: 10 } }),
      q('bot2', 'TourBot da Praça', 'Fale com o TourBot na Praça.', 'trivia', { rooms: [R.plaza], question: 'Qual puffle gosta de pizza e de dormir?', options: ['Azul', 'Vermelho', 'Preto', 'Amarelo'], answer: 0, ...diff('facil'), reward: { eventCoins: 10 } }),
      q('bot3', 'TourBot do Dojo', 'Fale com o TourBot no Dojo.', 'trivia', { rooms: [R.dojo], question: 'Quem ensina Card-Jitsu no Dojo?', options: ['Rookie', 'Gary', 'Sensei', 'Herbert'], answer: 2, ...diff('facil'), reward: { eventCoins: 10 } }),
      q('bot4', 'TourBot da Praia', 'Fale com o TourBot na Praia.', 'trivia', { rooms: [R.beach], question: 'Qual navio atraca na Praia?', options: ['Titanic', 'Migrator', 'Pérola Negra', 'Barco do Herbert'], answer: 1, ...diff('facil'), reward: { eventCoins: 10 } }),
      q('bot5', 'TourBot do Project Club', 'Fale com o TourBot na Cafeteria.', 'trivia', { rooms: [R.coffee], question: 'Como se chama a IA do Project Club?', options: ['Robbie', 'Pingu', 'Jade', 'Glance'], answer: 1, ...diff('media'), reward: { eventCoins: 20 } }),
    ],
    shopMax: 3,
    shop: [{ key: 'chapeu', label: 'Chapéu de Festa', seller: 'Rockhopper', itemIds: [413], price: 20 }, { key: 'lei', label: 'Colar Havaiano', seller: 'Aunt Arctic', itemIds: [171], price: 25 }, { key: 'oculos', label: 'Óculos 3D', seller: 'Jet Pack Guy', itemIds: [103], price: 30 }, { key: 'balao', label: 'Balão (até 3)', seller: 'Rockhopper', itemIds: [554], price: 5, limit: 3 }],
    completion: { label: 'Chapéu do 1º Ano', items: [444], coins: 1000 },
    codes: [{ code: 'PARABENSPC', label: 'Aniversário', coins: 1000, eventCoins: 30, items: [413] }],
  },
  {
    key: 'marcos', name: 'Marcos da comunidade (só códigos)', when: 'quando bater a meta', currencyName: 'Fichas', party: null,
    quests: [], shop: [], completion: null,
    codes: [
      { code: '100MEMBROS', label: '100 membros', coins: 100, items: [171] },
      { code: '1000MEMBROS', label: '1.000 membros', coins: 1000, items: [413, 171] },
      { code: '10KMEMBROS', label: '10 mil membros', coins: 10000, items: [444, 5160] },
    ],
  },
  {
    key: 'pins-semanais', name: 'Pin da semana (rodízio)', when: 'o ano todo', currencyName: 'Fichas', party: null,
    quests: [],
    // a cada 7 dias entra o próximo pin ORIGINAL do jogo, escondido numa sala (modelo do pin semanal do CP Journey/Legacy/NewCP/CPZ)
    rotation: { everyDays: 7, label: 'Pin da semana', quests: [
      q('pin-trevo', 'Pin Trevo', 'Ache o pin escondido na Cafeteria.', 'visit', { rooms: [R.coffee], hint: 'Onde o café esquenta a manhã.', reward: { items: [550], coins: 20 } }),
      q('pin-nota', 'Pin Nota Musical', 'Ache o pin escondido na Pizzaria.', 'visit', { rooms: [R.pizza], hint: 'Com cheiro de mussarela.', reward: { items: [551], coins: 20 } }),
      q('pin-planta', 'Pin Planta', 'Ache o pin escondido no Lounge.', 'visit', { rooms: [R.lounge], hint: 'Em cima da pista de dança.', reward: { items: [552], coins: 20 } }),
      q('pin-pizza', 'Pin Fatia de Pizza', 'Ache o pin escondido na Praça.', 'visit', { rooms: [R.plaza], hint: 'Entre o Palco e o Pet Shop.', reward: { items: [553], coins: 20 } }),
      q('pin-balao', 'Pin Balão', 'Ache o pin escondido no Cais.', 'visit', { rooms: [R.dock], hint: 'Onde os barcos descansam.', reward: { items: [554], coins: 20 } }),
      q('pin-lanterna', 'Pin Lanterna de Mineiro', 'Ache o pin escondido na Danceteria.', 'visit', { rooms: [R.dance], hint: 'Luzes, música e um DJ.', reward: { items: [555], coins: 20 } }),
      q('pin-bola', 'Pin Bola de Praia', 'Ache o pin escondido no Sótão da Cabana.', 'visit', { rooms: [R.attic], hint: 'Subindo a escada da Cabana.', reward: { items: [556], coins: 20 } }),
      q('pin-sol', 'Pin Sol', 'Ache o pin escondido na Biblioteca.', 'visit', { rooms: [R.book], hint: 'Em cima da Cafeteria, entre livros.', reward: { items: [557], coins: 20 } }),
      q('pin-ferradura', 'Pin Ferradura', 'Ache o pin escondido na Cabana da Mina.', 'visit', { rooms: [R.shack], hint: 'Antes de descer pra Mina.', reward: { items: [558], coins: 20 } }),
      q('pin-nave', 'Pin Nave do Astro-Barrier', 'Ache o pin escondido nos Fortes de Neve.', 'visit', { rooms: [R.forts], hint: 'Onde as bolas de neve voam.', reward: { items: [559], coins: 20 } }),
      q('pin-taco', 'Pin Taco de Hóquei', 'Ache o pin escondido na Vila de Esqui.', 'visit', { rooms: [R.village], hint: 'Perto do teleférico.', reward: { items: [560], coins: 20 } }),
      q('pin-farol', 'Pin Farol', 'Ache o pin escondido no Farol.', 'visit', { rooms: [R.light], hint: 'Onde o Migrator avista a ilha.', reward: { items: [563], coins: 20 } }),
    ] },
    shop: [], completion: null, codes: [],
  },
  {
    key: 'carimbos', name: 'Carimbos da festa (Explorer, Construção, Festa Maestro…)', when: 'junto com qualquer festa', currencyName: 'Fichas', party: null,
    // quests inspiradas nos stamps de festa do CP Legacy — a staff cola num evento
    quests: [
      q('explorer', 'Explorer', 'Visite todas as salas decoradas.', 'visit', { rooms: TOUR, ...diff('media'), reward: { eventCoins: 30 } }),
      q('construcao', 'Construção', 'Vista o Capacete de Obra na Caldeira.', 'dance', { rooms: [R.boiler], items: [403], frames: [26], ...diff('media'), reward: { eventCoins: 25 } }),
      q('sala-feliz', 'Sala feliz', 'Junte 10 pinguins numa sala.', 'gather', { count: 10, ...diff('media'), reward: { eventCoins: 25 } }),
      q('maestro', 'Festa Maestro', 'Dance com 15 pinguins na Danceteria.', 'gather', { rooms: [R.dance], count: 15, ...diff('dificil'), reward: { eventCoins: 40 } }),
      q('celebracao', 'Celebração', 'Fique 60 minutos na ilha durante a festa.', 'online', { minutes: 60, ...diff('dificil'), reward: { eventCoins: 40 } }),
      q('passeio', 'Passeio com o puffle', 'Leve um puffle pra 5 salas.', 'walk_puffle', { rooms: [R.town, R.plaza, R.forts, R.beach, R.village], ...diff('media'), reward: { eventCoins: 30 } }),
    ],
    shop: [], completion: { label: 'Livro de carimbos completo', coins: 500 }, codes: [],
  },
  {
    key: 'pizza', name: 'Pizza Palooza', when: 'qualquer', currencyName: 'Fatias', party: null,
    quests: [
      q('pizzaria', 'Noite da pizza', 'Junte 8 pinguins na Pizzaria.', 'gather', { rooms: [R.pizza], count: 8, ...diff('media'), reward: { eventCoins: 30 } }),
      q('chef', 'Chef', 'Vista um avental ou chapéu de chef.', 'wear', { items: [24034], ...diff('facil'), reward: { eventCoins: 15 } }),
      q('entrega', 'Entrega', 'Visite a Pizzaria, o Centro, a Praça e a Praia.', 'visit', { rooms: [R.pizza, R.town, R.plaza, R.beach], ...diff('facil'), reward: { eventCoins: 20 } }),
    ],
    shop: [{ key: 'avental', label: 'Avental de Pizza do Caveguin', itemIds: [24034], price: 40 }],
    completion: { label: 'Bônus do pizzaiolo', coins: 400 },
    codes: [],
  },
];

/** Corpo do evento pronto pra salvar (saveEvent), a partir de um modelo. */
function build(key, { year = new Date().getFullYear(), days = 14 } = {}) {
  const p = PRESETS.find((x) => x.key === key);
  if (!p) return null;
  const start = new Date(); const end = new Date(Date.now() + days * 86400000);
  return {
    slug: `${p.key}-${year}`, name: p.name, currencyName: p.currencyName, party: p.party, startsAt: start.toISOString(), endsAt: end.toISOString(), active: true,
    config: { quests: p.quests, shop: p.shop, shopMax: p.shopMax || 0, advent: p.advent || [], cfc: p.cfc || null, completion: p.completion || null, pass: p.pass || null, rotation: p.rotation || null },
    codes: p.codes || [],
  };
}

function list() {
  return PRESETS.map((p) => ({ key: p.key, name: p.name, when: p.when, currencyName: p.currencyName, quests: p.quests.length + (p.rotation ? p.rotation.quests.length : 0), shop: p.shop.length, codes: (p.codes || []).length, advent: !!(p.advent && p.advent.length), cfc: !!p.cfc, pass: !!p.pass, rotation: !!p.rotation }));
}

module.exports = { PRESETS, build, list };
