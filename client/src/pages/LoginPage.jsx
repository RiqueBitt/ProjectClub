import { afterLogin } from '../utils/accountSwitch';
import { isCancel, loginWithPasskey, passkeysSupported } from '../utils/passkeys';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { completeOAuth2FA } from '../api/endpoints';
import { AuthField, PasswordField, AuthAlert, SubmitButton, apiError } from '../components/auth/AuthFields.jsx';
import { MailIcon, LockIcon, ShieldIcon } from '../components/auth/AuthIcons.jsx';
import { useReaction } from '../components/auth/AuthCharacters.jsx';
import OAuthButtons, { oauthErrorMessage, PROVIDER_META } from '../components/auth/OAuthButtons.jsx';
import QrLoginPanel from '../components/auth/QrLoginPanel.jsx';
import AppealPanel from '../components/auth/AppealPanel.jsx';

// Conta desativada/banida/suspensa: o servidor responde 403 com um flag
// (accountDisabled / platformBanned / suspendedUntil) — vira um aviso
// destacado com título, em vez de um erro genérico de "não foi possível
// entrar" que parece senha errada.
function accountNoticeFrom(err) {
  const data = err?.response?.status === 403 ? err.response.data : null;
  if (!data) return null;
  if (data.accountDisabled) return { title: 'Conta desativada', text: data.error };
  if (data.platformBanned) {
    return { title: 'Conta banida', text: data.reason ? `${data.error} Motivo: ${data.reason}` : data.error };
  }
  if (data.suspendedUntil) return { title: 'Conta suspensa', text: data.error };
  return null;
}

const OAUTH_BLOCK_TITLES = { banida: 'Conta banida', suspensa: 'Conta suspensa', desativada: 'Conta desativada' };

// Para onde ir depois de entrar: só caminhos internos conhecidos (hoje, só a
// tela de aprovar o "Entrar com o celular") — nada de redirecionamento
// aberto pra outro site.
const AFTER_LOGIN_KEY = 'pc-after-login';
function takeAfterLoginPath() {
  try {
    const p = sessionStorage.getItem(AFTER_LOGIN_KEY);
    sessionStorage.removeItem(AFTER_LOGIN_KEY);
    if (typeof p === 'string' && /^\/entrar-qr\?c=[A-Za-z0-9_-]{43}$/.test(p)) return p;
  } catch { /* sem sessionStorage */ }
  return '/inicio';
}

// "Entrar com o celular" é pra quem está no computador: no celular (site
// ou app) o botão não aparece.
const isPhone = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
// Tempo do pulinho de comemoração antes de abrir o app.
const SUCCESS_DELAY_MS = 950;

