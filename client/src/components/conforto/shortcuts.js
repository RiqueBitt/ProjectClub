// Atalhos de teclado do Project Club — fonte única pra tela "Atalhos"
// (Ctrl+/ ou ?) e pros atalhos globais novos (useGlobalShortcuts.js).
//
// `existing: true` = atalho que já existia em outro lugar do app (só
// listado aqui; quem trata é o componente citado em `where`).
// Sem dependência de React/DOM: testado em client/test/conforto.test.mjs.

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
export const MOD = IS_MAC ? '⌘' : 'Ctrl';

export const SHORTCUT_GROUPS = [
  {
    id: 'nav',
    title: 'Navegação',
    items: [
      { id: 'quickSwitcher', keys: ['Mod', 'K'], label: 'Buscar e pular para canais, conversas e páginas', existing: true, where: 'QuickSwitcher' },
      { id: 'prevChannel', keys: ['Alt', '↑'], label: 'Canal anterior da lista' },
      { id: 'nextChannel', keys: ['Alt', '↓'], label: 'Próximo canal da lista' },
      { id: 'prevUnread', keys: ['Alt', 'Shift', '↑'], label: 'Canal não lido anterior' },
      { id: 'nextUnread', keys: ['Alt', 'Shift', '↓'], label: 'Próximo canal não lido' },
      { id: 'historyBack', keys: ['Alt', '←'], label: 'Voltar (app para computador)', existing: true, where: 'AppearanceRuntime', desktopOnly: true },
      { id: 'historyForward', keys: ['Alt', '→'], label: 'Avançar (app para computador)', existing: true, where: 'AppearanceRuntime', desktopOnly: true },
    ],
  },
  {
    id: 'chat',
    title: 'Conversa',
    items: [
      { id: 'send', keys: ['Enter'], label: 'Enviar mensagem', existing: true, where: 'RichMessageInput' },
      { id: 'newline', keys: ['Shift', 'Enter'], label: 'Quebrar linha sem enviar', existing: true, where: 'RichMessageInput' },
      { id: 'editLast', keys: ['↑'], label: 'Editar sua última mensagem (com o campo vazio)', existing: true, where: 'ChatWindow' },
      { id: 'chatSearch', keys: ['Mod', 'F'], label: 'Buscar nesta conversa', existing: true, where: 'ChatWindow' },
      { id: 'markRead', keys: ['Esc'], label: 'Marcar o canal aberto como lido' },
      { id: 'cancelReply', keys: ['Esc'], label: 'Cancelar resposta ou fechar menus', existing: true, where: 'ChatWindow' },
    ],
  },
  {
    id: 'voice',
    title: 'Voz',
    items: [
      { id: 'toggleMute', keys: ['Mod', 'Shift', 'M'], label: 'Ligar/desligar o microfone' },
      { id: 'toggleDeafen', keys: ['Mod', 'Shift', 'D'], label: 'Ensurdecer / voltar a ouvir' },
      { id: 'pushToTalk', keys: ['PTT'], label: 'Apertar para falar (se ligado em Configurações → Voz)', existing: true, where: 'VoiceContext' },
    ],
  },
  {
    id: 'app',
    title: 'Aplicativo',
    items: [
      { id: 'shortcuts', keys: ['Mod', '/'], label: 'Mostrar esta lista de atalhos', alt: ['?'] },
      { id: 'focusMode', keys: ['Mod', 'Shift', 'F'], label: 'Modo foco (esconde as colunas laterais)', existing: true, where: 'AppearanceRuntime' },
      { id: 'closeFocus', keys: ['Esc'], label: 'Sair do modo foco', existing: true, where: 'AppearanceRuntime' },
    ],
  },
];

// Texto de cada tecla na tela (Mod vira Ctrl ou ⌘).
export function keyLabel(k, { mac = IS_MAC, pttKey = 'Space' } = {}) {
  if (k === 'Mod') return mac ? '⌘' : 'Ctrl';
  if (k === 'PTT') return codeLabel(pttKey);
  return k;
}
export function codeLabel(code) {
  if (!code) return 'Espaço';
  if (code === 'Space') return 'Espaço';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

const isMod = (e, mac = IS_MAC) => (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

export function isEditableTarget(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'INPUT') {
    const type = String(el.type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}

// Qual ação um keydown dispara (null = nenhuma das NOSSAS). Só cobre os
// atalhos novos; os que já existiam continuam com os donos de antes.
export function matchShortcut(e, { mac = IS_MAC } = {}) {
  if (!e || e.isComposing) return null;
  const key = e.key;
  const lower = typeof key === 'string' ? key.toLowerCase() : '';
  const editable = isEditableTarget(e.target);
  // Ctrl+/ (ou ⌘/) — em qualquer lugar. "?" — só fora de campo de texto.
  if (isMod(e, mac) && !e.altKey && (key === '/' || e.code === 'Slash') && !e.shiftKey) return 'shortcuts';
  if (key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !editable) return 'shortcuts';
  // Ctrl+Shift+M / Ctrl+Shift+D (sem Alt).
  if (isMod(e, mac) && e.shiftKey && !e.altKey) {
    if (lower === 'm' || e.code === 'KeyM') return 'toggleMute';
    if (lower === 'd' || e.code === 'KeyD') return 'toggleDeafen';
  }
  // Alt+↑/↓ (com Shift = só não lidos). Nunca com Ctrl/⌘.
  if (e.altKey && !e.ctrlKey && !e.metaKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
    const dir = key === 'ArrowUp' ? -1 : 1;
    if (e.shiftKey) return dir < 0 ? 'prevUnread' : 'nextUnread';
    return dir < 0 ? 'prevChannel' : 'nextChannel';
  }
  if (key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) return 'markRead';
  return null;
}

// Próximo item numa lista circular a partir do ativo (ou do começo).
export function stepIndex(length, current, dir) {
  if (!length) return -1;
  if (current < 0) return dir > 0 ? 0 : length - 1;
  return (current + dir + length) % length;
}

// Próximo item que satisfaz `pred`, andando na direção `dir` a partir de
// `current` (sem incluir o próprio). -1 se nenhum.
export function findFrom(items, current, dir, pred) {
  const n = items.length;
  for (let i = 1; i <= n; i += 1) {
    const idx = ((current < 0 ? (dir > 0 ? -1 : n) : current) + dir * i + n * 2) % n;
    if (idx === current) break;
    if (pred(items[idx], idx)) return idx;
  }
  return -1;
}
