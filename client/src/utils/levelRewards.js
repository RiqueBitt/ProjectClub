// Item pedido: "aba extra chamada de recompensas... mostra todas as
// recompensas adquiridas ao atingir níveis específicos como o 10
// liberando a opção de criar um Clube" — catálogo mantido aqui, do
// lado do cliente, porque cada recompensa de verdade corresponde a uma
// trava de nível já existente no CÓDIGO de alguma funcionalidade (ex:
// clanController.js recusa criar clube abaixo do nível 10) — não é um
// catálogo "livre" editável pela staff feito só de dados (diferente de
// Badges/Pingentes): toda vez que uma recompensa nova for adicionada
// de verdade, alguém mexe nessa trava no backend TAMBÉM, então faz
// sentido documentar as duas juntas aqui — sem fingir que dá pra
// "criar uma recompensa nova" só cadastrando ela numa tela, sem
// nenhuma trava de verdade acompanhando.
export const LEVEL_REWARDS = [
  {
    level: 10,
    icon: '🏛️',
    title: 'Criar um Clube',
    description: 'Ao atingir o nível 10, você pode criar e liderar o seu próprio clube dentro da comunidade.',
  },
];
