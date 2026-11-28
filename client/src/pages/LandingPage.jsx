import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PublicFooter, PublicHeader, usePublicScrollChrome } from './public/PublicChrome.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import '../styles/landing.css';
import '../styles/landing-mono.css';
import '../styles/landing-club.css';
import '../styles/public-classic.css';

// Página inicial pública (vitrine + download).
//
// Visual Clássico (nov/2026, public-classic.css por cima de landing-club.css):
// as cores do app Clássico (grafite + azul #4C9FFF) com toques criativos —
// a lista de canais da abertura gira sozinha, as mensagens de "Um dia no
// clube" aceitam reações e o Pingu fica "digitando", os cartões acendem
// onde o mouse passa e baixar solta um confete com as cores do clube.
//
// Visual anterior (nov/2026, landing-club.css): a abertura é a própria lista de
// canais do app, parada em "# project club" (a pílula branca do canal
// aberto), com o botão de baixar do lado. Depois a foto do app sobre a folha
// branca dos apps, "Um dia no clube" contado como conversa, download,
// perguntas e o convite final. Cabeçalho e rodapé são os mesmos do Blog
// (PublicChrome.jsx). Com "reduzir movimento" ligado, tudo aparece parado.

const DOWNLOADS_BASE = 'https://github.com/RiqueBitt/ProjectClub/releases/latest/download';
const DOWNLOADS = {
  windows: `${DOWNLOADS_BASE}/ProjectClub-Setup-Windows.exe`,
  linux: `${DOWNLOADS_BASE}/ProjectClub-Linux.AppImage`,
  // ProjectClub.apk = app Android nativo (mesmo pacote do app antigo, que atualiza para ele).
  android: `${DOWNLOADS_BASE}/ProjectClub.apk`,
};

// Apps da vitrine (o próprio Project Club, o Mod Manager e o RPG Blackout).
// Os programas de criação saíram da vitrine por enquanto (continuam no app).
const APPS = [
  { id: 'projectclub', name: 'Project Club', what: 'Comunidade com chat, voz e jogos', line: 'Canais de texto e de voz, amigos, Game Hub, loja e economia, no computador, no celular e no navegador.', note: 'Windows, Linux, Android e navegador' },
  { id: 'modmanager', name: 'Mod Manager', what: 'Gerenciador de mods', line: 'Os mods dos seus jogos da Steam, Epic Games e GOG, do Minecraft e do Hytale, com modpacks que entram quando o jogo abre.', note: 'Vem no app para computador' },
  { id: 'blackout', name: 'RPG Blackout', what: 'RPG de mesa', line: 'O compêndio do BLACKOUT abre direto no Project Club, no computador e no celular, pra quem está na mesa.', note: 'Pra quem joga na instância BLACKOUT' },
];

// "Um dia no clube": cada parte do app mostrada como uma mensagem.
// Cada mensagem traz reações (dá pra clicar, igual no app — só na tela).
const DAY = [
  { t: '19:02', who: 'Nina', c: '#C27C3E', text: 'tem jogo de graça essa semana, já deixei salvo no Game Hub', tag: 'Promoções', icon: 'game', reacts: [['🎮', 4], ['🔥', 2]] },
  { t: '20:15', who: 'Kaio', c: '#23A55A', text: 'baixei o modpack pelo Mod Manager, já tá rodando aqui', tag: 'Mod Manager', icon: 'puzzle', reacts: [['⛏️', 3]] },
  { t: '21:40', who: 'Lia', c: '#4C9FFF', text: 'troquei minhas moedas por uma moldura nova na Loja', tag: 'Loja', icon: 'bag', reacts: [['😍', 5], ['💸', 1]] },
  { t: '22:58', who: 'RiqueBitt', c: '#F23F43', text: 'abri a call 1, vou compartilhar a tela', tag: 'Voz e tela', icon: 'voice', card: true, reacts: [['🙋', 6]] },
  { t: '23:24', who: 'Loritta', c: '#EB459F', text: 'Lembrete: o evento de figurinhas começa amanhã 🎉', tag: 'Eventos', icon: 'trophy', reacts: [['🎉', 8], ['👀', 3]] },
];

