// Comandos que o cliente de 2016 manda e o Waddle Forever não tratava
// (achados pelo registro de "XT sem tratamento").
import { PenguinHandler } from "./handlers";
import { comString, getComMessages } from "@server/game-logic/epf-com";

/** f#epfgm: mensagens da EPF no telefone espião (as 10 mais novas). */
export const handleGetComMessages: PenguinHandler<[]> = ({ msg, penguin }) => {
  const list = getComMessages().slice(-10).map(comString);
  msg.send(penguin, 'epfgm', 0, ...list);
}

/**
 * nx#gas: o jogador já dançou / acenou / jogou a bola de neve especial?
 * (sem isso o botão das ações especiais fica piscando como se fosse novato)
 */
export const handleGetActionStatus: PenguinHandler<[]> = ({ msg, penguin }) => {
  msg.send(penguin, 'gas', 1, 1, 1);
}

/** u#gabcms: testes A/B do jogo — nenhum ligado. */
export const handleGetABTests: PenguinHandler<[]> = ({ msg, penguin }) => {
  msg.send(penguin, 'gabcms', '{}');
}

/** Só avisos do cliente (sala carregada, mapa aberto, estatísticas): nada a responder. */
export const handleIgnore: PenguinHandler<string[]> = () => {}