export default function LoginPage() {
  const { login, applySession, user, loading } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState({ emailOrUsername: '', password: '', twoFactorCode: '', recoveryCode: '' });
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  // 2FA depois de entrar com Google/Discord/GitHub (sem senha na tela).
  const [oauth2FA, setOauth2FA] = useState(null);
  // Perdeu o celular? Entra com um dos códigos de recuperação de uso único.
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [oauthArriving, setOauthArriving] = useState(false);
  // Fase 5: login por QR Code e pedido de revisão de punição.
  const [qrMode, setQrMode] = useState(false);
  const [appealToken, setAppealToken] = useState(null);
  const [reaction, react] = useReaction();
  const codeRef = useRef(null);
  const leavingRef = useRef(false);

  // Comemora e entra (pulinho dos bonequinhos antes de trocar de tela).
  const celebrateAndGo = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    react('success');
    const to = takeAfterLoginPath();
    setTimeout(() => navigate(to, { replace: true }), SUCCESS_DELAY_MS);
  };

  const fail = (msg, accountNotice = null) => {
    if (accountNotice) setNotice(accountNotice);
    else setError(msg);
    react('error');
  };
  // Conta banida/suspensa com a senha certa: o servidor manda um token
  // curto que só serve pra pedir a revisão (ver server/src/services/appeals.js).
  const rememberAppeal = (err) => {
    const token = err?.response?.status === 403 ? err.response.data?.appealToken : null;
    setAppealToken(typeof token === 'string' ? token : null);
  };

  // Volta do provedor: ?oauth_error=… | ?oauth_2fa=… | ?oauth=ok
  useEffect(() => {
    const code = params.get('oauth_error');
    const provider = params.get('provider') || params.get('oauth_2fa') || '';
    if (code) {
      if (OAUTH_BLOCK_TITLES[code]) fail('', { title: OAUTH_BLOCK_TITLES[code], text: oauthErrorMessage(code, provider) });
      else fail(oauthErrorMessage(code, provider));
    } else if (params.get('oauth_2fa')) {
      setOauth2FA(provider);
      setNeedsTwoFactor(true);
      setTimeout(() => codeRef.current?.focus(), 0);
    } else if (params.get('oauth') === 'ok') {
      setOauthArriving(true);
    }
    if (code || params.get('oauth_2fa') || params.get('oauth')) setParams({}, { replace: true });
    // Só na chegada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?oauth=ok: a sessão já foi criada no servidor (cookie) — o AuthContext
  // restaura sozinho; quando o usuário aparecer, comemora e entra.
  useEffect(() => {
    if (!oauthArriving || loading) return;
    if (user) celebrateAndGo();
    else { setOauthArriving(false); fail('Não foi possível concluir o login. Tente de novo.'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthArriving, loading, user]);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const codePayload = () => (useRecovery
    ? { recoveryCode: form.recoveryCode.trim() }
    : { twoFactorCode: form.twoFactorCode.replace(/\s/g, '') });

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy || leavingRef.current) return;
    setError('');
    setNotice(null);
    setAppealToken(null);
    setBusy(true);
    try {
      if (oauth2FA) {
        const data = await completeOAuth2FA(codePayload());
        applySession(data);
        afterLogin(data.user);
        celebrateAndGo();
        return;
      }
      const payload = {
        emailOrUsername: form.emailOrUsername.trim(),
        password: form.password,
        ...(needsTwoFactor ? codePayload() : {}),
      };
      const result = await login(payload);
      if (result.requiresTwoFactor) {
        setNeedsTwoFactor(true);
        setTimeout(() => codeRef.current?.focus(), 0);
      } else {
        // Pedido anterior: depois de entrar, abrir na página de Início.
        celebrateAndGo();
      }
    } catch (err) {
      if (oauth2FA && err?.response?.data?.expired) {
        setOauth2FA(null); setNeedsTwoFactor(false);
      }
      rememberAppeal(err);
      fail(apiError(err, 'Não foi possível entrar. Confira seus dados e tente de novo.'), accountNoticeFrom(err));
    } finally {
      setBusy(false);
    }
  };

  // Chave de acesso (digital/rosto/PIN): sem senha e sem 2FA.
  const passkeyLogin = async () => {
    if (busy) return;
    setError(''); setNotice(null); setBusy(true);
    try {
      const data = await loginWithPasskey();
      applySession(data);
      afterLogin(data.user);
      celebrateAndGo();
    } catch (err) {
      if (!isCancel(err)) {
        rememberAppeal(err);
        fail(apiError(err, 'Não deu pra entrar com a chave de acesso.'), accountNoticeFrom(err));
      }
    } finally { setBusy(false); }
  };

  const toggleRecovery = () => {
    setUseRecovery((v) => !v);
    setError('');
    setForm((f) => ({ ...f, twoFactorCode: '', recoveryCode: '' }));
    setTimeout(() => codeRef.current?.focus(), 0);
  };

  let subtitle = 'Entre com seu e-mail ou ClubTag.';
  if (needsTwoFactor) {
    subtitle = useRecovery
      ? 'Digite um dos seus códigos de recuperação (cada um só funciona uma vez).'
      : 'Digite o código de 6 dígitos do seu app autenticador.';
    if (oauth2FA) subtitle = `Você entrou com ${PROVIDER_META[oauth2FA]?.label || 'o provedor'}. ${subtitle}`;
  }
  if (oauthArriving) subtitle = 'Conectando sua conta…';

  // Celular aprovou: a resposta é a mesma de um login normal.
  const onQrDone = (data) => {
    applySession(data);
    afterLogin(data.user);
    celebrateAndGo();
  };

  if (qrMode) {
    return (
      <AuthLayout
        title="Entrar com o celular"
        subtitle="Use o celular onde você já está logado para entrar aqui, sem digitar a senha."
        footer={<>Ainda não é membro? <Link to="/register">Fazer inscrição</Link></>}
        reaction={reaction}
      >
        <QrLoginPanel onDone={onQrDone} onCancel={() => setQrMode(false)} />
      </AuthLayout>
    );
  }

  const canSubmit = oauth2FA
    ? !!(useRecovery ? form.recoveryCode.trim() : form.twoFactorCode.trim())
    : !!(form.emailOrUsername && form.password);

  return (
    <AuthLayout
      title={needsTwoFactor ? 'Confirme que é você' : 'Bem-vindo de volta'}
      subtitle={subtitle}
      footer={<>Ainda não é membro? <Link to="/register">Fazer inscrição</Link></>}
      reaction={reaction}
    >
      <form onSubmit={onSubmit} className="pc-form" noValidate>
        <div className={needsTwoFactor ? 'pc-collapsed' : undefined}>
          <AuthField
            label="E-mail ou ClubTag" icon={MailIcon} name="emailOrUsername"
            value={form.emailOrUsername} onChange={onChange} required autoFocus={!oauthArriving}
            autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            inputMode="email" placeholder="voce@exemplo.com"
          />
        </div>
        <div className={needsTwoFactor ? 'pc-collapsed' : undefined}>
          <PasswordField
            icon={LockIcon} name="password" value={form.password} onChange={onChange}
            required autoComplete="current-password" placeholder="Sua senha"
          />
          <Link to="/forgot-password" className="pc-inline-link">Esqueci minha senha</Link>
        </div>

        {needsTwoFactor && !useRecovery && (
          <AuthField
            label="Código de verificação" icon={ShieldIcon} name="twoFactorCode" inputRef={codeRef}
            value={form.twoFactorCode} onChange={onChange} required
            inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7}
            placeholder="000 000" className="pc-code-input"
          />
        )}
        {needsTwoFactor && useRecovery && (
          <AuthField
            label="Código de recuperação" icon={ShieldIcon} name="recoveryCode" inputRef={codeRef}
            value={form.recoveryCode} onChange={onChange} required
            autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={14}
            placeholder="xxxxx-xxxxx"
          />
        )}
        {needsTwoFactor && (
          <button type="button" className="pc-text-btn" onClick={toggleRecovery}>
            {useRecovery ? 'Usar o código do app autenticador' : 'Perdeu o acesso ao app? Usar código de recuperação'}
          </button>
        )}

        {notice && (
          <div className="pc-account-notice" role="alert">
            <strong>{notice.title}</strong>
            <p>{notice.text}</p>
            {appealToken && <AppealPanel token={appealToken} />}
          </div>
        )}
        <AuthAlert>{error}</AuthAlert>

        <SubmitButton busy={busy || oauthArriving} busyLabel="Entrando…" disabled={busy || oauthArriving || !canSubmit}>
          {needsTwoFactor ? 'Confirmar e entrar' : 'Entrar'}
        </SubmitButton>

        {needsTwoFactor && (
          <button
            type="button" className="pc-btn pc-btn-ghost"
            onClick={() => {
              setNeedsTwoFactor(false); setUseRecovery(false); setOauth2FA(null);
              setForm((f) => ({ ...f, twoFactorCode: '', recoveryCode: '' })); setError('');
            }}
          >
            Usar outra conta
          </button>
        )}

        {!needsTwoFactor && passkeysSupported() && (
          <button type="button" className="btn-secondary auth-passkey-btn" disabled={busy || oauthArriving} onClick={passkeyLogin}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="8" cy="9" r="4" /><path d="M2 21v-1a6 6 0 0 1 10-4.5M15 13l6 6M18 16l2-2M16.5 17.5l1.5-1.5" /></svg>
            Entrar com chave de acesso
          </button>
        )}
        {!needsTwoFactor && !isPhone() && (
          <button type="button" className="btn-secondary auth-passkey-btn" disabled={busy || oauthArriving} onClick={() => { setError(''); setNotice(null); setQrMode(true); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></svg>
            Entrar com o celular
          </button>
        )}
        {!needsTwoFactor && <OAuthButtons from="login" verb="Entrar com" position="bottom" disabled={busy || oauthArriving} />}
      </form>
    </AuthLayout>
  );
}
