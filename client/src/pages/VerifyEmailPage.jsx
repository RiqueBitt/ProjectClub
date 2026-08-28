import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { confirmVerificationCode, sendVerificationCode } from '../api/endpoints';
import { useAuth } from '../context/AuthContext.jsx';

export default function VerifyEmailPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  // This screen is no longer skippable (see ProtectedRoute in App.jsx), so a
  // user landing here with an already-verified account (e.g. an old
  // bookmark, or right after confirming) would otherwise have no way out —
  // send them straight into the app instead.
  useEffect(() => {
    if (user?.emailVerified) navigate('/', { replace: true });
  }, [user, navigate]);

  const [code, setCode] = useState('');
  const [message, setMessage] = useState('Enviamos um código de 6 dígitos para o seu e-mail.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await confirmVerificationCode(code);
      await refreshUser();
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Código inválido.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    await sendVerificationCode();
    setMessage('Um novo código foi enviado.');
  };

  return (
    <AuthLayout title="Verifique seu e-mail" subtitle={message}>
      <form onSubmit={onSubmit} className="auth-form">
        <label>
          CÓDIGO DE VERIFICAÇÃO
          <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} autoFocus />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Verificando...' : 'Verificar'}</button>
        <button type="button" className="btn-link" onClick={resend}>Reenviar código</button>
      </form>
    </AuthLayout>
  );
}
