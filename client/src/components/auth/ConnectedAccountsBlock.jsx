import { useEffect, useState } from 'react';
import { listOAuthAccounts, linkOAuthAccount, unlinkOAuthAccount } from '../../api/endpoints';
import { PROVIDER_META, isDesktopApp, isAndroidApp, oauthErrorMessage } from './OAuthButtons.jsx';

// Resultado da volta do provedor (ver pages/OAuthReturnPage.jsx). Vale
// por um minuto (o app pode demorar a abrir e montar as Configurações mais
// de uma vez) e depois é descartado.
export const OAUTH_LINK_RESULT_KEY = 'pc-oauth-link-result';
export const OAUTH_RETURN_TTL_MS = 60 * 1000;
function takeLinkResult() {
  try {
    const raw = sessionStorage.getItem(OAUTH_LINK_RESULT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.at || Date.now() - data.at > OAUTH_RETURN_TTL_MS) {
      sessionStorage.removeItem(OAUTH_LINK_RESULT_KEY);
      return null;
    }
    return data;
  } catch { return null; }
}

// Configurações → Segurança → "Contas conectadas": conectar/desconectar
// Google, Discord e GitHub pra entrar sem digitar a senha.
export default function ConnectedAccountsBlock() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = () => listOAuthAccounts()
    .then((d) => setData({ accounts: d?.accounts || [], providers: d?.providers || [] }))
    .catch((err) => {
      // Servidor ainda sem a rota (deploy antigo): o bloco só some.
      if (err?.response?.status === 404) setData({ accounts: [], providers: [] });
      else setError('Não foi possível carregar suas contas conectadas.');
    });

  useEffect(() => {
    const result = takeLinkResult();
    if (result?.ok) setNotice({ tone: 'ok', text: `${PROVIDER_META[result.provider]?.label || 'Conta'} conectada. Agora dá pra entrar com ela na tela de login.` });
    else if (result?.code) setNotice({ tone: 'error', text: oauthErrorMessage(result.code, result.provider) });
    load();
  }, []);

  if (isAndroidApp()) return null;
  if (data && data.providers.length === 0) return null;

  const connect = async (id) => {
    setBusy(id); setError(''); setNotice(null);
    try {
      const { url } = await linkOAuthAccount(id);
      window.location.assign(url);
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível começar a conexão. Tente de novo.');
      setBusy(null);
    }
  };

  const disconnect = async (id) => {
    setBusy(id); setError(''); setNotice(null);
    try {
      await unlinkOAuthAccount(id);
      setNotice({ tone: 'ok', text: `${PROVIDER_META[id]?.label} desconectado.` });
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível desconectar. Tente de novo.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="settings-block" data-testid="connected-accounts">
      <h4>Contas conectadas</h4>
      <p className="dim">Entre no Project Club com sua conta Google, Discord ou GitHub, sem digitar a senha. Sua senha continua funcionando.</p>
      {notice && <div className={notice.tone === 'ok' ? 'settings-field-ok' : 'auth-error'} role="status">{notice.text}</div>}
      {error && <div className="auth-error" role="alert">{error}</div>}
      {!data && !error && <p className="dim">Carregando…</p>}
      {data && (
        <div className="sessions-list">
          {data.providers.map((p) => {
            const meta = PROVIDER_META[p.id];
            if (!meta) return null;
            const linked = data.accounts.find((a) => a.provider === p.id);
            // Google não abre dentro do app desktop (ver OAuthButtons).
            const canConnect = p.enabled && !(p.id === 'google' && isDesktopApp());
            if (!linked && !canConnect) return null;
            const { Mark } = meta;
            return (
              <div key={p.id} className="session-row">
                <span className="settings-row-icon" aria-hidden="true"><Mark width={18} height={18} /></span>
                <div className="session-row-info">
                  <div>{meta.label}</div>
                  <div className="dim">
                    {linked
                      ? `Conectada${linked.email ? ` (${linked.email})` : ''} em ${new Date(linked.createdAt).toLocaleDateString('pt-BR')}`
                      : 'Não conectada'}
                  </div>
                </div>
                {linked ? (
                  <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => disconnect(p.id)}>
                    {busy === p.id ? '...' : 'Desconectar'}
                  </button>
                ) : (
                  <button type="button" className="btn-primary" disabled={!!busy} onClick={() => connect(p.id)}>
                    {busy === p.id ? 'Abrindo…' : 'Conectar'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