// Canais que passam pela "roda" da abertura (em volta do # project club).
const WHEEL = ['chat geral', 'call das 23h', 'game hub', 'mod manager', 'novidades', 'economia', 'memes', 'clipes', 'loja', 'amigos'];

// Cores do confete (as do app Clássico).
const CONFETTI = ['#4C9FFF', '#23A55A', '#F0B232', '#F23F43', '#EB459F', '#FFFFFF'];

const ICONS = {
  windows: 'M3 5.5 10 4.5v7H3zM12 4.2 21 3v8.5h-9zM3 13h7v6.5L3 18.5zM12 13h9V21l-9-1.2z',
  linux: 'M12 3c-2.2 0-3.5 1.8-3.5 4.3 0 1.5-.6 2.6-1.6 4C5.6 13 5 14.6 5 16c0 2.8 3 5 7 5s7-2.2 7-5c0-1.4-.6-3-1.9-4.7-1-1.4-1.6-2.5-1.6-4C15.5 4.8 14.2 3 12 3Z',
  android: 'M6 9h12v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM6 9a6 6 0 0 1 12 0M8.5 4 7 2M15.5 4 17 2M9.5 6.5h.01M14.5 6.5h.01M4 10v5M20 10v5M9 19v3M15 19v3',
  browser: 'M3 6h18v13H3zM3 10h18M6 8h.01M8.5 8h.01',
  game: 'M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.2 2l1.3-1.5h7l1.3 1.5A3 3 0 0 0 22 15l-.7-6.4a4 4 0 0 0-4-3.6Z',
  puzzle: 'M10 4a2 2 0 1 1 4 0v1h3a1 1 0 0 1 1 1v3h1a2 2 0 1 1 0 4h-1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 1 0-4 0v1H7a1 1 0 0 1-1-1v-3h1a2 2 0 1 0 0-4H6V6a1 1 0 0 1 1-1h3z',
  bag: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0',
  voice: 'M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3',
  download: 'M12 15V3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5',
};
function Mark({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>
  );
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function detectPlatform() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/android/i.test(ua)) return 'android';
  if (/windows/i.test(ua)) return 'windows';
  if (/linux/i.test(ua)) return 'linux';
  return null;
}
const PLATFORM_LABEL = { windows: 'Windows', linux: 'Linux', android: 'Android' };

// Revela blocos ao entrarem na tela (uma vez só).
function useReveal() {
  useEffect(() => {
    if (reducedMotion()) return undefined;
    const lp = document.querySelector('.lp');
    // Só usa a .lp como raiz se ela for quem rola; senão, a janela.
    const root = lp && lp.scrollHeight > lp.clientHeight + 1 ? lp : null;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { root, threshold: 0, rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('.lp-reveal').forEach((el) => io.observe(el));
    lp?.classList.add('is-js');
    return () => { io.disconnect(); lp?.classList.remove('is-js'); };
  }, []);
}


// Roda de canais: os dois de cima e os dois de baixo trocam sozinhos, como
// a lista do app rolando devagar. Parada com "reduzir movimento".
function useWheel() {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return undefined;
    const id = setInterval(() => { if (!document.hidden) setN((x) => x + 1); }, 2600);
    return () => clearInterval(id);
  }, []);
  const at = (k) => WHEEL[(n + k) % WHEEL.length];
  return { n, top: [at(0), at(1)], bottom: [at(2), at(3)] };
}
function WheelSide({ items, n, pos }) {
  return (
    <div className="lc-wheel" aria-hidden="true">
      {items.map((label, i) => {
        const far = pos === 'top' ? i === 0 : i === 1;
        return <span key={`${n}-${pos}-${i}`} className={`lc-ch lc-spin ${far ? 'is-far' : 'is-near'}`} style={{ '--d': `${i * 70}ms` }}><i>#</i>{label}</span>;
      })}
    </div>
  );
}

