import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import {
  getPinguConfig, updatePinguConfig, listPinguQuizQuestions, createPinguQuizQuestion, updatePinguQuizQuestion,
  deletePinguQuizQuestion, generatePinguQuizQuestion, startPinguQuiz, getPinguQuizScoreboardAdmin,
} from '../../api/endpoints';

// Painel da Equipe → Pingu → funções da Fase 9: boas-vindas, moderação
// assistida, resumo/tradução, imagens (Pingu Turbo) e Quiz do Pingu (banco de
// perguntas, começar agora, quiz diário e placar). Tudo funciona sem a IA,
// menos o que diz "IA".
const errText = (e, f) => e?.response?.data?.error || f;
const TEXT_TYPES = new Set(['TEXT', undefined, null, '']);

function useTextChannels() {
  const categories = useStore((s) => s.categories);
  const loose = useStore((s) => s.channels);
  return useMemo(() => {
    const seen = new Set();
    const out = [];
    [...(loose || []), ...(categories || []).flatMap((c) => (c.channels || []).map((ch) => ({ ...ch, catName: c.name })))].forEach((ch) => {
      if (!ch || seen.has(ch.id) || !TEXT_TYPES.has(ch.type)) return;
      seen.add(ch.id);
      out.push(ch);
    });
    return out;
  }, [categories, loose]);
}

function ChannelSelect({ value, onChange, channels, emptyLabel }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}{c.catName ? ` (${c.catName})` : ''}</option>)}
    </select>
  );
}

