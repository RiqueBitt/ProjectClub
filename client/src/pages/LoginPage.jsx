import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import IconGlyph from '../components/IconGlyph.jsx';
import emailIcon from '../assets/icons/email.png';
import lockIcon from '../assets/icons/lock.png';
import shieldIcon from '../assets/icons/shield.png';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ emailOrUsername: '', password: '', twoFactorCode: '' });
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Mostrar a senha ao passar o mouse em cima (desktop) ou segurar o
  // dedo (celular) — nunca fica "travado" visível, só enquanto a pessoa
  // mantém o cursor/dedo no botão do olho.
  const [showPassword, setShowPassword] = useState(false);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  // Item pedido: verificação de "não sou um robô" removida do login —
  // entra direto, sem nenhum desafio no meio do caminho.
  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await login({ ...form });
      if (result.requiresTwoFactor) {
        setNeedsTwoFactor(true);
      } else {
        // Item pedido: "quando abrir o app, abra na página de Início"
        // — mudei só o redirecionamento pós-login (cenário mais direto
        // de "abrir o app"), sem reestruturar a rota raiz "/" em si
        // (usada em dezenas de outros lugares esperando ir pro
        // Chat/Comunidade — mudar o significado dela seria um risco
        // desnecessário de quebrar navegação existente).
        navigate('/inicio');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Bem-vindo de volta!"
      subtitle="Estamos felizes em ver você novamente."
      footer={<span>Precisa de uma conta? <Link to="/register">Cadastre-se</Link></span>}
    >
      <form onSubmit={onSubmit} className="auth-form">
        <label className="auth-field">
          E-MAIL OU NOME DE USUÁRIO
          <div className="auth-input-wrap">
            <IconGlyph src={emailIcon} size={16} className="auth-input-icon" />
            <input name="emailOrUsername" value={form.emailOrUsername} onChange={onChange} placeholder="voce@exemplo.com" required autoFocus />
          </div>
        </label>
        <label className="auth-field">
          SENHA
          <div className="auth-input-wrap">
            <IconGlyph src={lockIcon} size={16} className="auth-input-icon" />
            <input type={showPassword ? 'text' : 'password'} name="password" value={form.password} onChange={onChange} placeholder="••••••••" required />
            <button
              type="button"
              className="auth-password-toggle"
              tabIndex={-1}
              aria-label="Mostrar senha"
              onMouseEnter={() => setShowPassword(true)}
              onMouseLeave={() => setShowPassword(false)}
              onTouchStart={(e) => { e.preventDefault(); setShowPassword(true); }}
              onTouchEnd={() => setShowPassword(false)}
              onTouchCancel={() => setShowPassword(false)}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>
        </label>
        {needsTwoFactor && (
          <label className="auth-field">
            CÓDIGO DE AUTENTICAÇÃO DE DOIS FATORES
            <div className="auth-input-wrap">
              <IconGlyph src={shieldIcon} size={16} className="auth-input-icon" />
              <input name="twoFactorCode" value={form.twoFactorCode} onChange={onChange} placeholder="000000" autoFocus />
            </div>
          </label>
        )}
        <Link to="/forgot-password" className="auth-link-small">Esqueceu sua senha?</Link>
        {error && (
          <div className="auth-error">
            <span className="auth-error-icon">!</span>
            {error}
          </div>
        )}
        <button type="submit" className="btn-primary auth-submit-btn" disabled={busy}>
          {busy && <span className="auth-btn-spinner" />}
          {busy ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </AuthLayout>
  );
}
