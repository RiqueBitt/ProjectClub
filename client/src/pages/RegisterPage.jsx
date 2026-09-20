import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { submitApplication } from '../api/endpoints';
import { useAuth } from '../context/AuthContext.jsx';

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

const emptyAnswers = {
  howFound: '', howFoundOther: '', interests: [], roles: [],
  techLevel: '', altSocials: [], activeMember: '', joinReason: '',
};

function toggleInArray(arr, value) {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

// Item pedido: "melhore o registro deixando mais organizado, compacto e
// mais bonito" — cada uma das 8 perguntas tinha sua própria marcação
// repetida (número + texto colados numa linha só, tudo maiúsculo, sem
// nenhuma separação visual entre uma pergunta e a próxima). Esse
// componente padroniza isso: o número vira um selo pequeno e redondo
// (mais fácil de escanear "quantas faltam" que ler "1ª — 2ª — 3ª..."
// em texto corrido), o título deixa de ser tudo em caixa alta (menos
// "gritado", mais fácil de ler pergunta longa), e junto com o
// .register-question mais compacto no CSS, o formulário inteiro fica
// visivelmente mais curto sem cortar nenhuma pergunta.
function Question({ number, title, hint, children }) {
  return (
    <div className="register-question">
      <div className="register-question-head">
        <span className="register-question-number">{number}</span>
        <span className="register-question-title">{title}{hint && <span className="dim register-question-hint"> {hint}</span>}</span>
      </div>
      {children}
    </div>
  );
}

// Cadastro direto virou um formulário de inscrição — a conta só é criada
// depois que a staff analisar e aprovar (ver AdminPanel.jsx aba
// "Inscrições"). Enquanto isso, a pessoa não tem login nenhum ainda.
export default function RegisterPage() {
  const navigate = useNavigate();
  const { applySession } = useAuth();
  const [form, setForm] = useState({ email: '', username: '', displayName: '', password: '', birthDay: '', birthMonth: '', birthYear: '' });
  const [answers, setAnswers] = useState(emptyAnswers);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const { birthDay, birthMonth, birthYear } = form;
    if (!birthDay || !birthMonth || !birthYear) { setError('Preencha sua data de nascimento completa.'); return; }
    const birthDate = new Date(`${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`);
    if (Number.isNaN(birthDate.getTime()) || birthDate > new Date()) { setError('Data de nascimento inválida.'); return; }

    if (!answers.howFound) { setError('Responda por qual meio você descobriu o Project Club.'); return; }
    if (answers.howFound === 'Outros' && !answers.howFoundOther.trim()) { setError('Escreva por qual outro meio você descobriu.'); return; }
    if (answers.interests.length === 0) { setError('Escolha ao menos um interesse/hobby.'); return; }
    if (answers.roles.length === 0) { setError('Responda o que você faz (ou "Não tenho").'); return; }
    if (!answers.techLevel) { setError('Escolha seu nível de conhecimento sobre tecnologia.'); return; }
    if (answers.altSocials.length === 0) { setError('Responda se já participou de outra rede social alternativa (ou "Nenhuma").'); return; }
    if (!answers.activeMember) { setError('Escolha se você seria um membro ativo.'); return; }
    if (answers.joinReason.trim().length < 20) { setError('Conte um pouco mais sobre por que quer se unir (mínimo 20 caracteres).'); return; }

    setBusy(true);
    try {
      const { birthDay: bd, birthMonth: bm, birthYear: by, ...rest } = form;
      const birthDateStr = `${by}-${String(bm).padStart(2, '0')}-${String(bd).padStart(2, '0')}`;
      const result = await submitApplication({ ...rest, birthDate: birthDateStr, answers });
      // Item pedido: auto-aprovação do e-mail do dono da plataforma
      // (ver PLATFORM_ADMIN_EMAIL em applicationsController.js) — a
      // conta já vem criada e logada na hora, sem passar pela fila de
      // aprovação; entra direto no app em vez de mostrar a tela de
      // "aguarde aprovação".
      if (result.autoApproved) {
        applySession(result);
        navigate('/');
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível enviar sua inscrição.');
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <AuthLayout title="Inscrição enviada!" footer={<span>Já tem uma conta? <Link to="/login">Entrar</Link></span>}>
        <p style={{ textAlign: 'center', lineHeight: 1.6 }}>
          Recebemos sua inscrição! A equipe vai analisar e você recebe a resposta por e-mail
          {form.email ? <> em <b>{form.email}</b></> : ''} — se for aprovada, sua conta já vem ativa com um link direto pra entrar.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Inscreva-se no Project Club"
      subtitle="Sua conta é criada depois que a equipe analisar sua inscrição."
      footer={<span>Já tem uma conta? <Link to="/login">Entrar</Link></span>}
      wide
    >
      <form onSubmit={onSubmit} className="auth-form register-form-scrollable">
        <div className="register-intro">
          <p>
            Olá, seja bem vindo ao Project Club, nosso clubinho no coração da internet! Não somos
            uma rede social pública — somos uma comunidade privada, e por conta de riscos de
            segurança exigimos um formulário com 8 perguntas sobre você antes de aprovar o acesso.
          </p>
          <p className="dim register-intro-note">Preencha com cautela — você recebe a resposta (aprovado ou não) por e-mail.</p>
        </div>

        <div className="register-section">
          <h3 className="register-section-title">Dados da conta</h3>
          <div className="register-section-grid">
            <label>
              E-MAIL
              <input type="email" name="email" value={form.email} onChange={onChange} required autoFocus />
            </label>
            <label>
              NOME DE EXIBIÇÃO
              <input name="displayName" value={form.displayName} onChange={onChange} />
            </label>
            <label>
              CLUBTAG
              <input name="username" value={form.username} onChange={onChange} required minLength={3} placeholder="Seu identificador único" />
            </label>
            <label>
              SENHA
              <input type="password" name="password" value={form.password} onChange={onChange} required minLength={8} />
            </label>
          </div>
        </div>

        <div className="register-section">
          <h3 className="register-section-title">Questionário de admissão</h3>

          <Question number={1} title="Qual é a sua idade?" hint="(data de nascimento)">
            <div className="birthdate-row">
              <input type="number" name="birthDay" min="1" max="31" placeholder="Dia" value={form.birthDay} onChange={onChange} />
              <input type="number" name="birthMonth" min="1" max="12" placeholder="Mês" value={form.birthMonth} onChange={onChange} />
              <input type="number" name="birthYear" min="1930" max={new Date().getFullYear()} placeholder="Ano" value={form.birthYear} onChange={onChange} />
            </div>
          </Question>

          <Question number={2} title="Por qual meio você descobriu o Project Club?" hint="(escolha única)">
            <div className="theme-options register-options">
              {HOW_FOUND_OPTIONS.map((o) => (
                <button key={o} type="button" className={`theme-swatch ${answers.howFound === o ? 'active' : ''}`} onClick={() => setAnswers((a) => ({ ...a, howFound: o }))}>
                  {o}
                </button>
              ))}
            </div>
            {answers.howFound === 'Outros' && (
              <input
                style={{ marginTop: 8 }} placeholder="Escreva qual foi"
                value={answers.howFoundOther} onChange={(e) => setAnswers((a) => ({ ...a, howFoundOther: e.target.value }))}
              />
            )}
          </Question>

          <Question number={3} title="Quais são seus interesses ou hobbies?" hint="(escolha múltipla)">
            <div className="theme-options register-options">
              {INTEREST_OPTIONS.map((o) => (
                <button key={o} type="button" className={`theme-swatch ${answers.interests.includes(o) ? 'active' : ''}`} onClick={() => setAnswers((a) => ({ ...a, interests: toggleInArray(a.interests, o) }))}>
                  {o}
                </button>
              ))}
            </div>
          </Question>

          <Question number={4} title="Você é o quê?" hint="(escolha múltipla)">
            <div className="theme-options register-options">
              {ROLE_OPTIONS.map((o) => (
                <button key={o} type="button" className={`theme-swatch ${answers.roles.includes(o) ? 'active' : ''}`} onClick={() => setAnswers((a) => ({ ...a, roles: toggleInArray(a.roles, o) }))}>
                  {o}
                </button>
              ))}
            </div>
          </Question>

          <Question number={5} title="Qual seu nível de conhecimento sobre tecnologia?" hint="(escolha única)">
            <div className="theme-options register-options theme-options-wrap">
              {TECH_LEVEL_OPTIONS.map((o) => (
                <button key={o} type="button" className={`theme-swatch ${answers.techLevel === o ? 'active' : ''}`} onClick={() => setAnswers((a) => ({ ...a, techLevel: o }))}>
                  {o}
                </button>
              ))}
            </div>
          </Question>

          <Question number={6} title={'Já participou de alguma outra rede social "alternativa"?'} hint="(escolha múltipla)">
            <div className="theme-options register-options">
              {ALT_SOCIAL_OPTIONS.map((o) => (
                <button key={o} type="button" className={`theme-swatch ${answers.altSocials.includes(o) ? 'active' : ''}`} onClick={() => setAnswers((a) => ({ ...a, altSocials: toggleInArray(a.altSocials, o) }))}>
                  {o}
                </button>
              ))}
            </div>
          </Question>

          <Question number={7} title="Você seria um membro ativo na comunidade?" hint="(escolha única)">
            <div className="theme-options register-options">
              {ACTIVE_MEMBER_OPTIONS.map((o) => (
                <button key={o} type="button" className={`theme-swatch ${answers.activeMember === o ? 'active' : ''}`} onClick={() => setAnswers((a) => ({ ...a, activeMember: o }))}>
                  {o}
                </button>
              ))}
            </div>
          </Question>

          <Question number={8} title="Por qual motivo você gostaria de se unir à nossa comunidade?">
            <textarea value={answers.joinReason} onChange={(e) => setAnswers((a) => ({ ...a, joinReason: e.target.value }))} rows={4} maxLength={1000} placeholder="Escreva sua resposta..." />
            <span className="dim char-count">{answers.joinReason.length}/1000</span>
          </Question>
        </div>

        {error && <div className="auth-error">{error}</div>}
        <button type="submit" className="btn-primary register-submit-btn" disabled={busy}>{busy ? 'Enviando...' : 'Enviar inscrição'}</button>
      </form>
    </AuthLayout>
  );
}
