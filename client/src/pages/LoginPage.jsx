import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { AuthField, PasswordField, AuthAlert, SubmitButton, apiError } from '../components/auth/AuthFields.jsx';
import { MailIcon, LockIcon, ShieldIcon } from '../components/auth/AuthIcons.jsx';

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

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ emailOrUsername: '', password: '', twoFactorCode: '', recoveryCode: '' });
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  // Perdeu o celular? Entra com um dos códigos de recuperação de uso único.
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef(null);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setNotice(null);
    setBusy(true);
    try {
      const payload = {
        emailOrUsername: form.emailOrUsername.trim(),
        password: form.password,
      };
      if (needsTwoFactor) {
        if (useRecovery) payload.recoveryCode = form.recoveryCode.trim();
        else payload.twoFactorCode = form.twoFactorCode.replace(/\s/g, '');
      }
      const result = await login(payload);
      if (result.requiresTwoFactor) {
        setNeedsTwoFactor(true);
        setTimeout(() => codeRef.current?.focus(), 0);
      } else {
        // Pedido anterior: depois de entrar, abrir na página de Início.
        navigate('/inicio', { replace: true });
      }
    } catch (err) {
      const accountNotice = accountNoticeFrom(err);
      if (accountNotice) setNotice(accountNotice);
      else setError(apiError(err, 'Não foi possível entrar. Confira seus dados e tente de novo.'));
    } finally {
      setBusy(false);
    }
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
  }

  return (
    <AuthLayout
      title={needsTwoFactor ? 'Confirme que é você' : 'Bem-vindo de volta'}
      subtitle={subtitle}
      footer={<>Ainda não é membro? <Link to="/register">Fazer inscrição</Link></>}
    >
      <form onSubmit={onSubmit} className="pc-form" noValidate>
        <div className={needsTwoFactor ? 'pc-collapsed' : undefined}>
          <AuthField
            label="E-mail ou ClubTag" icon={MailIcon} name="emailOrUsername"
            value={form.emailOrUsername} onChange={onChange} required autoFocus
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
          </div>
        )}
        <AuthAlert>{error}</AuthAlert>

        <SubmitButton busy={busy} busyLabel="Entrando…" disabled={busy || !form.emailOrUsername || !form.password}>
          {needsTwoFactor ? 'Confirmar e entrar' : 'Entrar'}
        </SubmitButton>

        {needsTwoFactor && (
          <button
            type="button" className="pc-btn pc-btn-ghost"
            onClick={() => {
              setNeedsTwoFactor(false); setUseRecovery(false);
              setForm((f) => ({ ...f, twoFactorCode: '', recoveryCode: '' })); setError('');
            }}
          >
            Usar outra conta
          </button>
        )}
      </form>
    </AuthLayout>
  );
}
