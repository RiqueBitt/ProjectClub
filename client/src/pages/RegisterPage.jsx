import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { submitApplication } from '../api/endpoints';
import { useAuth } from '../context/AuthContext.jsx';
import {
  AuthField, PasswordField, PasswordRules, isPasswordValid, AuthAlert, SubmitButton, apiError,
} from '../components/auth/AuthFields.jsx';
import { MailIcon, LockIcon, UserIcon, AtIcon, CheckIcon, ArrowLeftIcon } from '../components/auth/AuthIcons.jsx';

const HOW_FOUND_OPTIONS = ['Instagram', 'Facebook', 'Twitter / X', 'Whatsapp', 'Youtube', 'Discord', 'Outros'];
const INTEREST_OPTIONS = ['Vídeo Games', 'Cultura da internet', 'Assistir vídeos / conteúdo', 'Música'];
const ROLE_OPTIONS = ['Não tenho', 'Youtuber', 'Streamer', 'Designer', 'Game Developer', 'Designer Gráfico', 'Programador', 'Compositor Musical'];
const TECH_LEVEL_OPTIONS = [
  'Muito Pouco, Só fico no Instagram',
  'Mais ou menos, Uso meu telefone',
  'Normal, Uso um pouco o meu computador',
  'Intermediário, Sei mexer no computador',
  'Avançado, Uso o computador ou celular de forma extensa e sei mexer com sistemas e programas',
  'Especialista, Trabalho na área crio softwares',
];
const ALT_SOCIAL_OPTIONS = ['Nenhuma', 'Reddit', 'Bitview', 'SpaceHey', 'Fediverso', 'Newgrounds', '4Chan ou outros Chans', 'Fóruns específicos ou privados'];
const ACTIVE_MEMBER_OPTIONS = ['Sim', 'Não', 'Mais ou menos', 'Ainda não sei'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// Mesmas regras validadas no servidor (applicationsController.js).
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_REASON = 20;

const STEPS = [
  { id: 'conta', label: 'Sua conta' },
  { id: 'perfil', label: 'Sobre você' },
  { id: 'comunidade', label: 'Comunidade' },
];

const emptyAnswers = {
  howFound: '', howFoundOther: '', interests: [], roles: [],
  techLevel: '', altSocials: [], activeMember: '', joinReason: '',
};

const toggleInArray = (arr, value) => (arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]);

