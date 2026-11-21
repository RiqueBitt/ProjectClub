"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleIgnore = exports.handleGetABTests = exports.handleGetActionStatus = exports.handleGetComMessages = void 0;
const epf_com_1 = require("../../game-logic/epf-com.js");
/** f#epfgm: mensagens da EPF no telefone espião (as 10 mais novas). */
const handleGetComMessages = ({ msg, penguin }) => {
    const list = (0, epf_com_1.getComMessages)().slice(-10).map(epf_com_1.comString);
    msg.send(penguin, 'epfgm', 0, ...list);
};
exports.handleGetComMessages = handleGetComMessages;
/**
 * nx#gas: o jogador já dançou / acenou / jogou a bola de neve especial?
 * (sem isso o botão das ações especiais fica piscando como se fosse novato)
 */
const handleGetActionStatus = ({ msg, penguin }) => {
    msg.send(penguin, 'gas', 1, 1, 1);
};
exports.handleGetActionStatus = handleGetActionStatus;
/** u#gabcms: testes A/B do jogo — nenhum ligado. */
const handleGetABTests = ({ msg, penguin }) => {
    msg.send(penguin, 'gabcms', '{}');
};
exports.handleGetABTests = handleGetABTests;
/** Só avisos do cliente (sala carregada, mapa aberto, estatísticas): nada a responder. */
const handleIgnore = () => { };
exports.handleIgnore = handleIgnore;
