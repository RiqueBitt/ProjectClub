import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { resetPassword } from '../api/endpoints';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await resetPassword(token, password);
      navigate('/login');
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível redefinir a senha.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Redefinir senha" footer={<Link to="/login">Voltar para o login</Link>}>
      <form onSubmit={onSubmit} className="auth-form">
        <label>
          NOVA SENHA
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button type="submit" className="btn-primary" disabled={busy || !token}>{busy ? 'Salvando...' : 'Redefinir senha'}</button>
      </form>
    </AuthLayout>
  );
}
