// Banco inicial do Quiz do Pingu. Só entra quando o banco está vazio
// (services/pingu/quiz.js → ensureSeed); depois a equipe edita no Painel
// (Pingu → Quiz). `answers`: respostas aceitas (sem ligar pra acento nem
// maiúsculas); a primeira é a que aparece quando o tempo acaba.
const QUIZ_BANK = [
  { category: 'Project Club', question: 'Quantos dias seguidos abrindo o baú diário liberam o Mega Baú?', answers: ['5', 'cinco'] },
  { category: 'Project Club', question: 'Qual é o nome do launcher de Minecraft do Project Club?', answers: ['ProjectMC', 'Project MC'] },
  { category: 'Project Club', question: 'Como se chama o editor de áudio do Project Club?', answers: ['WaveProject', 'Wave Project'] },
  { category: 'Project Club', question: 'Qual é o nome do jogo de cartas colecionáveis do Project Club?', answers: ['Guerra das Cartas'] },
  { category: 'Geografia', question: 'Qual é a capital do Brasil?', answers: ['Brasília', 'Brasilia'] },
  { category: 'Geografia', question: 'Qual é o maior estado brasileiro em área?', answers: ['Amazonas', 'AM'] },
  { category: 'Geografia', question: 'Qual é o maior oceano do planeta?', answers: ['Pacífico', 'Oceano Pacífico'] },
  { category: 'Geografia', question: 'Em qual estado fica a cidade de Ouro Preto?', answers: ['Minas Gerais', 'MG'] },
  { category: 'Ciências', question: 'Qual planeta é conhecido como planeta vermelho?', answers: ['Marte'] },
  { category: 'Ciências', question: 'Qual é o símbolo químico do ouro?', answers: ['Au'] },
  { category: 'Ciências', question: 'Quantos ossos tem o corpo humano adulto?', answers: ['206', 'duzentos e seis'] },
  { category: 'Ciências', question: 'Qual gás as plantas absorvem do ar para fazer fotossíntese?', answers: ['Gás carbônico', 'CO2', 'Dióxido de carbono'] },
  { category: 'Matemática', question: 'Quanto é 7 vezes 8?', answers: ['56', 'cinquenta e seis'] },
  { category: 'Matemática', question: 'Quantos lados tem um hexágono?', answers: ['6', 'seis'] },
  { category: 'História', question: 'Em que ano foi proclamada a independência do Brasil?', answers: ['1822'] },
  { category: 'História', question: 'Quem pintou a Mona Lisa?', answers: ['Leonardo da Vinci', 'Da Vinci', 'Leonardo'] },
  { category: 'Games', question: 'Qual é o nome do encanador mais famoso da Nintendo?', answers: ['Mario', 'Super Mario'] },
  { category: 'Games', question: 'Em Minecraft, qual mob verde explode perto do jogador?', answers: ['Creeper'] },
  { category: 'Games', question: 'Qual é o nome do ouriço azul da Sega?', answers: ['Sonic'] },
  { category: 'Games', question: 'Em Minecraft, qual material é preciso para fazer um portal para o Nether?', answers: ['Obsidiana', 'Obsidian'] },
  { category: 'Cultura', question: 'Qual é o animal símbolo do Pingu?', answers: ['Pinguim'] },
  { category: 'Cultura', question: 'Quantas cores tem o arco-íris?', answers: ['7', 'sete'] },
  { category: 'Esportes', question: 'Quantas Copas do Mundo de futebol masculino o Brasil já ganhou?', answers: ['5', 'cinco'] },
  { category: 'Esportes', question: 'Quantos jogadores de cada time ficam em campo numa partida de futebol?', answers: ['11', 'onze'] },
];

module.exports = { QUIZ_BANK };
