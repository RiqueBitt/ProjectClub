"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanComText = cleanComText;
exports.getComMessages = getComMessages;
exports.setComMessages = setComMessages;
exports.comString = comString;
const T0 = Math.floor(Date.UTC(2026, 10, 1) / 1000);
let messages = [
    { message: 'Bem-vindo à Força Elite dos Pinguins, agente. Fique de olho na ilha.', time: T0, mascot: 18 },
    { message: 'Atividade estranha perto do Farol. Investigue quando puder.', time: T0 + 3600, mascot: 25 },
    { message: 'Bom trabalho nas últimas missões. A EPF conta com você!', time: T0 + 7200, mascot: 16 },
];
function cleanComText(text) {
    return String(text ?? '').replace(/[%|\r\n]+/g, ' ').trim().slice(0, 300);
}
function getComMessages() {
    return messages;
}
function setComMessages(list) {
    messages = (Array.isArray(list) ? list : [])
        .map((m) => ({ message: cleanComText(m.message), time: Math.floor(Number(m.time)) || 0, mascot: Math.floor(Number(m.mascot)) || 1 }))
        .filter((m) => m.message.length > 0)
        .sort((a, b) => a.time - b.time)
        .slice(-50);
}
function comString(m) {
    return [cleanComText(m.message), m.time, m.mascot].join('|');
}
