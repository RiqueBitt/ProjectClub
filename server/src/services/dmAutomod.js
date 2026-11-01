// Automod de DMs — diferente do automod de canais (services/automod.js,
// que age sozinho com regras configuráveis de warn/timeout/ban). Aqui são
// dois mecanismos bem separados por propósito:
//
// 1) BLOQUEIO (invite links): a mensagem NUNCA chega a ser enviada — o
//    remetente recebe um erro na hora, sem precisar de revisão da staff,
//    porque a regra é objetiva (é um link de convite ou não é).
//
// 2) SINALIZAÇÃO (palavrão): a mensagem É enviada normalmente — quem
//    manda e quem recebe não percebem nada diferente — mas fica um
//    registro pendente (model AutomodFlag) pra staff revisar depois e
//    decidir se banir/silenciar/não fazer nada.
//
// Lista de palavras é curta de propósito — o objetivo aqui é o MECANISMO
// funcionando; staff pode pedir pra expandir a lista depois.
const FLAGGED_WORDS = [
  'bosta', 'merda', 'porra', 'caralho', 'desgraça', 'puta', 'viado',
  'idiota', 'imbecil', 'retardado', 'vadia', 'vagabunda',
];

// Convites de outras plataformas — Discord (nomeado explicitamente pelo
// usuário) + outros padrões comuns de link de convite/grupo.
const INVITE_PATTERNS = [
  /discord\.gg\/\S+/i,
  /discord\.com\/invite\/\S+/i,
  /chat\.whatsapp\.com\/\S+/i,
  /t\.me\/\S+/i,
  /telegram\.me\/\S+/i,
];

function containsInviteLink(content) {
  if (!content) return false;
  return INVITE_PATTERNS.some((re) => re.test(content));
}

// Retorna a primeira palavra sinalizada encontrada (com limite de palavra
// \b pra não pegar um pedaço parecido no meio de outra palavra) e um
// trecho de contexto ao redor dela, pra staff ver na lista sem precisar
// abrir a conversa inteira.
function checkFlaggedWord(content) {
  if (!content) return null;
  for (const word of FLAGGED_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    const match = content.match(re);
    if (match) {
      const idx = match.index;
      const start = Math.max(0, idx - 40);
      const end = Math.min(content.length, idx + word.length + 40);
      const snippet = (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '');
      return { matchedWord: word, snippet };
    }
  }
  return null;
}

module.exports = { containsInviteLink, checkFlaggedWord };
