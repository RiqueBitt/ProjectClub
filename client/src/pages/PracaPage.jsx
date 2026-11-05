import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import { enterGameMode, exitGameMode } from '../minijogos/orientation.js';
import { isTouchDevice } from '../minijogos/touch/detect.js';
import { autoLogin, watchEntry } from '../praca/autoLogin.js';
import { gameCacheReady, clearGameCache, installPack, installFiles } from '../praca/installer.js';
import { usePracaVoice, useInGameVoiceButtons, usePracaCoinCap } from '../praca/PracaSocial.jsx';
import { RemoteAudioSinks } from '../components/CallBar.jsx';
import { findMinijogo } from '../minijogos/catalog.js';
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

const RUFFLE_SRC = '/ruffle/ruffle.js?v=pcei02'; // ?v: o Ruffle daqui tem ExternalInterface sem eval
const STAGE = { w: 760, h: 480 };
const MUTE_KEY = 'pc.praca.muted';
const BASE_KEY = 'pc.praca.base'; // versão do jogo instalada neste navegador
const EVENT_KEY = 'pc.praca.event.'; // + chave do evento → pacote baixado

const readLS = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignora */ } };
const fmtMB = (b) => `${Math.max(1, Math.round(b / 1048576))} MB`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Instala um pacote (jogo completo ou evento): no navegador, pelo pacote
 * único gravado no Cache Storage; sem isso, arquivo a arquivo no cache HTTP.
 * Tenta de novo algumas vezes se a rede cair.
 */
async function installBundle(bundle, useCache, { signal, onProgress }) {
  if (useCache && bundle.pack) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await installPack(bundle.pack, { signal, onProgress }); } catch (err) {
        if (err?.name === 'AbortError' || signal?.aborted) throw err;
        lastErr = err; onProgress({ retry: attempt + 1 }); await wait(1500 * (attempt + 1));
      }
    }
    throw lastErr;
  }
  return installFiles(bundle.files, { signal, onProgress });
}

let rufflePromise = null;

function installSwfAddressShim() {
  const noop = () => {};
  window.SWFAddress = {
    getValue: () => '/login', getPath: () => '/login', getIds: () => ['praca'], getStrict: () => true,
    getStatus: () => '', getTitle: () => document.title, getTracker: () => '', getHistory: () => true, getBaseURL: () => '/praca', getAutoUpdate: () => false,
    setValue: noop, setTitle: noop, setStatus: noop, setHistory: noop, setStrict: noop, setTracker: noop, setAutoUpdate: noop, addId: noop, back: noop, forward: noop, up: noop,
    popup: noop, href: noop, onInit: noop, onChange: noop,
  };
}
// Arquivos do jogo que o servidor conserta ou traduz (interface com os botões
// de voz, shell, jornal em português) têm a MESMA URL do original — e cópias
// antigas ficaram guardadas no navegador e na CDN por até 30 dias (o jogo
// abria sem os botões, sem a barra e com o jornal em inglês). O Ruffle baixa
// tudo com fetch(): esses arquivos vão com ?pcf=<versão do servidor> (cópia
// nova a cada versão) e sempre conferindo com o servidor.
const FRESH_GAME_FILES = [
  /\/play\/v2\/content\/global\/content\/interface\.swf(\?|$)/,
  /\/play\/v2\/client\/(shell|catalog_viewer|igloo)\.swf(\?|$)/,
  /\/play\/v2\/content\/local\/[a-z]{2}\/(news|catalogues)\//,
];
function freshUrl(url) {
  const u = new URL(url, window.location.href);
  u.searchParams.set('pcf', String(window.__pcFreshKey || '1'));
  return u.href;
}
function installFreshFetch() {
  if (window.__pcFreshFetch) return;
  const orig = window.fetch.bind(window);
  window.__pcFreshFetch = true;
  window.fetch = (input, init) => {
    try {
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input?.url);
      if (url && FRESH_GAME_FILES.some((re) => re.test(url))) {
        if (input instanceof Request) return orig(new Request(freshUrl(url), input), { cache: 'no-cache' });
        return orig(freshUrl(url), { ...(init || {}), cache: 'no-cache' });
      }
    } catch { /* segue normal */ }
    return orig(input, init);
  };
}

