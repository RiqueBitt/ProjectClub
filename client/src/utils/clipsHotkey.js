// Atalho dos Clipes (Fase 7): transforma a tecla apertada na tela de
// Configurações no formato de atalho do app de PC ("Alt+F10") e de volta
// num texto bonito ("Alt + F10"). As mesmas regras do app de PC
// (desktop/clipsCore.js normalizeAccelerator): tecla de função vale
// sozinha; o resto precisa de Ctrl/Alt/Win (Shift sozinho não, senão
// viraria "letra maiúscula" em todo programa).

const NAMED = {
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete',
  PrintScreen: 'PrintScreen', Space: 'Space',
};

export function acceleratorFromEvent(e) {
  const code = String(e?.code || '');
  if (!code || /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/.test(code)) return null;
  let key = null;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^Numpad[0-9]$/.test(code)) key = `num${code.slice(6)}`;
  else if (NAMED[code]) key = NAMED[code];
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const isFn = /^F\d+$/.test(key);
  if (!isFn && (mods.length === 0 || (mods.length === 1 && mods[0] === 'Shift'))) return null;
  return [...mods, key].join('+');
}

export function prettyAccelerator(acc) {
  if (!acc) return '';
  return String(acc).split('+').map((p) => {
    if (p === 'CommandOrControl') return 'Ctrl';
    if (p === 'Super') return 'Win';
    if (/^num\d$/.test(p)) return `Num ${p.slice(3)}`;
    return p;
  }).join(' + ');
}
