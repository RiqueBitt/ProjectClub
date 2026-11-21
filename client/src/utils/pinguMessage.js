// Pingu Turbo: ajudantes puros pras mensagens do Pingu no chat.
// - pinguStreaming: o servidor manda a mensagem enquanto a IA ainda está
//   escrevendo (message:new / message:update com pinguStreaming: true); a
//   versão final chega sem a marca.
// - Imagem do Pingu: mensagem do @pingu com anexo de imagem → selo
//   "Criada pelo Pingu" e botão de baixar.

export const PINGU_USERNAME = 'pingu';

export const isPinguAuthor = (message) => String(message?.author?.username || '').toLowerCase() === PINGU_USERNAME;

export const isPinguStreaming = (message) => !!message?.pinguStreaming;

/** Anexos de imagem criados pelo Pingu (vazio se a mensagem não for dele). */
export function pinguImageAttachments(message) {
  if (!isPinguAuthor(message)) return [];
  return (message.attachments || []).filter((a) => String(a?.mimeType || '').startsWith('image/'));
}

/** Nome do arquivo pra baixar (sem caminho e sem caractere estranho). */
export function downloadName(attachment) {
  const raw = String(attachment?.filename || attachment?.url || 'pingu.png').split('/').pop().split('?')[0];
  return raw.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'pingu.png';
}

/** Comandos agrupados (vêm de GET /api/pingu/help). */
export function groupCommands(commands = []) {
  const groups = [];
  const byName = new Map();
  for (const c of commands) {
    if (!c?.cmd) continue;
    const name = c.group || 'Outros';
    if (!byName.has(name)) { const g = { name, items: [] }; byName.set(name, g); groups.push(g); }
    byName.get(name).items.push(c);
  }
  return groups;
}
