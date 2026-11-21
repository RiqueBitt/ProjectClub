/**
 * Mensagens da EPF (telefone espião → "Mensagens"). O site (painel da staff)
 * troca a lista com setComMessages; o jogo só lê.
 */
export type ComMessage = {
  /** texto (sem % e |, que quebram o pacote) */
  message: string
  /** segundos (unix) */
  time: number
  /** avatar no telefone: 1 Rockhopper, 2 Tia Ártica, 3 Cadence, 9 Sensei, 10 Herbert, 11-14 robôs, 15 Dot, 16 Rookie, 17 Jet Pack Guy, 18 Diretor, 19 Klutzy, 25 Gary, 28 PH */
  mascot: number
};

const T0 = Math.floor(Date.UTC(2026, 10, 1) / 1000);
let messages: ComMessage[] = [
  { message: 'Bem-vindo à Força Elite dos Pinguins, agente. Fique de olho na ilha.', time: T0, mascot: 18 },
  { message: 'Atividade estranha perto do Farol. Investigue quando puder.', time: T0 + 3600, mascot: 25 },
  { message: 'Bom trabalho nas últimas missões. A EPF conta com você!', time: T0 + 7200, mascot: 16 },
];

export function cleanComText(text: string): string {
  return String(text ?? '').replace(/[%|\r\n]+/g, ' ').trim().slice(0, 300);
}

export function getComMessages(): ComMessage[] {
  return messages;
}

export function setComMessages(list: ComMessage[]): void {
  messages = (Array.isArray(list) ? list : [])
    .map((m) => ({ message: cleanComText(m.message), time: Math.floor(Number(m.time)) || 0, mascot: Math.floor(Number(m.mascot)) || 1 }))
    .filter((m) => m.message.length > 0)
    .sort((a, b) => a.time - b.time)
    .slice(-50);
}

export function comString(m: ComMessage): string {
  return [cleanComText(m.message), m.time, m.mascot].join('|');
}
