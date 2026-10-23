import { useId, useState } from 'react';
import { EyeIcon, EyeOffIcon, AlertIcon, CheckIcon } from './AuthIcons.jsx';

// Campo de texto padrão das telas de autenticação: rótulo em cima,
// ícone à esquerda, dica ou erro embaixo (ligados via aria-describedby
// pra leitores de tela).
export function AuthField({ label, icon: Icon, hint, error, trailing, inputRef, ...inputProps }) {
  const id = useId();
  const hintId = hint || error ? `${id}-hint` : undefined;
  return (
    <div className={`pc-field${error ? ' has-error' : ''}`}>
      <label className="pc-field-label" htmlFor={id}>{label}</label>
      <div className="pc-field-box">
        {Icon && <Icon className="pc-field-icon" />}
        <input id={id} ref={inputRef} aria-invalid={error ? true : undefined} aria-describedby={hintId} {...inputProps} />
        {trailing}
      </div>
      {(error || hint) && (
        <p id={hintId} className={error ? 'pc-field-error' : 'pc-field-hint'}>{error || hint}</p>
      )}
    </div>
  );
}

// Senha com o "olho": no PC mostra enquanto o mouse está em cima, no
// celular enquanto o dedo segura (comportamento pedido antes, mantido).
// Pointer Events cobrem mouse, toque e caneta do mesmo jeito em todo
// navegador — antes eram onMouseEnter + onTouchStart separados, e o
// preventDefault no toque travava o foco do campo em alguns Android.
// Pelo teclado, Enter/Espaço alterna (quem navega por Tab também usa).
export function PasswordField({ label = 'Senha', icon, hint, error, ...inputProps }) {
  const [visible, setVisible] = useState(false);
  const show = () => setVisible(true);
  const hide = () => setVisible(false);

  const toggle = (
    <button
      type="button"
      className="pc-field-eye"
      aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
      aria-pressed={visible}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') show(); }}
      onPointerLeave={hide}
      onPointerDown={(e) => { if (e.pointerType !== 'mouse') { e.currentTarget.setPointerCapture?.(e.pointerId); show(); } }}
      onPointerUp={(e) => { if (e.pointerType !== 'mouse') hide(); }}
      onPointerCancel={hide}
      onClick={(e) => { if (e.detail === 0) setVisible((v) => !v); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {visible ? <EyeOffIcon /> : <EyeIcon />}
    </button>
  );

  return (
    <AuthField
      label={label} icon={icon} hint={hint} error={error} trailing={toggle}
      type={visible ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false}
      {...inputProps}
    />
  );
}

// Regras da senha — as MESMAS que o servidor exige
// (isPasswordStrongEnough em authController.js), mostradas enquanto a
// pessoa digita, pra ninguém descobrir só no fim do formulário.
export const passwordRules = [
  { id: 'len', label: '8 caracteres ou mais', test: (p) => p.length >= 8 },
  { id: 'letter', label: 'Uma letra', test: (p) => /[a-zA-Z]/.test(p) },
  { id: 'number', label: 'Um número', test: (p) => /[0-9]/.test(p) },
];
export const isPasswordValid = (p) => passwordRules.every((r) => r.test(p));

export function PasswordRules({ value }) {
  return (
    <ul className="pc-rules" aria-label="Requisitos da senha">
      {passwordRules.map((r) => {
        const ok = r.test(value);
        return (
          <li key={r.id} className={ok ? 'ok' : ''}>
            <CheckIcon width={14} height={14} /> {r.label}
            <span className="sr-only">{ok ? ' (cumprido)' : ' (pendente)'}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function AuthAlert({ children, tone = 'error' }) {
  if (!children) return null;
  return (
    <div className={`pc-alert pc-alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'error' ? <AlertIcon /> : <CheckIcon />}
      <span>{children}</span>
    </div>
  );
}

export function SubmitButton({ busy, busyLabel, children, ...props }) {
  return (
    <button type="submit" className="pc-btn pc-btn-primary" disabled={busy} aria-busy={busy || undefined} {...props}>
      {busy && <span className="pc-spinner" aria-hidden="true" />}
      {busy ? busyLabel : children}
    </button>
  );
}

// Mensagem de erro vinda da API (axios), com fallback para queda de rede.
export function apiError(err, fallback) {
  if (err?.response?.data?.error) return err.response.data.error;
  if (err?.code === 'ERR_NETWORK' || !err?.response) return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.';
  return fallback;
}
