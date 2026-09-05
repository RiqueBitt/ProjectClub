import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { submitApplication } from '../api/endpoints';

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

// Cadastro direto virou um formulário de inscrição — a conta só é criada
// depois que a staff analisar e aprovar (ver AdminPanel.jsx aba
// "Inscrições"). Enquanto isso, a pessoa não tem login nenhum ainda.
export default function RegisterPage() {
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
      await submitApplication({ ...rest, birthDate: birthDateStr, answers });
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
        <p className="register-intro">
          Olá, seja bem vindo ao Project Club, nosso clubinho no coração da internet! Ficamos
          felizes em saber que você tem interesse em se juntar à nossa comunidade. Antes de
          continuar, é importante saber que não somos uma rede social pública — somos uma
          comunidade privada. Por conta de riscos de segurança com usuários mal intencionados,
          exigimos que todos os interessados passem por um formulário com 8 perguntas sobre
          você. Assim que for concluído, um dos nossos membros da equipe vai revisar seu pedido
          e aprovar ou negar dependendo das circunstâncias. Preencha com cautela e aguarde o
          resultado — você receberá um e-mail declarando sua aprovação ou rejeição.
        </p>

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
          <input name="username" value={form.username} onChange={onChange} required minLength={3} placeholder="Seu identificador único no Project Club" />
        </label>
        <label>
          SENHA
          <input type="password" name="password" value={form.password} onChange={onChange} required minLength={8} />
        </label>

        <label>
          1ª — QUAL É A SUA IDADE? (data de nascimento)
          <div className="birthdate-row">
            <input type="number" name="birthDay" min="1" max="31" placeholder="Dia" value={form.birthDay} onChange={onChange} />
            <input type="number" name="birthMonth" min="1" max="12" placeholder="Mês" value={form.birthMonth} onChange={onChange} />
            <input type="number" name="birthYear" min="1930" max={new Date().getFullYear()} placeholder="Ano" value={form.birthYear} onChange={onChange} />
          </div>
        </label>

        <label>
          2ª — POR QUAL MEIO VOCÊ DESCOBRIU O PROJECT CLUB? <span className="dim">(escolha única)</span>
          <div className="theme-options">
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
        </label>

        <label>
          3ª — QUAIS SÃO SEUS INTERESSES OU HOBBIES? <span className="dim">(escolha múltipla)</span>
          <div className="theme-options">
            {INTEREST_OPTIONS.map((o) => (
              <button key={o} type="button" className={`theme-swatch ${answers.interests.includes(o) ? 'active' : ''}`} onClick={() => setAnswers((a) => ({ ...a, interests: toggleInArray(a.interests, o) }))}>
                {o}
              </button>
            ))}
          </div>
        </label>

        <label>
          4ª — VOCÊ É O QUÊ? <span className="dim">(escolha múltipla)</span>
          <div className="theme-options">
            {ROLE_OPTIONS.map((o) => (
              <button key={o} type="button" className={`theme-swatch ${answers.roles.includes(o) ? 'active' : ''}`} onClick={() => setAnswers((a) => ({ ...a, roles: toggleInArray(a.roles, o) }))}>
                {o}
              </button>
            ))}
          </div>
        </label>

        <label>
          5ª — QUAL SEU NÍVEL DE CONHECIMENTO SOBRE TECNOLOGIA? <span className="dim">(escolha única)</span>
          <div className="theme-options theme-options-wrap">
            {TECH_LEVEL_OPTIONS.map((o) => (
              <button key={o} type="button" className={`theme-swatch ${answers.techLevel === o ? 'active' : ''}`} onClick={() => setAnswers((a) => ({ ...a, techLevel: o }))}>
                {o}
              </button>
            ))}
          </div>
        </label>

        <label>
          6ª — JÁ PARTICIPOU DE ALGUMA OUTRA REDE SOCIAL "ALTERNATIVA"? <span className="dim">(escolha múltipla)</span>
          <div className="theme-options">
            {ALT_SOCIAL_OPTIONS.map((o) => (
              <button key={o} type="button" className={`theme-swatch ${answers.altSocials.includes(o) ? 'active' : ''}`} onClick={() => setAnswers((a) => ({ ...a, altSocials: toggleInArray(a.altSocials, o) }))}>
                {o}
              </button>
            ))}
          </div>
        </label>

        <label>
          7ª — VOCÊ SERIA UM MEMBRO ATIVO NA COMUNIDADE? <span className="dim">(escolha única)</span>
          <div className="theme-options">
            {ACTIVE_MEMBER_OPTIONS.map((o) => (
              <button key={o} type="button" className={`theme-swatch ${answers.activeMember === o ? 'active' : ''}`} onClick={() => setAnswers((a) => ({ ...a, activeMember: o }))}>
                {o}
              </button>
            ))}
          </div>
        </label>

        <label>
          8ª — POR QUAL MOTIVO VOCÊ GOSTARIA DE SE UNIR À NOSSA COMUNIDADE?
          <textarea value={answers.joinReason} onChange={(e) => setAnswers((a) => ({ ...a, joinReason: e.target.value }))} rows={4} maxLength={1000} placeholder="Escreva sua resposta..." />
          <span className="dim char-count">{answers.joinReason.length}/1000</span>
        </label>

        {error && <div className="auth-error">{error}</div>}
        <button type="submit" className="btn-primary register-submit-btn" disabled={busy}>{busy ? 'Enviando...' : 'Enviar inscrição'}</button>
      </form>
    </AuthLayout>
  );
}
