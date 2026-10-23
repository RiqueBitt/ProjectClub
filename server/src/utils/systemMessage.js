// Mensagens do sistema no chat ("Fulano fixou uma mensagem.").
// Não existe coluna de tipo em Message: a marca fica no JSON do embed
// ({ system: 'pin', ... }). O `description` deixa clientes que ainda não
// conhecem o tipo (ex.: app Android) mostrarem o texto como um embed comum.
function buildPinSystemEmbed({ actorName, targetId }) {
  const name = String(actorName || 'Alguém').slice(0, 80);
  return JSON.stringify({ system: 'pin', targetId: String(targetId), description: `📌 ${name} fixou uma mensagem neste canal.` });
}

function parseSystemEmbed(embed) {
  if (!embed || typeof embed !== 'string' || !embed.includes('"system"')) return null;
  try {
    const data = JSON.parse(embed);
    return data && typeof data.system === 'string' ? data : null;
  } catch { return null; }
}

function isSystemMessage(m) {
  return !!parseSystemEmbed(m?.embed);
}

module.exports = { buildPinSystemEmbed, parseSystemEmbed, isSystemMessage };
