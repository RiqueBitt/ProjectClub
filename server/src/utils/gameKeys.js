// Funções puras do tempo de jogo, sem banco nem Redis (services/gamePlaytime
// usa e reexporta; o Game Hub importa daqui pra rodar nos testes sem nada).

// Nome -> chave estável ("Counter-Strike 2" -> "counter-strike-2").
function gameKeyFor(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// Dia "AAAA-MM-DD" no fuso de Brasília.
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
function dayKey(ms) { return DAY_FMT.format(new Date(ms)); }

module.exports = { gameKeyFor, dayKey };
