import { useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { OAUTH_LINK_RESULT_KEY } from '../components/auth/ConnectedAccountsBlock.jsx';

// Volta do provedor depois de "Conectar" em Configurações → Segurança
// (/oauth/retorno?vinculado=… ou ?erro=…&provedor=…): guarda o resultado,
// pede pras Configurações abrirem em Segurança e segue pro app.
export default function OAuthReturnPage() {
  const [params] = useSearchParams();
  useEffect(() => {
    const linked = params.get('vinculado');
    const result = linked
      ? { ok: true, provider: linked, at: Date.now() }
      : { ok: false, code: params.get('erro') || 'falha', provider: params.get('provedor') || '', at: Date.now() };
    try {
      sessionStorage.setItem(OAUTH_LINK_RESULT_KEY, JSON.stringify(result));
      sessionStorage.setItem('pc-settings-open-tab', JSON.stringify({ tab: 'SECURITY', at: Date.now() }));
    } catch { /* sem sessionStorage: só não reabre na aba certa */ }
    useStore.getState().openSettings?.();
  }, [params]);
  return <Navigate to="/inicio" replace />;
}
