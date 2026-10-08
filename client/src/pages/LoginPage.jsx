import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { AuthField, PasswordField, AuthAlert, SubmitButton, apiError } from '../components/auth/AuthFields.jsx';
import { MailIcon, LockIcon, ShieldIcon } from '../components/auth/AuthIcons.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ emailOrUsername: '', password: '', twoFactorCode: '' });
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const codeRef = useRef(null);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const result = await login({
        emailOrUsername: form.emailOrUsername.trim(),
        password: form.password,
        twoFactorCode: form.twoFactorCode.replace(/\s/g, ''),
      });
      if (result.requiresTwoFactor) {
        setNeedsTwoFactor(true);
        setTimeout(() => codeRef.current?.focus(), 0);
      } else {
        // Pedido anterior: depois de entrar, abrir na página de Início.
        navigate('/inicio', { replace: true });
      }
    } catch (err) {
      setError(apiError(err, 'Não foi possível entrar. Confira seus dados e tente de novo.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={needsTwoFactor ? 'Confirme que é você' : 'Bem-vindo de volta'}
      subtitle={needsTwoFactor
        ? 'Digite o código de 6 dígitos do seu app autenticador.'
        : 'Entre com seu e-mail ou ClubTag.'}
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

        {needsTwoFactor && (
          <AuthField
            label="Código de verificação" icon={ShieldIcon} name="twoFactorCode" inputRef={codeRef}
            value={form.twoFactorCode} onChange={onChange} required
            inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7}
            placeholder="000 000" className="pc-code-input"
          />
        )}

        <AuthAlert>{error}</AuthAlert>

        <SubmitButton busy={busy} busyLabel="Entrando…" disabled={busy || !form.emailOrUsername || !form.password}>
          {needsTwoFactor ? 'Confirmar e entrar' : 'Entrar'}
        </SubmitButton>

        {needsTwoFactor && (
          <button
            type="button" className="pc-btn pc-btn-ghost"
            onClick={() => { setNeedsTwoFactor(false); setForm((f) => ({ ...f, twoFactorCode: '' })); setError(''); }}
          >
            Usar outra conta
          </button>
        )}
      </form>
    </AuthLayout>
  );
}
