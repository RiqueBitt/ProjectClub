import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { forgotPassword } from '../api/endpoints';
import { AuthField, SubmitButton, AuthAlert } from '../components/auth/AuthFields.jsx';
import { MailIcon, CheckIcon } from '../components/auth/AuthIcons.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) { setError('Digite um e-mail válido.'); return; }
    setError('');
    setBusy(true);
    // A resposta é sempre a mesma (existindo conta ou não), pra não
    // revelar quais e-mails estão cadastrados. Só queda de rede vira erro.
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      if (!err?.response) setError('Sem conexão com o servidor. Verifique sua internet e tente de novo.');
      else setSent(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={sent ? 'Confira seu e-mail' : 'Esqueceu sua senha?'}
      subtitle={sent ? null : 'Informe o e-mail da conta e enviaremos um link para criar uma senha nova.'}
      footer={<Link to="/login">Voltar para o login</Link>}
    >
      {sent ? (
        <div className="pc-success">
          <span className="pc-success-badge"><CheckIcon width={28} height={28} /></span>
          <p>Se existir uma conta com <b>{email.trim()}</b>, o link de redefinição já está a caminho.</p>
          <p className="pc-muted">O link expira em pouco tempo. Não chegou? Confira o spam ou tente de novo.</p>
          <button type="button" className="pc-btn pc-btn-ghost" onClick={() => setSent(false)}>Enviar de novo</button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="pc-form" noValidate>
          <AuthField
            label="E-mail" icon={MailIcon} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false}
            placeholder="voce@exemplo.com" autoFocus required
          />
          <AuthAlert>{error}</AuthAlert>
          <SubmitButton busy={busy} busyLabel="Enviando…">Enviar link</SubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}
