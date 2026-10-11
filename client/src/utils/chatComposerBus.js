// Ponte pequena entre o compositor do chat (ChatWindow) e cada mensagem
// (Message), sem passar props por várias camadas:
//  - Seta pra cima no compositor vazio abre a edição da sua última mensagem.
//  - Mensagem que falhou ao enviar guarda aqui como "tentar de novo".
//  - Rascunho por canal/conversa (localStorage).

const editors = new Map(); // messageId -> abre a edição
export function registerEditor(id, fn) {
  editors.set(id, fn);
  return () => { if (editors.get(id) === fn) editors.delete(id); };
}
export function requestEdit(id) {
  const fn = editors.get(id);
  if (!fn) return false;
  fn();
  return true;
}

const retries = new Map(); // id da mensagem otimista -> reenviar
export function setRetry(id, fn) {
  if (retries.size > 200) retries.clear();
  retries.set(id, fn);
}
export function getRetry(id) { return retries.get(id) || null; }
export function clearRetry(id) { retries.delete(id); }

const DRAFT_PREFIX = 'chat-draft:';
export function loadDraft(roomKey) {
  if (!roomKey) return '';
  try { return localStorage.getItem(DRAFT_PREFIX + roomKey) || ''; } catch { return ''; }
}
export function saveDraft(roomKey, text) {
  if (!roomKey) return;
  try {
    if (text && text.trim()) localStorage.setItem(DRAFT_PREFIX + roomKey, String(text).slice(0, 4000));
    else localStorage.removeItem(DRAFT_PREFIX + roomKey);
  } catch { /* sem storage */ }
}
