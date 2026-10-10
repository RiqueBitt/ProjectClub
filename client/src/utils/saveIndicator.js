// Indicador "Salvando… / Salvo" das Configurações (salvamento automático).
// trackSave(promessa) registra um salvamento; useSaveStatus() devolve
// 'idle' | 'saving' | 'saved' | 'error' pra mostrar na tela.
import { useEffect, useState } from 'react';

let pending = 0;
let status = 'idle';
let hideTimer = null;
const listeners = new Set();

function emit(next) {
  status = next;
  listeners.forEach((fn) => fn(status));
}

export function trackSave(promise) {
  pending += 1;
  clearTimeout(hideTimer);
  emit('saving');
  Promise.resolve(promise).then(
    () => {
      pending -= 1;
      if (pending === 0) {
        emit('saved');
        hideTimer = setTimeout(() => emit('idle'), 2200);
      }
    },
    () => {
      pending -= 1;
      emit('error');
      hideTimer = setTimeout(() => { if (pending === 0) emit('idle'); }, 4000);
    },
  );
  return promise;
}

export function useSaveStatus() {
  const [value, setValue] = useState(status);
  useEffect(() => {
    listeners.add(setValue);
    return () => { listeners.delete(setValue); };
  }, []);
  return value;
}
