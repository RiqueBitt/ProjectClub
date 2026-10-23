import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { confirmVerificationCode, sendVerificationCode } from '../api/endpoints';
import { useAuth } from '../context/AuthContext.jsx';
import { AuthField, AuthAlert, SubmitButton, apiError } from '../components/auth/AuthFields.jsx';
import { ShieldIcon } from '../components/auth/AuthIcons.jsx';

const RESEND_COOLDOWN = 30;

export default function VerifyEmailPage() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();

  // Esta tela não pode ser pulada (ProtectedRoute em App.jsx); conta já
  // verificada (favorito antigo, ou logo depois de confirmar) vai direto
  // pro app.
  useEffect(() => {
    if (user?.emailVerified) navigate('/', { replace: true });
  }, [user, navigate]);

  const [code, setCode] = useState('');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (code.length !== 6) { setError('O código tem 6 dígitos.'); return; }
    setError('');
    setBusy(true);
    try {
      await confirmVerificationCode(code);
      await refreshUser();
      navigate('/', { replace: true });
    } catch (err) {
      setError(apiError(err, 'Código inválido ou expirado.'));
    } finally {
      setBusy(false);
    }
  };

  // Antes, uma falha aqui virava um erro não tratado e a tela não dizia nada.
  const resend = async () => {
    setError('');
    setInfo('');
    try {
      await sendVerificationCode();
      setInfo('Enviamos um código novo.');
      setCooldown(RESEND_COOLDOWN);
    } catch (err) {
      setError(apiError(err, 'Não foi possível reenviar o código agora.'));
    }
  };

  return (
    <AuthLayout
      title="Verifique seu e-mail"
      subtitle={user?.email ? `Enviamos um código de 6 dígitos para ${user.email}.` : 'Enviamos um código de 6 dígitos para o seu e-mail.'}
    >
      <form onSubmit={onSubmit} className="pc-form" noValidate>
        <AuthField
          label="Código de verificação" icon={ShieldIcon} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000"
          className="pc-code-input" autoFocus
        />
        <AuthAlert>{error}</AuthAlert>
        <AuthAlert tone="info">{info}</AuthAlert>
        <SubmitButton busy={busy} busyLabel="Verificando…" disabled={busy || code.length !== 6}>Verificar</SubmitButton>
        <div className="pc-row-between">
          <button type="button" className="pc-text-btn" onClick={resend} disabled={cooldown > 0}>
            {cooldown > 0 ? `Reenviar em ${cooldown}s` : 'Reenviar código'}
          </button>
          {logout && (
            <button type="button" className="pc-text-btn" onClick={async () => { await logout(); navigate('/login', { replace: true }); }}>
              Sair
            </button>
          )}
        </div>
      </form>
    </AuthLayout>
  );
}
