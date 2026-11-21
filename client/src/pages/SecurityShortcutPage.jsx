import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useStore } from '../store/useStore';

// /seguranca/sessoes — destino do "Não fui eu" no aviso de novo acesso
// (Fase 5). Abre Configurações → Segurança já na lista de "Dispositivos
// conectados" e volta pro Início por trás (mesmo jeito do OAuthReturnPage).
export default function SecurityShortcutPage() {
  useEffect(() => {
    try {
      sessionStorage.setItem('pc-settings-open-tab', JSON.stringify({ tab: 'SECURITY', at: Date.now() }));
      sessionStorage.setItem('pc-settings-focus', 'sessions');
    } catch { /* sem sessionStorage: abre as Configurações mesmo assim */ }
    useStore.getState().openSettings?.();
  }, []);
  return <Navigate to="/inicio" replace />;
}
