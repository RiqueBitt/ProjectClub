import { useEffect } from 'react';

// Com o navegador do Project Club desligado (utils/features.js), os apps de
// computador que já vinham com ele (v1.3+) ainda mandam os links externos
// para uma "aba" (evento browser:open-tab). Sem o navegador montado, esses
// links abrem no navegador padrão do sistema — nenhum link se perde.
export function DesktopLinkFallback() {
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    const b = api?.browser;
    if (!b?.on || !api?.openExternal) return undefined;
    const off = b.on('open-tab', ({ url } = {}) => {
      if (/^https?:\/\//i.test(String(url || ''))) api.openExternal(url);
    });
    return () => { if (typeof off === 'function') off(); };
  }, []);
  return null;
}
