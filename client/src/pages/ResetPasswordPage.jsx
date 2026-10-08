import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { resetPassword } from '../api/endpoints';
import {
  PasswordField, PasswordRules, isPasswordValid, AuthAlert, SubmitButton, apiError,
} from '../components/auth/AuthFields.jsx';
import { LockIcon, CheckIcon } from '../components/auth/AuthIcons.jsx';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!isPasswordValid(password)) { setError('A senha ainda não cumpre os requisitos.'); return; }
    if (password !== confirm) { setError('As senhas não são iguais.'); return; }
    setError('');
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (err) {
      setError(apiError(err, 'Não foi possível redefinir a senha. O link pode ter expirado.'));
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout title="Link inválido" footer={<Link to="/login">Voltar para o login</Link>}>
        <AuthAlert>Este link de redefinição está incompleto ou expirou. Peça um novo para continuar.</AuthAlert>
        <Link to="/forgot-password" className="pc-btn pc-btn-primary">Pedir um link novo</Link>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title="Senha alterada" footer={<Link to="/login">Ir para o login</Link>}>
        <div className="pc-success">
          <span className="pc-success-badge"><CheckIcon width={28} height={28} /></span>
          <p>Sua senha nova já está valendo. Levando você para o login…</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Criar senha nova" subtitle="Escolha uma senha que você não usa em outros sites." footer={<Link to="/login">Voltar para o login</Link>}>
      <form onSubmit={onSubmit} className="pc-form" noValidate>
        <PasswordField
          label="Nova senha" icon={LockIcon} value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password" autoFocus required
        />
        <PasswordField
          label="Confirmar senha" icon={LockIcon} value={confirm} onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password" required
        />
        <PasswordRules value={password} />
        <AuthAlert>{error}</AuthAlert>
        <SubmitButton busy={busy} busyLabel="Salvando…">Salvar senha nova</SubmitButton>
      </form>
    </AuthLayout>
  );
}