// Data real (rejeita 31/02 etc.: o Date "rola" pro mês seguinte e a
// comparação dos componentes pega isso).
function parseBirthDate(day, month, year) {
  const d = Number(day); const m = Number(month); const y = Number(year);
  if (!d || !m || !y || String(year).length !== 4) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (date > new Date() || y < 1900) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Grupo de opções acessível: escolha única = radio, múltipla = checkbox
// (setas/Tab/Espaço funcionam e leitores de tela anunciam certo), com o
// visual de "chip".
function ChoiceGroup({ legend, hint, options, value, onChange, multiple = false, columns, error }) {
  const isOn = (o) => (multiple ? value.includes(o) : value === o);
  return (
    <fieldset className={`pc-choice${error ? ' has-error' : ''}`}>
      <legend>
        {legend}
        <span className="pc-choice-hint">{hint || (multiple ? 'Escolha uma ou mais' : 'Escolha uma')}</span>
      </legend>
      <div className={`pc-chips${columns ? ` pc-chips-${columns}` : ''}`}>
        {options.map((o) => (
          <label key={o} className={`pc-chip${isOn(o) ? ' on' : ''}`}>
            <input
              type={multiple ? 'checkbox' : 'radio'} checked={isOn(o)}
              onChange={() => onChange(multiple ? toggleInArray(value, o) : o)}
            />
            {multiple && <span className="pc-chip-check" aria-hidden="true"><CheckIcon width={12} height={12} /></span>}
            <span>{o}</span>
          </label>
        ))}
      </div>
      {error && <p className="pc-field-error">{error}</p>}
    </fieldset>
  );
}

// Cadastro = formulário de inscrição: a conta só é criada depois que a
// staff aprovar (aba "Inscrições" do AdminPanel). Dividido em 3 etapas
// com validação por etapa, pra ninguém descobrir um erro da senha só
// depois de responder as 8 perguntas.
export default function RegisterPage() {
  const navigate = useNavigate();
  const { applySession } = useAuth();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    email: '', username: '', displayName: '', password: '', confirmPassword: '',
    birthDay: '', birthMonth: '', birthYear: '',
  });
  const [answers, setAnswers] = useState(emptyAnswers);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const panelTopRef = useRef(null);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    if (errors[name]) setErrors((x) => ({ ...x, [name]: undefined }));
  };
  const setAnswer = (key, value) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    if (errors[key]) setErrors((x) => ({ ...x, [key]: undefined }));
  };

  // Ao trocar de etapa, volta pro topo do formulário (a tela inteira é
  // um container de rolagem próprio — ver AuthLayout).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    panelTopRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [step]);

  const validateStep = (s) => {
    const e = {};
    if (s === 0) {
      if (!EMAIL_RE.test(form.email.trim())) e.email = 'Digite um e-mail válido.';
      if (!USERNAME_RE.test(form.username.trim())) e.username = 'De 3 a 32 caracteres: letras, números, _ ou ponto.';
      if (form.displayName.length > 32) e.displayName = 'Máximo de 32 caracteres.';
      if (!isPasswordValid(form.password)) e.password = 'A senha ainda não cumpre os requisitos.';
      if (form.confirmPassword !== form.password) e.confirmPassword = 'As senhas não são iguais.';
      if (!parseBirthDate(form.birthDay, form.birthMonth, form.birthYear)) e.birthDate = 'Informe uma data de nascimento válida.';
    }
    if (s === 1) {
      if (!answers.howFound) e.howFound = 'Escolha uma opção.';
      else if (answers.howFound === 'Outros' && !answers.howFoundOther.trim()) e.howFound = 'Escreva por qual outro meio.';
      if (!answers.interests.length) e.interests = 'Escolha pelo menos um interesse.';
      if (!answers.roles.length) e.roles = 'Escolha pelo menos uma opção (ou "Não tenho").';
      if (!answers.techLevel) e.techLevel = 'Escolha uma opção.';
    }
    if (s === 2) {
      if (!answers.altSocials.length) e.altSocials = 'Escolha pelo menos uma opção (ou "Nenhuma").';
      if (!answers.activeMember) e.activeMember = 'Escolha uma opção.';
      if (answers.joinReason.trim().length < MIN_REASON) e.joinReason = `Escreva pelo menos ${MIN_REASON} caracteres.`;
    }
    setErrors(e);
    if (Object.keys(e).length) {
      // Leva o foco pro primeiro campo com problema.
      requestAnimationFrame(() => {
        document.querySelector('.pc-auth .has-error input, .pc-auth .has-error textarea, .pc-auth .has-error select')?.focus();
      });
      return false;
    }
    return true;
  };

  const next = (e) => {
    e?.preventDefault();
    if (validateStep(step)) { setError(''); setStep((s) => Math.min(s + 1, STEPS.length - 1)); }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (step < STEPS.length - 1) return next();
    if (busy) return;
    // Revalida tudo (alguém pode ter voltado e apagado um campo).
    for (let s = 0; s < STEPS.length; s += 1) {
      if (!validateStep(s)) { setStep(s); return; }
    }
    setBusy(true);
    setError('');
    try {
      const payload = {
        email: form.email.trim(),
        username: form.username.trim(),
        displayName: form.displayName.trim(),
        password: form.password,
        birthDate: parseBirthDate(form.birthDay, form.birthMonth, form.birthYear),
        answers: { ...answers, howFoundOther: answers.howFoundOther.trim(), joinReason: answers.joinReason.trim() },
      };
      const result = await submitApplication(payload);
      // E-mail do dono (PLATFORM_ADMIN_EMAIL) é aprovado na hora e já entra.
      if (result.autoApproved) {
        applySession(result);
        navigate('/', { replace: true });
        return;
      }
      setSubmitted(true);
    } catch (err) {
      const msg = apiError(err, 'Não foi possível enviar sua inscrição. Tente de novo.');
      setError(msg);
      // Conflito de e-mail/ClubTag: volta pra etapa da conta.
      if (err?.response?.status === 409) setStep(0);
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <AuthLayout title="Inscrição enviada" footer={<>Já foi aprovado? <Link to="/login">Entrar</Link></>}>
        <div className="pc-success">
          <span className="pc-success-badge"><CheckIcon width={28} height={28} /></span>
          <p>
            A equipe vai analisar suas respostas. O resultado chega por e-mail em <b>{form.email.trim()}</b>,
            e, se for aprovada, sua conta já vem pronta para entrar.
          </p>
          <p className="pc-muted">Confira também a caixa de spam.</p>
        </div>
      </AuthLayout>
    );
  }

  const isLast = step === STEPS.length - 1;

  return (
    <AuthLayout
      title="Inscreva-se no Project Club"
      subtitle="Somos uma comunidade privada: sua conta é criada depois que a equipe aprovar a inscrição."
      footer={<>Já tem uma conta? <Link to="/login">Entrar</Link></>}
      wide
    >
      <div ref={panelTopRef} className="pc-scroll-anchor" />
      <ol className="pc-steps" aria-label="Etapas da inscrição">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="pc-step-dot">{i < step ? <CheckIcon width={13} height={13} /> : i + 1}</span>
            <span className="pc-step-label">{s.label}</span>
          </li>
        ))}
      </ol>

      <form onSubmit={onSubmit} className="pc-form" noValidate>
        {step === 0 && (
          <div className="pc-step-body">
            <div className="pc-grid-2">
              <AuthField
                label="E-mail" icon={MailIcon} type="email" name="email" value={form.email} onChange={onChange}
                autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false}
                placeholder="voce@exemplo.com" error={errors.email} autoFocus
              />
              <AuthField
                label="Nome de exibição" icon={UserIcon} name="displayName" value={form.displayName} onChange={onChange}
                autoComplete="nickname" maxLength={32} placeholder="Como quer ser chamado"
                hint="Opcional. Se ficar vazio, usamos sua ClubTag." error={errors.displayName}
              />
            </div>
            <AuthField
              label="ClubTag" icon={AtIcon} name="username" value={form.username} onChange={onChange}
              autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={32}
              placeholder="seu_nome" hint="Seu identificador único: letras, números, _ ou ponto." error={errors.username}
            />
            <div className="pc-grid-2">
              <PasswordField
                icon={LockIcon} name="password" value={form.password} onChange={onChange}
                autoComplete="new-password" placeholder="Crie uma senha" error={errors.password}
              />
              <PasswordField
                label="Confirmar senha" icon={LockIcon} name="confirmPassword" value={form.confirmPassword} onChange={onChange}
                autoComplete="new-password" placeholder="Repita a senha" error={errors.confirmPassword}
              />
            </div>
            <PasswordRules value={form.password} />

            <fieldset className={`pc-birth${errors.birthDate ? ' has-error' : ''}`}>
              <legend>Data de nascimento</legend>
              <div className="pc-birth-row">
                <input
                  aria-label="Dia" name="birthDay" value={form.birthDay} placeholder="Dia"
                  inputMode="numeric" autoComplete="bday-day" maxLength={2}
                  onChange={(e) => onChange({ target: { name: 'birthDay', value: e.target.value.replace(/\D/g, '') } })}
                />
                <select aria-label="Mês" name="birthMonth" value={form.birthMonth} onChange={onChange} autoComplete="bday-month" className={form.birthMonth ? undefined : 'is-empty'}>
                  <option value="">Mês</option>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <input
                  aria-label="Ano" name="birthYear" value={form.birthYear} placeholder="Ano"
                  inputMode="numeric" autoComplete="bday-year" maxLength={4}
                  onChange={(e) => onChange({ target: { name: 'birthYear', value: e.target.value.replace(/\D/g, '') } })}
                />
              </div>
              {errors.birthDate && <p className="pc-field-error">{errors.birthDate}</p>}
            </fieldset>
          </div>
        )}

        {step === 1 && (
          <div className="pc-step-body">
            <ChoiceGroup
              legend="Como você descobriu o Project Club?" options={HOW_FOUND_OPTIONS}
              value={answers.howFound} onChange={(v) => setAnswer('howFound', v)} error={errors.howFound}
            />
            {answers.howFound === 'Outros' && (
              <AuthField
                label="Qual foi?" name="howFoundOther" value={answers.howFoundOther} autoFocus maxLength={120}
                onChange={(e) => setAnswer('howFoundOther', e.target.value)} placeholder="Ex.: um amigo me indicou"
              />
            )}
            <ChoiceGroup
              legend="Quais são seus interesses?" options={INTEREST_OPTIONS} multiple
              value={answers.interests} onChange={(v) => setAnswer('interests', v)} error={errors.interests}
            />
            <ChoiceGroup
              legend="O que você faz?" options={ROLE_OPTIONS} multiple
              value={answers.roles} onChange={(v) => setAnswer('roles', v)} error={errors.roles}
            />
            <ChoiceGroup
              legend="Quanto você entende de tecnologia?" options={TECH_LEVEL_OPTIONS} columns={1}
              value={answers.techLevel} onChange={(v) => setAnswer('techLevel', v)} error={errors.techLevel}
            />
          </div>
        )}

        {step === 2 && (
          <div className="pc-step-body">
            <ChoiceGroup
              legend={'Já participou de outra rede social "alternativa"?'} options={ALT_SOCIAL_OPTIONS} multiple
              value={answers.altSocials} onChange={(v) => setAnswer('altSocials', v)} error={errors.altSocials}
            />
            <ChoiceGroup
              legend="Você seria um membro ativo?" options={ACTIVE_MEMBER_OPTIONS}
              value={answers.activeMember} onChange={(v) => setAnswer('activeMember', v)} error={errors.activeMember}
            />
            <div className={`pc-field${errors.joinReason ? ' has-error' : ''}`}>
              <label className="pc-field-label" htmlFor="pc-join-reason">Por que você quer entrar na comunidade?</label>
              <textarea
                id="pc-join-reason" rows={5} maxLength={1000} value={answers.joinReason}
                onChange={(e) => setAnswer('joinReason', e.target.value)}
                placeholder="Conte um pouco sobre você e o que espera encontrar aqui."
              />
              <div className="pc-field-meta">
                {errors.joinReason
                  ? <p className="pc-field-error">{errors.joinReason}</p>
                  : <p className="pc-field-hint">Mínimo de {MIN_REASON} caracteres.</p>}
                <span className="pc-counter">{answers.joinReason.length}/1000</span>
              </div>
            </div>
          </div>
        )}

        <AuthAlert>{error}</AuthAlert>

        <div className="pc-step-actions">
          {step > 0 && (
            <button type="button" className="pc-btn pc-btn-ghost" onClick={() => { setError(''); setErrors({}); setStep((s) => s - 1); }} disabled={busy}>
              <ArrowLeftIcon width={16} height={16} /> Voltar
            </button>
          )}
          {isLast
            ? <SubmitButton busy={busy} busyLabel="Enviando…">Enviar inscrição</SubmitButton>
            : <button type="submit" className="pc-btn pc-btn-primary">Continuar</button>}
        </div>
      </form>
    </AuthLayout>
  );
}