// Luz que segue o mouse dentro dos cartões (.lc-spot): um ouvinte só pra
// página toda, que escreve a posição no cartão embaixo do ponteiro.
function useSpotlight() {
  useEffect(() => {
    const lp = document.querySelector('.lp');
    if (!lp || !window.matchMedia('(hover: hover)').matches) return undefined;
    let raf = 0;
    const onMove = (e) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = e.target.closest?.('.lc-spot');
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--sx', `${e.clientX - r.left}px`);
        el.style.setProperty('--sy', `${e.clientY - r.top}px`);
      });
    };
    lp.addEventListener('pointermove', onMove, { passive: true });
    return () => { lp.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf); };
  }, []);
}

// Confete saindo do botão de baixar (só elementos soltos, somem sozinhos).
function confettiFrom(el) {
  if (!el || reducedMotion()) return;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2; const y = r.top + r.height / 2;
  const layer = document.createElement('div');
  layer.className = 'lc-confetti';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 26; i += 1) {
    const p = document.createElement('i');
    const ang = (Math.PI * 2 * i) / 26 + Math.random() * 0.4;
    const dist = 70 + Math.random() * 120;
    p.style.left = `${x}px`; p.style.top = `${y}px`;
    p.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(ang) * dist - 60}px`);
    p.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
    p.style.background = CONFETTI[i % CONFETTI.length];
    if (i % 3 === 0) p.style.borderRadius = '50%';
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1300);
}

// Reações de uma mensagem de "Um dia no clube" (só na tela, nada é salvo).
function Reactions({ list }) {
  const [mine, setMine] = useState(() => new Set());
  const toggle = (e) => setMine((m) => { const n = new Set(m); if (n.has(e)) n.delete(e); else n.add(e); return n; });
  return (
    <div className="lc-reacts">
      {list.map(([emoji, count]) => {
        const on = mine.has(emoji);
        return (
          <button key={emoji} type="button" className={`lc-react${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggle(emoji)} aria-label={`Reagir com ${emoji}`}>
            <span aria-hidden="true">{emoji}</span><b key={on ? 'on' : 'off'}>{count + (on ? 1 : 0)}</b>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Dados ao vivo ----------