// Conexão do mundo (WebSocket /waddle/ws/world): quando o SERVIDOR derruba
// (deploy, queda de rede, outra aba), o jogo de 2012 só mostra "erro de
// conexão" e fica parado. Aqui a página fica sabendo e reconecta sozinha.
function installWorldSocketWatch() {
  if (window.__pcWsWatch || typeof window.WebSocket !== 'function') return;
  window.__pcWsWatch = true;
  const Orig = window.WebSocket;
  class WatchedWebSocket extends Orig {
    constructor(url, protocols) {
      if (protocols === undefined) super(url); else super(url, protocols);
      if (!/\/waddle\/ws\/world/.test(String(url))) return;
      const opened = Date.now();
      this.addEventListener('close', (ev) => {
        if (this.__pcByClient) return; // o próprio jogo fechou (troca de servidor, sair)
        window.dispatchEvent(new CustomEvent('praca:world-closed', { detail: { code: ev.code, openFor: Date.now() - opened } }));
      });
    }

    close(...args) { this.__pcByClient = true; return super.close(...args); }
  }
  window.WebSocket = WatchedWebSocket;
}

function loadRuffle() {
  installFreshFetch();
  installWorldSocketWatch();
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

export default function PracaPage({ embedded = false }) {
  const { user } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [phase, setPhase] = useState('config'); // config | media | download | install | event | loading | playing | error
  // Voz por proximidade (botões Falar/Ouvir dentro do jogo — ver praca/PracaSocial.jsx)
  const pracaVoice = usePracaVoice({ myUserId: user?.id, active: phase === 'playing' });
  const [media, setMedia] = useState(null); // estado da mídia no servidor (primeira inicialização)
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(readMuted);
  const [full, setFull] = useState(false);

  const [online, setOnline] = useState(0);
  const [scale, setScale] = useState(1);
  const [needsTap, setNeedsTap] = useState(false);
  // entrada automática: 'start' | 'form' | 'server' | 'world' | 'manual' | null
  const [entering, setEntering] = useState(null);
  const [install, setInstall] = useState(null); // progresso da instalação do jogo base / evento
  const [ready, setReady] = useState(null); // config liberada pro Ruffle (depois da instalação)
  const [showBar, setShowBar] = useState(false); // tela cheia no celular: barra aparece por 3 s ao tocar
  const [hint, setHint] = useState(() => { try { return localStorage.getItem('pc.praca.hint') !== '1'; } catch { return true; } });

  const pageRef = useRef(null);
  const stageRef = useRef(null);
  const autoAbort = useRef(null);
  const playerRef = useRef(null);
  const drops = useRef([]); // quando a conexão caiu (evita reconectar em loop)
  const [inWorld, setInWorld] = useState(false); // já entrou na ilha (pode ir pra um minijogo)
  const location = useLocation();
  const navigate = useNavigate();
  // botões Falar/Ouvir DENTRO da barra do jogo (interface.swf ↔ página)
  useInGameVoiceButtons(playerRef, pracaVoice);
  usePracaCoinCap();
  const touch = useMemo(() => isTouchDevice(), []);

  // 0) Antes a página recarregava inteira ao abrir a Praça por dentro do site
  // (o Ruffle usava `new Function` no ExternalInterface e a CSP do site só
  // libera isso no documento /praca). O Ruffle servido aqui (public/ruffle)
  // resolve as chamadas do jogo (nomes como pracaVoiceReady ou
  // SWFAddress.getValue) sem eval — então não precisa mais recarregar.
  const cspOk = true;

  // 1) configuração da sessão (SWF de entrada + ticket + pinguim)
  useEffect(() => {
    if (!cspOk) return undefined;
    let alive = true;
    setPhase('config');
    api.get('/plaza/config').then(({ data }) => {
      if (!alive) return;
      setOnline(data.online || 0);
      setMedia(data.media || null);
      if (data.preparing || (data.media && data.media.state !== 'ready')) {
        // O servidor ainda está baixando/extraindo os arquivos do jogo
        // (só acontece na primeira vez): espera, mostrando o progresso.
        setPhase('media');
        const poll = async () => {
          while (alive) {
            await new Promise((r) => setTimeout(r, 2500));
            try {
              const { data: st } = await api.get('/plaza/status');
              if (!alive) return;
              setMedia(st.media || null);
              if (st.media?.state === 'ready') {
                // agora sim a config completa (entry + ticket)
                const { data: full } = await api.get('/plaza/config');
                if (alive) setCfg(full);
                return;
              }
              if (st.media?.state === 'error') { setError(`Os arquivos do jogo não puderam ser preparados no servidor (${st.media.error || 'erro'}).`); setPhase('error'); return; }
            } catch { /* tenta de novo */ }
          }
        };
        poll();
        return;
      }
      setCfg(data);
    }).catch((err) => {
      if (!alive) return;
      setError(err?.response?.data?.error || 'A Praça está indisponível agora. Tente de novo em instantes.');
      setPhase('error');
    });
    return () => { alive = false; };
  }, []);

  // 1b) instalação. Jogo instalado neste navegador → abre direto, sem tela
  // nenhuma. Senão, mostra o botão "Baixar o jogo completo" (a pessoa decide
  // quando baixar os ~340 MB) ou "Jogar sem baixar" (vem tudo por demanda).
  // Durante festa, o pacote do evento é oferecido do mesmo jeito, uma vez.
  const useCacheRef = useRef(false);
  const installAbort = useRef(null);
  useEffect(() => {
    if (!cfg) return undefined;
    const b = cfg.bundles;
    if (!b || !b.base?.files?.length) { setReady(cfg); return undefined; }
    let alive = true;
    (async () => {
      const useCache = await gameCacheReady();
      if (!alive) return;
      useCacheRef.current = useCache;
      const installed = readLS(BASE_KEY);
      if (installed !== b.version) {
        setPhase('download');
        setInstall({ kind: 'base', name: 'Club Penguin 2012', ratio: 0, total: b.base.bytes, update: !!installed, ask: true });
        return;
      }
      if (b.event && readLS(EVENT_KEY + b.event.key) !== '1') {
        setPhase('event');
        setInstall({ kind: 'event', name: b.event.name, ratio: 0, total: b.event.bytes, ask: true });
        return;
      }
      setReady(cfg);
    })();
    return () => { alive = false; installAbort.current?.abort(); };
  }, [cfg]);

  /** Baixa um pacote (base ou evento) com progresso; depois libera o jogo. */
  const runInstall = useCallback(async (bundle, kind) => {
    const b = cfg?.bundles; if (!b) return;
    const ac = new AbortController(); installAbort.current = ac;
    setPhase(kind === 'base' ? 'install' : 'event');
    setInstall((i) => ({ ...i, ask: false, ratio: 0, bytes: 0, retry: 0 }));
    // Vigia: 90 s sem progresso → abre o jogo assim mesmo (baixa por demanda)
    let lastTick = Date.now();
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastTick > 90_000) { window.clearInterval(watchdog); console.warn('[praca] download travado; abrindo o jogo'); ac.abort(); setReady(cfg); }
    }, 5000);
    try {
      if (kind === 'base' && useCacheRef.current) await clearGameCache(); // versão nova: zera a antiga
      await installBundle(bundle, useCacheRef.current, { signal: ac.signal, onProgress: (p) => { lastTick = Date.now(); setInstall((i) => ({ ...i, ...p })); } });
      if (ac.signal.aborted) return;
      writeLS(kind === 'base' ? BASE_KEY : EVENT_KEY + b.event.key, kind === 'base' ? b.version : '1');
      if (kind === 'base' && b.event && readLS(EVENT_KEY + b.event.key) !== '1') {
        setPhase('event');
        setInstall({ kind: 'event', name: b.event.name, ratio: 0, total: b.event.bytes, ask: true });
        return;
      }
      setReady(cfg);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setError(`O download do jogo falhou (${err?.message || err}). Confira a conexão e tente de novo.`);
      setPhase('error');
    } finally { window.clearInterval(watchdog); }
  }, [cfg]);
  const downloadBase = useCallback(() => runInstall(cfg?.bundles?.base, 'base'), [cfg, runInstall]);
  const downloadEvent = useCallback(() => runInstall(cfg?.bundles?.event, 'event'), [cfg, runInstall]);
  const skipDownload = useCallback(() => { setReady(cfg); }, [cfg]);
  const skipEvent = useCallback(() => { setReady(cfg); }, [cfg]);

  // 2) sobe o Ruffle com o jogo
  useEffect(() => {
    const cfg = ready;
    if (!cfg || !stageRef.current) return undefined;
    let alive = true;
    setPhase('loading');
    const stage = stageRef.current;
    loadRuffle().then((RufflePlayer) => {
      if (!alive) return;
      // socketProxy: cada host:porta que o Flash tenta abrir vira um WebSocket
      // do site, com o ticket da conta na URL.
      window.__pcFreshKey = cfg.fresh || '1';
      const socketProxy = cfg.socketProxy.map((p) => ({ host: p.host, port: p.port, proxyUrl: `${wsBase()}${p.path}?token=${encodeURIComponent(cfg.ticket)}` }));
      // socketProxy é lido da config global na criação do player
      RufflePlayer.config = { ...(RufflePlayer.config || {}), socketProxy, publicPath: '/ruffle/', polyfills: false };
      // O cliente 2012 lê o "estado" inicial pela biblioteca SWFAddress da
      // página (ExternalInterface): respondendo "/login" ele pula a tela de
      // abertura e vai direto ao login — que, com nau/nal, é automático.
      if (cfg.autoEntry === 'flashvars') installSwfAddressShim();
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
        // Nitidez: o Ruffle desenha os vetores na resolução real da tela
        // (devicePixelRatio) e com o melhor anti-aliasing.
        quality: 'best',
        backgroundColor: '#0b2a4a',
        warnOnUnsupportedContent: false,
        showSwfDownload: false,
        contextMenu: 'off',
        allowScriptAccess: true, // o cliente moderno (AS3) usa ExternalInterface pra ler a URL da página
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
        // Entra sozinho: a pessoa já está logada no Project Club.
        const ac = new AbortController();
        autoAbort.current = ac;
        setEntering('start');
        const onStep = (st) => { if (alive) setEntering(st); };
        const entry = cfg.autoEntry === 'flashvars'
          ? watchEntry({ signal: ac.signal, onStep }) // o próprio jogo entra (nau/nal)
          : autoLogin({ player, as3: !!cfg.as3, name: cfg.penguin.name, signal: ac.signal, onStep });
        setInWorld(false);
        entry.then((ok) => {
          if (!alive) return;
          if (ok) setInWorld(true);
          setEntering(ok ? 'world' : 'manual');
          window.setTimeout(() => { if (alive) setEntering(null); }, ok ? 800 : 0);
        });
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
    // Conexão caiu: reconecta (config nova = ticket novo) assim que a ilha voltar
    const onWorldClosed = (ev) => {
      if (!alive) return;
      alive = false; // este player acabou
      const code = ev.detail?.code;
      if (code === 4001) { setError('A Praça foi aberta em outra aba ou aparelho. Feche a outra para jogar aqui.'); setPhase('elsewhere'); return; }
      const now = Date.now();
      drops.current = drops.current.filter((t) => now - t < 120_000).concat(now);
      if (drops.current.length > 3) { setError('A conexão com a ilha está caindo várias vezes. Confira a internet e tente de novo.'); setPhase('error'); return; }
      setPhase('reconnect');
      (async () => {
        for (let i = 0; i < 60; i++) {
          await wait(i === 0 ? 1500 : 3000);
          try {
            const { data } = await api.get('/plaza/config');
            if (data?.entry && data?.ticket && !data.preparing) { setOnline(data.online || 0); setReady(data); return; }
          } catch { /* servidor ainda voltando */ }
        }
        setError('Não deu pra reconectar à ilha agora. Tente de novo em instantes.');
        setPhase('error');
      })();
    };
    window.addEventListener('praca:world-closed', onWorldClosed);
    return () => {
      alive = false;
      window.removeEventListener('praca:world-closed', onWorldClosed);
      try { autoAbort.current?.abort(); } catch { /* ignora */ }
      try { playerRef.current?.remove(); } catch { /* ignora */ }
      playerRef.current = null;
    };
  }, [ready, touch]);

  // Mini-Jogos: /praca?jogo=<slug> entra na ilha e vai direto pro minijogo do
  // próprio Club Penguin (ver minijogos/catalog.js → cp).
  const wantedGame = useMemo(() => {
    try { return findMinijogo(new URLSearchParams(location.search).get('jogo'))?.cp || null; } catch { return null; }
  }, [location.search]);
  useEffect(() => {
    if (!inWorld || !wantedGame) return undefined;
    let alive = true;
    let tries = 0;
    const clearParam = () => {
      const q = new URLSearchParams(location.search);
      q.delete('jogo');
      const rest = q.toString();
      navigate(`${location.pathname}${rest ? `?${rest}` : ''}`, { replace: true });
    };
    const attempt = () => {
      if (!alive) return;
      const p = playerRef.current;
      let ok = false;
      try {
        if (wantedGame.game && typeof p?.pracaJoinGame === 'function') ok = p.pracaJoinGame(wantedGame.game) === true;
        else if (wantedGame.room && typeof p?.pracaJoinRoom === 'function') ok = p.pracaJoinRoom(wantedGame.room, wantedGame.x || 380, wantedGame.y || 300) === true;
      } catch { ok = false; }
      tries += 1;
      if (ok || tries >= 15) { clearParam(); return; }
      window.setTimeout(attempt, 1000);
    };
    const t = window.setTimeout(attempt, 1800); // a sala acabou de carregar
    return () => { alive = false; window.clearTimeout(t); };
  }, [inWorld, wantedGame]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // O player é dimensionado no tamanho REAL em pixels (não ampliado por
      // CSS): o Ruffle desenha os vetores nessa resolução, HUD e textos
      // ficam nítidos em qualquer tela.
      const stage = stageRef.current;
      if (stage) {
        const w = Math.round(STAGE.w * s); const h = Math.round(STAGE.h * s);
        stage.style.width = `${w}px`;
        stage.style.height = `${h}px`;
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(page);
    // o painel de chat/voz abre e fecha ao lado: a arena muda sem a página mudar
    const arena = page.querySelector('.praca-arena');
    if (arena) ro.observe(arena);
    window.addEventListener('orientationchange', update);
    return () => { ro.disconnect(); window.removeEventListener('orientationchange', update); };
  }, [full, phase, embedded]);

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

  // Sair do jogo: no app Android o WebView avisa o app (PracaApp.exit); no
  // site, sai da tela cheia / volta pra página anterior.
  const exitGame = useCallback(() => {
    if (embedded) {
      try { if (window.PracaApp?.exit) { window.PracaApp.exit(); return; } } catch { /* ok */ }
      if (window.history.length > 1) window.history.back(); else window.location.assign('/inicio');
      return;
    }
    if (full) toggleFull();
  }, [embedded, full, toggleFull]);

  const dismissHint = () => { setHint(false); try { localStorage.setItem('pc.praca.hint', '1'); } catch { /* ignora */ } };

  const retry = () => { setError(''); setCfg(null); setReady(null); setPhase('config'); api.get('/plaza/config').then(({ data }) => { setCfg(data); setOnline(data.online || 0); }).catch((err) => { setError(err?.response?.data?.error || 'A Praça está indisponível agora.'); setPhase('error'); }); };

  return (
    <div className={`praca-page${full ? ' is-full' : ''}${touch ? ' is-touch' : ''}${showBar ? ' show-bar' : ''}${embedded ? ' is-embedded' : ''}${(full || embedded) ? ' is-game' : ''}`} ref={pageRef}>
      {full && !touch && <button type="button" className="praca-peek" onClick={peekBar} aria-label="Mostrar controles" />}
      {(full || embedded) && touch && (
        <div className="praca-hud" role="toolbar" aria-label="Controles do jogo">
          <button type="button" className="praca-hud-btn" onClick={() => setMuted((m) => !m)} aria-pressed={muted} aria-label={muted ? 'Ligar o som' : 'Silenciar'}>
            {muted ? (
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM19 3.3 20.7 5 5 20.7 3.3 19 19 3.3z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" /></svg>
            )}
          </button>
          <button type="button" className="praca-hud-btn praca-hud-exit" onClick={exitGame} aria-label="Sair do jogo">
            <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z" /></svg>
          </button>
        </div>
      )}
      <header className="praca-bar">
        <div className="praca-title">
          <span className="praca-logo" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="26" height="26"><ellipse cx="32" cy="36" rx="20" ry="24" fill="currentColor" /><ellipse cx="32" cy="40" rx="12" ry="16" fill="#fff" /><circle cx="25" cy="24" r="4" fill="#fff" /><circle cx="39" cy="24" r="4" fill="#fff" /><circle cx="26" cy="25" r="2" fill="#1c1e21" /><circle cx="40" cy="25" r="2" fill="#1c1e21" /><path d="M27 30 Q32 37 37 30 Q32 33 27 30 Z" fill="#F5A623" /></svg>
          </span>
          <div>
            <h1>Club Penguin</h1>
            <span className="praca-sub">
              {cfg ? <>Você é <strong>{cfg.penguin.name}</strong>{cfg.penguin.member ? ' · membro' : ''}</> : 'A Praça do Project Club'}
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
          {!embedded && <button type="button" className="praca-icon-btn" onClick={toggleFull} aria-pressed={full} title={full ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}>
            {full ? (
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>
            )}
          </button>}
        </div>
      </header>

      <div className="praca-main">
      <div className="praca-arena">
        <div
          className="praca-stage"
          ref={stageRef}
          style={{ width: Math.round(STAGE.w * scale), height: Math.round(STAGE.h * scale) }}
        />
        {/* Sem telas de carregamento: o jogo aparece direto. Só há overlay pra
            decisão (baixar o jogo / evento), download em andamento, servidor
            preparando a mídia na primeira vez e erro. */}
        {(phase === 'download' || phase === 'event' || phase === 'install' || phase === 'media') && (
          <div className={`praca-overlay${install?.ask ? ' is-ask' : ''}`}>
            {!install?.ask && <div className="praca-loader" aria-hidden="true" />}
            {phase === 'download' && (
              <>
                <span className="praca-dl-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="40" height="40"><path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v9.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L11 13.6V4a1 1 0 0 1 1-1zM5 17a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1z" /></svg>
                </span>
                <strong>{install?.update ? 'Atualização do Club Penguin' : 'Baixar o Club Penguin'}</strong>
                <span>
                  {install?.update ? 'Saiu uma versão nova do jogo. ' : ''}
                  Baixe o jogo completo de 2012 uma vez ({fmtMB(install?.total || 0)}): ele fica guardado aqui e, daí em diante, abrir o Club Penguin é só conectar — sem carregamento.
                </span>
                <div className="praca-overlay-actions">
                  <button type="button" className="pet-btn primary praca-dl-btn" onClick={downloadBase}>{install?.update ? 'Atualizar' : 'Baixar o jogo'} · {fmtMB(install?.total || 0)}</button>
                  <button type="button" className="pet-btn" onClick={skipDownload}>Jogar sem baixar</button>
                </div>
                <small className="praca-progress-label">Sem baixar, o jogo busca cada sala e item na hora — funciona, só demora mais.</small>
              </>
            )}
            {phase === 'event' && install?.ask && (
              <>
                <strong>Evento: {install.name}</strong>
                <span>A ilha está em festa! Baixe o conteúdo do evento ({fmtMB(install?.total || 0)}) para ver a decoração, os itens e as salas especiais.</span>
                <div className="praca-overlay-actions">
                  <button type="button" className="pet-btn primary" onClick={downloadEvent}>Baixar evento</button>
                  <button type="button" className="pet-btn" onClick={skipEvent}>Depois</button>
                </div>
              </>
            )}
            {(phase === 'install' || (phase === 'event' && !install?.ask)) && (
              <>
                <strong>{phase === 'install' ? 'Baixando o Club Penguin…' : `Baixando ${install?.name}…`}</strong>
                <span>{phase === 'install' ? 'Uma vez só: depois disso o jogo abre na hora, direto daqui.' : 'O conteúdo do evento está sendo baixado.'}{install?.retry ? ` (tentando de novo, ${install.retry}/3)` : ''}</span>
                <div className="praca-progress" role="progressbar" aria-valuenow={Math.round((install?.ratio || 0) * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.round((install?.ratio || 0) * 100)}%` }} /></div>
                <small className="praca-progress-label">{install?.total ? `${fmtMB(install.bytes || 0)} de ${fmtMB(install.total)}` : `${install?.doneFiles || 0} de ${install?.files || 0} arquivos`} · {Math.round((install?.ratio || 0) * 100)}%</small>
              </>
            )}
            {phase === 'media' && (
              <>
                <strong>Preparando a ilha no servidor…</strong>
                <span>Isso só acontece na primeira vez: o servidor está baixando e extraindo os arquivos do jogo{media?.current ? ` (${media.current})` : ''}.</span>
                {media?.state === 'downloading' && typeof media.progress === 'number' && (
                  <div className="praca-progress" role="progressbar" aria-valuenow={Math.round(media.progress * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.round(media.progress * 100)}%` }} /></div>
                )}
                {media?.state === 'extracting' && <span>Extraindo…</span>}
              </>
            )}
          </div>
        )}
        {phase === 'reconnect' && (
          <div className="praca-overlay" role="status">
            <div className="praca-loader" aria-hidden="true" />
            <strong>Reconectando à ilha…</strong>
            <span>A conexão caiu (o servidor pode ter acabado de atualizar). Você volta pro jogo sozinho em instantes.</span>
          </div>
        )}
        {phase === 'elsewhere' && (
          <div className="praca-overlay is-error" role="alert">
            <strong>Praça aberta em outro lugar</strong>
            <span>{error}</span>
            <button type="button" className="pet-btn primary" onClick={retry}>Jogar aqui</button>
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
      </div>
      {/* App Android (rota /praca/app): fora do app do site não tem a barra de call — o áudio da voz toca daqui */}
      {embedded && <RemoteAudioSinks />}

      {hint && phase === 'playing' && (
        <div className="praca-hint" role="note">
          <span>
            Você entra automaticamente como <strong>{cfg?.penguin.name}</strong>.
            {touch ? ' No celular, use a tela cheia deitada: o jogo escala pra caber.' : ' Clique onde quer andar; o chat é o balão do jogo.'}
          </span>
          <button type="button" className="praca-hint-close" onClick={dismissHint} aria-label="Entendi">✕</button>
        </div>
      )}
    </div>
  );
}
