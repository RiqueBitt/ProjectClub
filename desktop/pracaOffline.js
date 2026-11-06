// Club Penguin no próprio computador (modo offline).
//
// Sem internet ou sem o servidor do Project Club, a Praça continua existindo:
// o mesmo Waddle Forever que roda no servidor (server/waddle, MIT) vai
// embutido no app e sobe aqui, num processo filho (praca-offline/host.js),
// só pra este computador — HTTP e WebSockets em 127.0.0.1, numa porta livre.
//
//   - Pinguim: o do arquivo <userData>/offline/praca/<userId>.json (a cópia
//     que o site manda a cada 5 minutos enquanto a pessoa joga online — todos
//     os itens por id, roupas, iglu, puffles, carimbos e saldo). O que
//     acontece offline fica só aqui e é substituído pela próxima cópia.
//   - Mídia: os ~26 mil SWFs (1,7 GB) ficam em <userData>/offline/praca/media.
//     Na primeira vez são baixados da release "waddle-media" do GitHub (precisa
//     de internet, mas NÃO do servidor do Project Club). Depois disso o jogo
//     roda 100% do disco.
//   - Página: /pc-offline/praca.html servida pelo próprio processo (Ruffle
//     embutido no app), aberta num <webview> da tela offline.
//
// Este módulo só liga/desliga o processo e repassa o estado; nada do jogo
// roda no processo principal do Electron.
const path = require('path');
const fs = require('fs');
const { app, utilityProcess } = require('electron');

const STOP_GRACE_MS = 4000;

// Pastas do pacote: em produção vão como extraResources (ver package.json →
// build.extraResources e scripts/prepare-waddle.js); rodando do código-fonte,
// a pasta vendor/waddle (se já foi gerada) ou direto as pastas do repo.
function resourceDir(name, devRelatives) {
  const packaged = path.join(process.resourcesPath || '', name);
  if (process.resourcesPath && fs.existsSync(packaged)) return packaged;
  for (const rel of devRelatives) {
    const dev = path.resolve(__dirname, rel);
    if (fs.existsSync(dev)) return dev;
  }
  return null;
}

function createPracaOffline({ store, log = (m) => console.log(`[praça offline] ${m}`) }) {
  let child = null;
  let state = { status: 'stopped', port: null, media: null, online: 0, error: null, userId: null };
  const listeners = new Set();

  const dataRoot = () => path.join(store.pracaDir, 'data');
  const mediaRoot = () => path.join(store.pracaDir, 'media');

  function setState(patch) {
    state = { ...state, ...patch };
    for (const fn of listeners) { try { fn(state); } catch { /* ouvinte morreu */ } }
  }

  function paths() {
    return {
      waddle: resourceDir('waddle', ['vendor/waddle', '../server/waddle']),
      ruffle: resourceDir('ruffle', ['../client/public/ruffle']),
    };
  }

  /** O app tem o jogo embutido (dist do Waddle + Ruffle)? */
  function available() {
    const p = paths();
    return !!(p.waddle && fs.existsSync(path.join(p.waddle, 'dist', 'server', 'boot.js')) && p.ruffle && fs.existsSync(path.join(p.ruffle, 'ruffle.js')));
  }

  /** Quanto da mídia já está no disco (pra tela mostrar antes de ligar). */
  function mediaOnDisk() {
    try {
      const p = paths();
      const manifest = JSON.parse(fs.readFileSync(path.join(p.waddle, 'media-manifest.json'), 'utf8'));
      const files = Array.isArray(manifest) ? manifest : manifest.files || [];
      const total = files.length;
      let present = 0;
      const root = mediaRoot();
      if (fs.existsSync(root)) {
        // amostra: conferir 26 mil arquivos um a um a cada abertura seria lento
        const step = Math.max(1, Math.floor(total / 400));
        let checked = 0;
        for (let i = 0; i < total; i += step) { checked++; if (fs.existsSync(path.join(root, files[i]))) present++; }
        present = Math.round((present / Math.max(1, checked)) * total);
      }
      return { total, present, bytes: manifest.bytes || 0 };
    } catch { return { total: 0, present: 0, bytes: 0 }; }
  }

  async function start(userId) {
    if (child) { if (state.userId === userId) return state; await stop(); }
    const snapshot = store.getPraca(userId);
    if (!snapshot) { setState({ status: 'error', error: 'Ainda não existe uma cópia do seu pinguim neste computador. Entre na Praça com internet pelo menos uma vez.' }); return state; }
    if (!available()) { setState({ status: 'error', error: 'Esta versão do app veio sem o Club Penguin embutido.' }); return state; }
    const p = paths();
    fs.mkdirSync(dataRoot(), { recursive: true });
    fs.mkdirSync(mediaRoot(), { recursive: true });
    setState({ status: 'starting', port: null, error: null, userId, media: null, online: 0 });
    const env = {
      ...process.env,
      WADDLE_DATA_DIR: dataRoot(),
      WADDLE_MEDIA_DIR: mediaRoot(),
      WADDLE_VERSION: 'auto',
      WADDLE_CALENDAR_YEAR: String(snapshot.game?.calendarYear || 2012),
      PC_OFFLINE_WADDLE: p.waddle,
      PC_OFFLINE_RUFFLE: p.ruffle,
      PC_OFFLINE_SNAPSHOT: store.pracaFile(userId),
      PC_OFFLINE_LANG: 'pt-BR',
    };
    child = utilityProcess.fork(path.join(__dirname, 'praca-offline', 'host.js'), [], { env, serviceName: 'Project Club · Praça offline', stdio: 'pipe' });
    const mine = child;
    mine.stdout?.on('data', (d) => log(String(d).trimEnd()));
    mine.stderr?.on('data', (d) => log(`erro: ${String(d).trimEnd()}`));
    mine.on('message', (msg) => {
      if (mine !== child || !msg || typeof msg !== 'object') return;
      if (msg.type === 'ready') setState({ status: 'running', port: msg.port, media: msg.media || state.media });
      else if (msg.type === 'media') setState({ media: msg.media });
      else if (msg.type === 'online') setState({ online: msg.online || 0 });
      else if (msg.type === 'error') setState({ status: 'error', error: msg.error });
      else if (msg.type === 'restart') { const uid = state.userId; stop().then(() => start(uid)).catch(() => {}); }
    });
    mine.on('exit', (code) => {
      if (mine !== child) return;
      child = null;
      setState({ status: state.status === 'error' ? 'error' : 'stopped', port: null, online: 0, error: state.error || (code ? `o jogo fechou (código ${code})` : null) });
    });
    return state;
  }

  function stop() {
    if (!child) { setState({ status: 'stopped', port: null, online: 0 }); return Promise.resolve(); }
    const mine = child;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { try { mine.kill(); } catch { /* já saiu */ } }, STOP_GRACE_MS);
      mine.once('exit', () => { clearTimeout(timer); resolve(); });
      try { mine.postMessage({ type: 'stop' }); } catch { try { mine.kill(); } catch { /* ok */ } }
    });
  }

  /** URL da página do jogo (só com o processo rodando). */
  function pageUrl() {
    return state.port ? `http://127.0.0.1:${state.port}/pc-offline/praca.html` : null;
  }

  return {
    start, stop, available, mediaOnDisk, pageUrl,
    getState: () => ({ ...state, available: available(), pageUrl: pageUrl() }),
    onState: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    dispose: () => stop(),
  };
}

module.exports = { createPracaOffline };