// Pulso da comunidade (só números agregados) e versão publicada de cada app.
function CommandPalette({ open, onClose, onPickApp, actions }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const items = [
    ...APPS.map((a, i) => ({ key: a.id, label: a.name, hint: a.what, icon: `/apps/${a.id}/icon.png`, run: () => onPickApp(i) })),
    ...actions,
  ].filter((it) => !q || norm(`${it.label} ${it.hint}`).includes(norm(q)));
  const run = (it) => { onClose(); setTimeout(it.run, 30); };
  if (!open) return null;
  return (
    <div className="lp-cmd" role="dialog" aria-modal="true" aria-label="Busca rápida" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lp-cmd-box">
        <input
          ref={inputRef} className="lp-cmd-input" value={q} placeholder="Buscar um app, uma seção ou uma ação"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === 'Enter' && items[sel]) run(items[sel]);
          }}
          aria-activedescendant={items[sel] ? `cmd-${items[sel].key}` : undefined}
        />
        <ul className="lp-cmd-list" role="listbox">
          {items.map((it, i) => (
            <li key={it.key} id={`cmd-${it.key}`} role="option" aria-selected={i === sel} className={i === sel ? 'is-on' : ''} onMouseEnter={() => setSel(i)} onClick={() => run(it)}>
              {it.icon ? <img src={it.icon} alt="" width="28" height="28" /> : <span className="lp-cmd-glyph" aria-hidden="true">{it.glyph}</span>}
              <span><strong>{it.label}</strong><small>{it.hint}</small></span>
            </li>
          ))}
          {items.length === 0 && <li className="lp-cmd-empty">Nada encontrado. Tente "jogos", "download" ou "entrar".</li>}
        </ul>
        <p className="lp-cmd-foot"><kbd>↑</kbd><kbd>↓</kbd> para escolher, <kbd>Enter</kbd> para abrir, <kbd>Esc</kbd> para fechar</p>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  useReveal();
  usePublicScrollChrome();
  useSpotlight();
  const wheel = useWheel();
  const [platform] = useState(detectPlatform);
  const [dlToast, setDlToast] = useState(null);
  const toastTimer = useRef(0);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  // Baixou: confete + aviso do que fazer depois (some sozinho).
  const onDownload = (e, key) => {
    confettiFrom(e.currentTarget);
    setDlToast(key);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setDlToast(null), 6000);
  };
  const [cmdOpen, setCmdOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen((o) => !o); }
      else if (e.key === '/' && !/input|textarea/i.test(document.activeElement?.tagName || '')) { e.preventDefault(); setCmdOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
  // Vindo de outra página pública com "/#secao": rola até a seção.
  useEffect(() => {
    const id = decodeURIComponent((location.hash || '').slice(1));
    if (!id) return undefined;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'auto' }), 60);
    return () => clearTimeout(t);
  }, [location.hash]);
  // Logado (abriu em /site pra ver a vitrine e os downloads): os botões
  // de entrar/criar conta levam de volta pro app.
  const { user } = useAuth() || {};
  const cmdActions = [
    { key: 'go-dl', label: 'Baixar o Project Club', hint: 'Windows, Linux e Android', glyph: '↓', run: () => jump('download') },
    { key: 'go-login', label: user ? 'Voltar pro app' : 'Entrar', hint: user ? 'Você já está logado' : 'Já tenho conta', glyph: '→', run: () => navigate(user ? '/inicio' : '/login') },
    ...(user ? [] : [{ key: 'go-reg', label: 'Criar conta', hint: 'Grátis, leva um minuto', glyph: '+', run: () => navigate('/register') }]),
    { key: 'go-com', label: 'Um dia no clube', hint: 'Chat, voz, Game Hub e loja', glyph: '#', run: () => jump('comunidade') },
    { key: 'go-faq', label: 'Perguntas', hint: 'Preço, requisitos e atualizações', glyph: '?', run: () => jump('perguntas') },
    { key: 'go-blog', label: 'Blog', hint: 'O guia completo do Project Club', glyph: '¶', run: () => navigate('/blog') },
    { key: 'go-terms', label: 'Política de privacidade', hint: 'Termos de uso e dados', glyph: '§', run: () => navigate('/blog/politica-de-privacidade') },
  ];

  const goLogin = () => navigate(user ? '/inicio' : '/login');
  const goRegister = () => navigate(user ? '/inicio' : '/register');

  // Botão principal: baixar pro sistema detectado (ou entrar, se não deu pra saber).
  const mainCta = platform ? (
    <a className="lc-btn is-brand" href={DOWNLOADS[platform]} download onClick={(e) => onDownload(e, platform)}>
      <Mark name="download" size={18} /> Baixar para {PLATFORM_LABEL[platform]}
    </a>
  ) : (
    <button type="button" className="lc-btn is-brand" onClick={goRegister}>{user ? 'Voltar pro app' : 'Criar conta grátis'}</button>
  );
  const others = [
    { key: 'windows', name: 'Windows', href: DOWNLOADS.windows },
    { key: 'linux', name: 'Linux', href: DOWNLOADS.linux },
    { key: 'android', name: 'Android', href: DOWNLOADS.android },
  ].filter((d) => d.key !== platform);

  return (
    <div className="lp lp-mono lp-club lp-classic">
      <a className="lp-skip" href="#conteudo">Pular para o conteúdo</a>
      <div className="lp-progress" aria-hidden="true" />

      <PublicHeader page="inicio" onSearch={() => setCmdOpen(true)} />

      <main id="conteudo">
        {/* Abertura: a lista de canais do app, parada em "project club". */}
        <section className="lc-hero" aria-labelledby="titulo">
          <div className="lc-wrap">
            <div className="lc-aurora" aria-hidden="true"><i /><i /><i /></div>
            <WheelSide items={wheel.top} n={wheel.n} pos="top" />
            <div className="lc-sel">
              <h1 id="titulo" className="lc-ch is-on"><i aria-hidden="true">#</i>project club</h1>
              <div className="lc-go">
                {mainCta}
                <div className="lc-alt">
                  {others.map((d) => <a key={d.key} href={d.href} download onClick={(e) => onDownload(e, d.key)}><Mark name={d.key} size={16} />{d.name}</a>)}
                  <button type="button" onClick={goLogin}><Mark name="browser" size={16} />Navegador</button>
                </div>
              </div>
            </div>
            <WheelSide items={wheel.bottom} n={wheel.n} pos="bottom" />
            <p className="lc-lede">Canais, voz, jogos e a loja da comunidade num app só, no PC, no celular ou no navegador. De graça.</p>
          </div>
          <div className="lc-wrap lc-shot">
            <img src="/apps/projectclub/shots/02-chat.jpg" alt="O Project Club aberto no canal chat geral, com a lista de canais à esquerda e o painel Agora à direita" width="1600" height="1000" />
          </div>
        </section>

        {/* Apps: folha branca subindo por trás da foto. */}
        <section id="apps" className="lc-sheet" aria-labelledby="apps-titulo">
          <div className="lc-wrap">
            <div className="lc-head">
              <h2 id="apps-titulo" className="lp-reveal">Três apps. Uma conta.</h2>
              <p className="lp-reveal">Tudo entra com a mesma conta do Project Club e atualiza sozinho.</p>
            </div>
            <ul className="lc-apps">
              {APPS.map((a, i) => (
                <li key={a.id} className="lp-reveal lc-spot" style={{ '--i': i }}>
                  <img src={`/apps/${a.id}/icon.png`} alt="" width="88" height="88" loading="lazy" />
                  <h3>{a.name}</h3>
                  <span className="lc-what">{a.what}</span>
                  <p>{a.line}</p>
                  <span className="lc-note">{a.note}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Um dia no clube: as partes do app contadas como uma conversa. */}
        <section id="comunidade" className="lc-day" aria-labelledby="com-titulo">
          <div className="lc-wrap lc-day-grid">
            <div className="lc-day-intro">
              <h2 id="com-titulo" className="lp-reveal">Um dia no clube</h2>
              <p className="lp-reveal">Tudo o que a galera faz junto acontece no mesmo lugar. Do primeiro oi até a partida da noite.</p>
            </div>
            <ol className="lc-tl">
              {DAY.map((m, i) => (
                <li key={m.t} className="lp-reveal" style={{ '--i': i }}>
                  <span className="lc-t">{m.t}</span>
                  <span className="lc-av" style={{ background: m.c }} aria-hidden="true">{m.who[0]}</span>
                  <div className="lc-msg">
                    <b style={{ color: m.c }}>{m.who}<time>hoje às {m.t}</time></b>
                    <p>{m.text}</p>
                    {m.card && (
                      <div className="lc-card">
                        <span>Partida no Game Hub</span>
                        <strong>Sobrevivência com o modpack do clube</strong>
                        <i aria-hidden="true" />
                        <small><span>Minecraft Java, 23:00</span><b>6 de 6 vagas</b></small>
                      </div>
                    )}
                    {m.reacts && <Reactions list={m.reacts} />}
                  </div>
                  <span className="lc-tag"><Mark name={m.icon} size={14} />{m.tag}</span>
                </li>
              ))}
              <li className="lc-typing lp-reveal" style={{ '--i': DAY.length }} aria-label="Pingu está digitando">
                <span className="lc-t">23:31</span>
                <span className="lc-av is-pingu" aria-hidden="true">P</span>
                <p><span className="lc-dots" aria-hidden="true"><i /><i /><i /></span><b>Pingu</b> está digitando…</p>
              </li>
            </ol>
          </div>
        </section>

        <section id="download" className="lc-dl" aria-labelledby="dl-titulo">
          <div className="lc-wrap">
            <div className="lc-head is-dark">
              <h2 id="dl-titulo" className="lp-reveal">Escolha o seu sistema</h2>
              <p className="lp-reveal">O app de computador traz o Mod Manager. No celular e no navegador fica tudo o resto.</p>
            </div>
            <ul className="lc-dl-list">
              {[
                { key: 'windows', name: 'Windows', desc: 'Instalador .exe que baixa o app, Windows 10 e 11', href: DOWNLOADS.windows },
                { key: 'linux', name: 'Linux', desc: 'AppImage, roda na maioria das distros', href: DOWNLOADS.linux },
                { key: 'android', name: 'Android', desc: 'Arquivo .apk', href: DOWNLOADS.android },
                { key: 'browser', name: 'Navegador', desc: 'Sem instalar nada' },
              ].map((d, i) => {
                const inner = (
                  <>
                    <span className="lc-dl-name"><Mark name={d.key} size={22} />{d.name}{platform === d.key && <em>seu sistema</em>}</span>
                    <span className="lc-dl-desc">{d.desc}</span>
                    <span className="lc-dl-go">{d.href ? 'Baixar' : (user ? 'Abrir' : 'Entrar')}</span>
                  </>
                );
                return (
                  <li key={d.key} className="lp-reveal" style={{ '--i': i }}>
                    {d.href
                      ? <a className={`lc-dl-row lc-spot${platform === d.key ? ' is-mine' : ''}`} href={d.href} download onClick={(e) => onDownload(e, d.key)}>{inner}</a>
                      : <button type="button" className="lc-dl-row lc-spot" onClick={goLogin}>{inner}</button>}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section id="perguntas" className="lc-faq-sec" aria-labelledby="faq-titulo">
          <div className="lc-wrap lc-faq-grid">
            <h2 id="faq-titulo" className="lp-reveal">Antes de entrar</h2>
            <div>
              <div className="lc-faq">
                {[
                  ['Custa alguma coisa?', 'Não. A conta, a comunidade e os apps são gratuitos, sem anúncio. A Assinatura é opcional e só dá vantagens extras.'],
                  ['Preciso instalar?', 'Só para o Mod Manager. A comunidade funciona no navegador e no Android.'],
                  ['Roda em PC fraco?', 'Sim. Abre em qualquer navegador atual, e o app roda em Windows 10 e 11 e em Linux.'],
                ].map(([q, a], i) => (
                  <details key={q} className="lp-reveal" style={{ '--i': i }}>
                    <summary><span>{q}</span><i aria-hidden="true" /></summary>
                    <div className="lc-faq-a"><p>{a}</p></div>
                  </details>
                ))}
              </div>
              <Link className="lc-more lp-reveal" to="/blog">Mais respostas no Blog</Link>
            </div>
          </div>
        </section>

        <section className="lc-end" aria-labelledby="fim-titulo">
          <div className="lc-wrap">
            <h2 id="fim-titulo" className="lp-reveal">Só falta você no <span className="lc-ch is-on"><i aria-hidden="true">#</i>chat geral</span></h2>
            <div className="lc-end-go lp-reveal">
              {mainCta}
              {!user && <button type="button" className="lc-btn is-line" onClick={goLogin}>Já tenho conta</button>}
            </div>
          </div>
        </section>
      </main>

      {dlToast && (
        <div className="lc-toast" role="status">
          <span className="lc-toast-ico" aria-hidden="true"><Mark name="download" size={18} /></span>
          <span>
            <strong>Download começando{PLATFORM_LABEL[dlToast] ? ` para ${PLATFORM_LABEL[dlToast]}` : ''}</strong>
            <small>{dlToast === 'android' ? 'Abra o .apk e permita instalar apps deste navegador.' : dlToast === 'linux' ? 'Dê permissão de execução ao AppImage e abra.' : 'Abra o instalador, ele baixa o resto e já entra no app.'}</small>
          </span>
          <button type="button" onClick={() => setDlToast(null)} aria-label="Fechar aviso">×</button>
        </div>
      )}

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onPickApp={() => jump('apps')} actions={cmdActions} />

      <PublicFooter page="inicio" />
    </div>
  );
}
