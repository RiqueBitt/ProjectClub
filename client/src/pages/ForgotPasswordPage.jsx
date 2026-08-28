import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { forgotPassword } from '../api/endpoints';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    await forgotPassword(email).catch(() => {});
    setBusy(false);
    setSent(true);
  };

  return (
    <AuthLayout
      title="Esqueceu sua senha?"
      subtitle="Informe seu e-mail e enviaremos um link para redefinir sua senha."
      footer={<Link to="/login">Voltar para o login</Link>}
    >
      {sent ? (
        <p>Se existir uma conta com esse e-mail, um link de redefinição foi enviado.</p>
      ) : (
        <form onSubmit={onSubmit} className="auth-form">
          <label>
            E-MAIL
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Enviando...' : 'Enviar link'}</button>
        </form>
      )}
    </AuthLayout>
  );
}