function Toggle({ checked, onChange, children }) {
  return (
    <label className="pgf-toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function QuizBank({ channels, flash, status }) {
  const [questions, setQuestions] = useState(null);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ question: '', answers: '', category: 'Geral' });
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState('');
  const [startChannel, setStartChannel] = useState('');
  const [board, setBoard] = useState(null);

  const load = () => listPinguQuizQuestions(filter || undefined).then((r) => setQuestions(r.questions || [])).catch((e) => flash(errText(e, 'Não deu pra carregar as perguntas.'), false));
  useEffect(() => { load(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { getPinguQuizScoreboardAdmin().then((r) => setBoard(r.scoreboard || [])).catch(() => setBoard([])); }, []);

  const run = async (key, fn, okMsg) => {
    setBusy(key);
    try { await fn(); if (okMsg) flash(okMsg); await load(); } catch (e) { flash(errText(e, 'Não deu certo.'), false); } finally { setBusy(''); }
  };
  const add = (e) => {
    e.preventDefault();
    run('add', async () => { await createPinguQuizQuestion(form); setForm({ question: '', answers: '', category: form.category }); }, 'Pergunta adicionada.');
  };
  const pending = (questions || []).filter((q) => q.status === 'PENDING').length;

  return (
    <>
      <h3>Quiz do Pingu</h3>
      <p className="dim pga-hint">O Pingu posta uma pergunta e a primeira resposta certa no canal (sem ligar pra acento e maiúsculas) ganha as moedas e o XP. Perguntas sugeridas pela IA só entram no quiz depois que alguém da equipe aprovar.</p>
      <div className="pgf-row">
        <ChannelSelect value={startChannel} onChange={setStartChannel} channels={channels} emptyLabel="Escolha o canal…" />
        <button type="button" className="btn-primary" disabled={!startChannel || busy === 'start'} onClick={() => run('start', () => startPinguQuiz(startChannel), 'Quiz começou! Veja no canal.')}>
          {busy === 'start' ? 'Começando…' : 'Começar quiz agora'}
        </button>
        {status?.text && <span className={`pga-msg ${status.ok ? '' : 'err'}`} role="status">{status.text}</span>}
      </div>

      <form className="pgf-quiz-form" onSubmit={add}>
        <label>Pergunta<input value={form.question} maxLength={300} onChange={(e) => setForm({ ...form, question: e.target.value })} required /></label>
        <label>Respostas aceitas (separe com |)<input value={form.answers} maxLength={400} placeholder="Brasília | Brasilia" onChange={(e) => setForm({ ...form, answers: e.target.value })} required /></label>
        <label>Categoria<input value={form.category} maxLength={40} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
        <button type="submit" className="btn-secondary" disabled={busy === 'add'}>Adicionar pergunta</button>
      </form>
      <div className="pgf-row">
        <input value={topic} maxLength={80} placeholder="Tema pra IA (opcional), ex.: Minecraft" onChange={(e) => setTopic(e.target.value)} />
        <button type="button" className="btn-secondary" disabled={busy === 'gen'} onClick={() => run('gen', () => generatePinguQuizQuestion(topic), 'A IA sugeriu uma pergunta (pendente de revisão).')}>
          {busy === 'gen' ? 'A IA está pensando…' : 'Sugerir pergunta com IA'}
        </button>
      </div>

      <div className="pgf-row">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar perguntas">
          <option value="">Todas as perguntas</option>
          <option value="PENDING">Pendentes de revisão{pending ? ` (${pending})` : ''}</option>
          <option value="APPROVED">Aprovadas</option>
        </select>
        <span className="dim">{questions ? `${questions.length} pergunta(s)` : 'Carregando…'}</span>
      </div>
      <ul className="pgf-qlist">
        {(questions || []).map((q) => (
          <li key={q.id} className={q.status === 'PENDING' ? 'pending' : ''}>
            <div className="pgf-q">
              <strong>{q.question}</strong>
              <span className="dim">Resposta: {q.answers.join(' | ')} · {q.category} · {q.source === 'IA' ? 'sugerida pela IA' : q.source === 'SEED' ? 'inicial' : 'equipe'} · usada {q.timesAsked}x</span>
            </div>
            <div className="pgf-q-actions">
              {q.status === 'PENDING' && <button type="button" className="btn-primary" disabled={!!busy} onClick={() => run(q.id, () => updatePinguQuizQuestion(q.id, { status: 'APPROVED' }), 'Pergunta aprovada.')}>Aprovar</button>}
              <button type="button" className="btn-secondary" disabled={!!busy || !startChannel || q.status !== 'APPROVED'} title={startChannel ? 'Usar esta pergunta agora no canal escolhido' : 'Escolha o canal acima'} onClick={() => run(q.id, () => startPinguQuiz(startChannel, q.id), 'Quiz começou!')}>Usar agora</button>
              <button type="button" className="btn-secondary danger" disabled={!!busy} onClick={() => { if (window.confirm('Apagar esta pergunta?')) run(q.id, () => deletePinguQuizQuestion(q.id), 'Pergunta apagada.'); }}>Apagar</button>
            </div>
          </li>
        ))}
      </ul>

      <h3>Placar do quiz</h3>
      {!board ? <p className="dim">Carregando…</p> : board.length === 0 ? <p className="dim">Ninguém acertou ainda.</p> : (
        <ol className="pgf-board">
          {board.map((r) => (
            <li key={r.user.id}><strong>{r.user.displayName || r.user.username || 'Conta removida'}</strong> <span className="dim">· {r.wins} acerto(s) · {r.coins} moedas · {r.xp} XP</span></li>
          ))}
        </ol>
      )}
    </>
  );
}

export default function PinguFeaturesAdmin() {
  const channels = useTextChannels();
  const [cfg, setCfg] = useState(null);
  const [saved, setSaved] = useState(null);
  const [defaultWelcome, setDefaultWelcome] = useState('');
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', ok: true });
  const flash = (text, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg({ text: '', ok: true }), 3500); };
  const apply = (r) => { setCfg(r.config); setSaved(r.config); setDefaultWelcome(r.defaultWelcome || ''); setOnline(!!r.online); };

  useEffect(() => { getPinguConfig().then(apply).catch((e) => flash(errText(e, 'Não deu pra carregar as funções do Pingu.'), false)); }, []);
  if (!cfg) return <section className="settings-block"><p className="dim">{msg.text || 'Carregando funções do Pingu…'}</p></section>;

  const set = (k) => (v) => setCfg((c) => ({ ...c, [k]: v }));
  const setNum = (k) => (e) => setCfg((c) => ({ ...c, [k]: e.target.value === '' ? '' : Number(e.target.value) }));
  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { apply(await updatePinguConfig(cfg)); flash('Funções do Pingu salvas.'); } catch (err) { flash(errText(err, 'Não deu pra salvar.'), false); } finally { setBusy(false); }
  };

  return (
    <section className="settings-block pga-form pgf">
      <form onSubmit={save} className="pgf-form">
        <h3>Funções do Pingu</h3>
        <p className="dim pga-hint">A IA {online ? 'está online' : 'está offline agora'}. Sem IA, as boas-vindas e o quiz continuam funcionando; resumo e tradução avisam que o Pingu está offline.</p>

        <h4>Boas-vindas</h4>
        <Toggle checked={cfg.welcomeEnabled} onChange={set('welcomeEnabled')}>Dar boas-vindas quando uma inscrição é aprovada</Toggle>
        <label>Canal
          <ChannelSelect value={cfg.welcomeChannelId} onChange={set('welcomeChannelId')} channels={channels} emptyLabel="Automático (boas-vindas / geral)" />
        </label>
        <label>Mensagem ({'{usuario}'} menciona a pessoa, {'{nome}'}, {'{canais}'} = canais em destaque, {'{ia}'} = frase da IA)
          <textarea rows={5} maxLength={1000} value={cfg.welcomeTemplate || ''} placeholder={defaultWelcome} onChange={(e) => set('welcomeTemplate')(e.target.value)} />
        </label>
        <Toggle checked={cfg.welcomeAi} onChange={set('welcomeAi')}>Personalizar com uma frase da IA (quando estiver online)</Toggle>

        <h4>Moderação assistida</h4>
        <Toggle checked={cfg.modAssistEnabled} onChange={set('modAssistEnabled')}>Avisar a equipe sobre mensagens suspeitas (o Pingu nunca pune ninguém)</Toggle>
        <Toggle checked={cfg.modAssistAi} onChange={set('modAssistAi')}>Confirmar com a IA antes de avisar (só as suspeitas vão pra IA)</Toggle>
        <label>Palavras extras pra vigiar (uma por linha ou separadas por vírgula)
          <textarea rows={3} maxLength={2000} value={cfg.modExtraWords || ''} onChange={(e) => set('modExtraWords')(e.target.value)} />
        </label>

        <h4>Resumo e tradução</h4>
        <Toggle checked={cfg.summaryEnabled} onChange={set('summaryEnabled')}>"Resumir o que perdi" nos canais</Toggle>
        <Toggle checked={cfg.translateEnabled} onChange={set('translateEnabled')}>"Traduzir com o Pingu" no menu das mensagens</Toggle>

        <h4>Imagens (Pingu Turbo)</h4>
        <Toggle checked={cfg.imageEnabled} onChange={set('imageEnabled')}>"@pingu desenhe …" cria imagens (o provedor é escolhido no servidor; estado e histórico mais abaixo)</Toggle>
        <div className="pgf-grid">
          <label>Imagens por dia (membro)<input type="number" min={0} max={200} value={cfg.imageDailyLimit ?? 10} onChange={setNum('imageDailyLimit')} /></label>
          <label>Intervalo entre pedidos (s)<input type="number" min={0} max={3600} value={cfg.imageCooldownSec ?? 30} onChange={setNum('imageCooldownSec')} /></label>
          <label>Ao mesmo tempo
            <select value={cfg.imageConcurrency ?? 1} onChange={(e) => set('imageConcurrency')(Number(e.target.value))}>
              <option value={1}>1 imagem por vez</option>
              <option value={2}>2 imagens por vez</option>
            </select>
          </label>
        </div>
        <p className="dim pga-hint">Assinantes podem criar 2× e Super Assinantes 3× o limite por dia.</p>

        <h4>Quiz</h4>
        <div className="pgf-grid">
          <label>Tempo pra responder (s)<input type="number" min={15} max={600} value={cfg.quizWindowSec} onChange={setNum('quizWindowSec')} /></label>
          <label>Moedas do prêmio<input type="number" min={0} max={1000} value={cfg.quizCoins} onChange={setNum('quizCoins')} /></label>
          <label>XP do prêmio<input type="number" min={0} max={2000} value={cfg.quizXp} onChange={setNum('quizXp')} /></label>
        </div>
        <Toggle checked={cfg.quizDailyEnabled} onChange={set('quizDailyEnabled')}>Quiz automático uma vez por dia</Toggle>
        <div className="pgf-grid">
          <label>Canal do quiz diário<ChannelSelect value={cfg.quizChannelId} onChange={set('quizChannelId')} channels={channels} emptyLabel="Escolha…" /></label>
          <label>Hora (Brasília)
            <select value={cfg.quizHour} onChange={(e) => set('quizHour')(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
            </select>
          </label>
        </div>

        <div className="pga-actions">
          <button type="submit" className="btn-primary" disabled={busy || !dirty}>{busy ? 'Salvando…' : 'Salvar funções'}</button>
          <button type="button" className="btn-secondary" disabled={busy || !dirty} onClick={() => setCfg(saved)}>Desfazer</button>
          {msg.text && <span className={`pga-msg ${msg.ok ? '' : 'err'}`} role="status">{msg.text}</span>}
        </div>
      </form>

      <QuizBank channels={channels} flash={flash} status={msg} />
    </section>
  );
}
