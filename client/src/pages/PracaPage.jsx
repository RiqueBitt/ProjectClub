import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import { enterGameMode, exitGameMode } from '../minijogos/orientation.js';
import { isTouchDevice } from '../minijogos/touch/detect.js';
import '../styles/praca.css';

// Praça = Club Penguin completo, rodando em cima do Waddle Forever embutido no
// servidor (server/waddle, MIT). O jogo original é Flash; aqui ele roda no
// Ruffle (emulador em WebAssembly servido pelo próprio site em /ruffle) DIRETO
// nesta página — o <ruffle-player> é um elemento desta árvore, não um iframe.
//
// Como conversa com o servidor:
//  - Arquivos do jogo (SWFs, catálogos, salas): caminhos absolutos do site
//    (/boots.swf, /play/v2/...), servidos pelo Express do Project Club.
//  - Login/mundo: o Flash abre XMLSocket pra "127.0.0.1:2410x"; o Ruffle
//    encaminha pelo socketProxy pra wss://<site>/waddle/ws/{login,world},
//    autenticado com o ticket da conta (/api/plaza/config). O servidor força
//    o pinguim da conta — o que a pessoa digita na tela de login não importa.
//
// A identidade do Project Club fica em volta: barra com nome do pinguim,
// moedas, quem está online, mudo, tela cheia; e o palco do jogo escala pra
// caber em qualquer tela (celular inclusive, deitado em tela cheia).

const RUFFLE_SRC = '/ruffle/ruffle.js';
const STAGE = { w: 760, h: 480 };
const MUTE_KEY = 'pc.praca.muted';

let rufflePromise = null;
function loadRuffle() {
  if (window.RufflePlayer?.newest) return Promise.resolve(window.RufflePlayer);
  if (!rufflePromise) {
    rufflePromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = RUFFLE_SRC;
      s.async = true;
      s.onload = () => (window.RufflePlayer?.newest ? resolve(window.RufflePlayer) : reject(new Error('Ruffle não carregou')));
      s.onerror = () => reject(new Error('Ruffle não carregou'));
      document.head.appendChild(s);
    }).catch((err) => { rufflePromise = null; throw err; });
  }
  return rufflePromise;
}

const wsBase = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

function readMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export default function PracaPage() {
  const { user } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [phase, setPhase] = useState('config'); // config | loading | playing | error
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(readMuted);
  const [full, setFull] = useState(false);
  const [online, setOnline] = useState(0);
  const [scale, setScale] = useState(1);
  const [needsTap, setNeedsTap] = useState(false);
  const [showBar, setShowBar] = useState(false); // tela cheia no celular: barra aparece por 3 s ao tocar
  const [hint, setHint] = useState(() => { try { return localStorage.getItem('pc.praca.hint') !== '1'; } catch { return true; } });

  const pageRef = useRef(null);
  const stageRef = useRef(null);
  const playerRef = useRef(null);
  const touch = useMemo(() => isTouchDevice(), []);

  // 1) configuração da sessão (SWF de entrada + ticket + pinguim)
  useEffect(() => {
    let alive = true;
    setPhase('config');
    api.get('/plaza/config').then(({ data }) => {
      if (!alive) return;
      setCfg(data);
      setOnline(data.online || 0);
    }).catch((err) => {
      if (!alive) return;
      setError(err?.response?.data?.error || 'A Praça está indisponível agora. Tente de novo em instantes.');
      setPhase('error');
    });
    return () => { alive = false; };
  }, []);

  // 2) sobe o Ruffle com o jogo
  useEffect(() => {
    if (!cfg || !stageRef.current) return undefined;
    let alive = true;
    setPhase('loading');
    const stage = stageRef.current;
    loadRuffle().then((RufflePlayer) => {
      if (!alive) return;
      // socketProxy: cada host:porta que o Flash tenta abrir vira um WebSocket
      // do site, com o ticket da conta na URL.
      const socketProxy = cfg.socketProxy.map((p) => ({ host: p.host, port: p.port, proxyUrl: `${wsBase()}${p.path}?token=${encodeURIComponent(cfg.ticket)}` }));
      // socketProxy é lido da config global na criação do player
      RufflePlayer.config = { ...(RufflePlayer.config || {}), socketProxy, publicPath: '/ruffle/', polyfills: false };
      const player = RufflePlayer.newest().createPlayer();
      playerRef.current = player;
      player.className = 'praca-player';
      stage.replaceChildren(player);
      player.addEventListener('loadedmetadata', () => { if (alive) setPhase('playing'); });
      (typeof player.ruffle === 'function' ? player.ruffle() : player).load({
        url: cfg.entry.swf,
        parameters: cfg.entry.flashvars,
        base: '/',
        autoplay: 'on',
        unmuteOverlay: 'hidden',
        splashScreen: false,
        letterbox: 'on',
        scale: 'showAll',
        backgroundColor: '#0b2a4a',
        warnOnUnsupportedContent: false,
        showSwfDownload: false,
        contextMenu: 'off',
        allowScriptAccess: false,
        allowNetworking: 'all',
        openUrlMode: 'deny',
        logLevel: 'error',
        locale: 'pt-BR',
        publicPath: '/ruffle/',
        polyfills: false,
        socketProxy,
      }).then(() => {
        if (!alive) return;
        setPhase('playing');
        try { player.volume = readMuted() ? 0 : 1; } catch { /* ignora */ }
        // Som: o navegador só libera áudio depois de um gesto — se o jogo
        // abriu sem gesto (ex.: F5), pede um toque.
        try { if (player.suspended) setNeedsTap(true); } catch { /* ignora */ }
      }).catch((err) => {
        if (!alive) return;
        setError(`Não deu pra abrir o jogo (${err?.message || err}).`);
        setPhase('error');
      });
    }).catch((err) => {
      if (!alive) return;
      setError(err.message);
      setPhase('error');
    });
    return () => {
      alive = false;
      try { playerRef.current?.remove(); } catch { /* ignora */ }
      playerRef.current = null;
    };
  }, [cfg, touch]);

  // 3) escala do palco: cabe na área disponível mantendo 760x480
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return undefined;
    const update = () => {
      const area = page.querySelector('.praca-arena');
      if (!area) return;
      const r = area.getBoundingClientRect();
      const s = Math.min(r.width / STAGE.w, r.height / STAGE.h);
      setScale(Math.max(0.2, s));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(page);
    window.addEventListener('orientationchange', update);
    return () => { ro.disconnect(); window.removeEventListener('orientationchange', update); };
  }, [full, phase]);

  // mudo
  useEffect(() => {
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignora */ }
    try { if (playerRef.current) playerRef.current.volume = muted ? 0 : 1; } catch { /* ignora */ }
  }, [muted, phase]);

  // quem está online (a cada 30 s)
  useEffect(() => {
    const id = window.setInterval(() => {
      api.get('/plaza/status').then(({ data }) => setOnline(data.online || 0)).catch(() => {});
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // tela cheia (no celular, deitada)
  const toggleFull = useCallback(async () => {
    const el = pageRef.current;
    if (!el) return;
    if (!full) {
      setFull(true);
      await enterGameMode(el, { orientation: 'landscape', fullscreen: true });
    } else {
      setFull(false);
      await exitGameMode(el);
    }
  }, [full]);
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => { document.removeEventListener('fullscreenchange', onChange); exitGameMode(pageRef.current); };
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && full) toggleFull(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full, toggleFull]);

  // Tela cheia no toque: um toque na borda de cima mostra a barra por 3 s.
  const barTimer = useRef(0);
  const peekBar = useCallback(() => {
    if (!full) return;
    setShowBar(true);
    window.clearTimeout(barTimer.current);
    barTimer.current = window.setTimeout(() => setShowBar(false), 3000);
  }, [full]);
  useEffect(() => () => window.clearTimeout(barTimer.current), []);

  const resumeAudio = () => {
    setNeedsTap(false);
    try { playerRef.current?.play?.(); } catch { /* ignora */ }
    try { playerRef.current?.resume?.(); } catch { /* ignora */ }
  };

  const dismissHint = () => { setHint(false); try { localStorage.setItem('pc.praca.hint', '1'); } catch { /* ignora */ } };

  const retry = () => { setError(''); setCfg(null); setPhase('config'); api.get('/plaza/config').then(({ data }) => { setCfg(data); setOnline(data.online || 0); }).catch((err) => { setError(err?.response?.data?.error || 'A Praça está indisponível agora.'); setPhase('error'); }); };

  return (
    <div className={`praca-page${full ? ' is-full' : ''}${touch ? ' is-touch' : ''}${showBar ? ' show-bar' : ''}`} ref={pageRef}>
      {full && <button type="button" className="praca-peek" onClick={peekBar} aria-label="Mostrar controles" />}
      <header className="praca-bar">
        <div className="praca-title">
          <span className="praca-logo" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="26" height="26"><ellipse cx="32" cy="36" rx="20" ry="24" fill="currentColor" /><ellipse cx="32" cy="40" rx="12" ry="16" fill="#fff" /><circle cx="25" cy="24" r="4" fill="#fff" /><circle cx="39" cy="24" r="4" fill="#fff" /><circle cx="26" cy="25" r="2" fill="#1c1e21" /><circle cx="40" cy="25" r="2" fill="#1c1e21" /><path d="M27 30 Q32 37 37 30 Q32 33 27 30 Z" fill="#F5A623" /></svg>
          </span>
          <div>
            <h1>Praça</h1>
            <span className="praca-sub">
              {cfg ? <>Você é <strong>{cfg.penguin.name}</strong>{cfg.penguin.member ? ' · membro' : ''}</> : 'Club Penguin do Project Club'}
            </span>
          </div>
        </div>
        <div className="praca-stats" aria-live="polite">
          <span className="praca-chip" title="Pinguins na ilha agora"><i className="praca-dot" />{online} online</span>
          {cfg && <span className="praca-chip praca-coins" title="Moedas do pinguim">🪙 {cfg.penguin.coins.toLocaleString('pt-BR')}</span>}
          {cfg?.version && <span className="praca-chip praca-year" title="Época do jogo">{cfg.version.slice(0, 4)}</span>}
        </div>
        <div className="praca-actions">
          <button type="button" className="praca-icon-btn" onClick={() => setMuted((m) => !m)} aria-pressed={muted} title={muted ? 'Ligar o som' : 'Silenciar'}>
            {muted ? (
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM19 3.3 20.7 5 5 20.7 3.3 19 19 3.3z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" /></svg>
            )}
          </button>
          <button type="button" className="praca-icon-btn" onClick={toggleFull} aria-pressed={full} title={full ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}>
            {full ? (
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>
            )}
          </button>
        </div>
      </header>

      <div className="praca-arena">
        <div
          className="praca-stage"
          ref={stageRef}
          style={{ width: STAGE.w, height: STAGE.h, '--praca-scale': scale }}
        />
        {phase !== 'playing' && phase !== 'error' && (
          <div className="praca-overlay">
            <div className="praca-loader" aria-hidden="true" />
            <strong>{phase === 'config' ? 'Preparando seu pinguim…' : 'Carregando a ilha…'}</strong>
            <span>Na primeira vez pode demorar um pouco: o jogo inteiro vem pro seu navegador.</span>
          </div>
        )}
        {phase === 'error' && (
          <div className="praca-overlay is-error" role="alert">
            <strong>A Praça não abriu</strong>
            <span>{error}</span>
            <button type="button" className="pet-btn primary" onClick={retry}>Tentar de novo</button>
          </div>
        )}
        {phase === 'playing' && needsTap && (
          <button type="button" className="praca-tap" onClick={resumeAudio}>Toque para ligar o som</button>
        )}
      </div>

      {hint && phase === 'playing' && (
        <div className="praca-hint" role="note">
          <span>
            Clique na tela de login e entre com qualquer senha — você sempre entra como <strong>{cfg?.penguin.name}</strong>.
            {touch ? ' No celular, use a tela cheia deitada: o jogo escala pra caber.' : ' Clique onde quer andar; o chat é o balão do jogo.'}
          </span>
          <button type="button" className="praca-hint-close" onClick={dismissHint} aria-label="Entendi">✕</button>
        </div>
      )}
    </div>
  );
}
