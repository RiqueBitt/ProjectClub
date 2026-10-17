// Áudio da tela (transmitir tela com o som do PC) sem o eco da própria call.
//
// Problema: o 'loopback' do Windows captura TODO o som do PC — inclusive as
// vozes da chamada que o próprio app está tocando. Quem assiste a tela ouvia
// a si mesmo de volta.
//
// Windows: o Chromium ≥ 138 (Electron ≥ 37) entende o id de dispositivo
// 'loopbackWithoutChrome' — captura o som do sistema EXCLUINDO a árvore de
// processos do serviço de áudio do próprio app (API de "process loopback"
// do Windows, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE). Só usamos
// a partir do Windows 10 build 19045 (22H2); abaixo disso, ou num Electron
// mais velho (que trataria o id como um loopback comum), cai pro
// 'loopback' de sempre. Se mesmo assim der problema numa máquina, a
// variável PROJECT_CLUB_SCREEN_AUDIO=loopback volta pro modo antigo.
//
// Linux: não existe loopback que exclua o próprio app. Usamos o venmic
// (@vencord/venmic, MPL-2.0, sem modificações) pra criar um microfone
// virtual no PipeWire ("vencord-screen-share") e ligar nele o som de todos
// os apps, MENOS o do nosso processo de áudio e menos fluxos de entrada
// (microfones). O site pega esse microfone com getUserMedia e manda como o
// áudio da tela. O venmic é carregado só quando precisa, dentro de
// try/catch: se faltar (Windows, arquitetura sem binário, sem PipeWire), o
// app segue normal, só sem essa opção.
//
// Este arquivo não depende do 'electron' no topo — dá pra testar com node puro.
const os = require('os');

// Primeiro build do Windows 10 em que a captura "sem o próprio app" é usada.
const MIN_WIN_BUILD_PROCESS_LOOPBACK = 19045;
// Primeiro Chromium com 'loopbackWithoutChrome' de verdade no Windows
// (media/audio/win/audio_low_latency_input_win.cc, Electron 37).
const MIN_CHROME_PROCESS_LOOPBACK = 138;
// Nome do nó (microfone virtual) que o venmic cria no PipeWire. O rótulo do
// dispositivo no getUserMedia contém esse texto.
const VENMIC_DEVICE_NAME = 'vencord-screen-share';

function windowsBuild(release) {
  const parts = String(release || '').split('.');
  const build = parseInt(parts[2], 10);
  return Number.isFinite(build) ? build : 0;
}

/**
 * Qual "audio" devolver no setDisplayMediaRequestHandler.
 * Retorna 'loopbackWithoutChrome', 'loopback' ou null (só vídeo).
 *
 * PROJECT_CLUB_SCREEN_AUDIO (variável de ambiente, pra diagnóstico):
 *   'loopback' força o loopback comum, 'off' desliga o som do PC,
 *   'nochrome' força 'loopbackWithoutChrome'.
 */
function pickLoopbackAudio({
  platform = process.platform,
  osRelease = os.release(),
  chromeVersion = process.versions.chrome,
  env = process.env,
  linuxVirtualMic = false,
} = {}) {
  const override = String(env?.PROJECT_CLUB_SCREEN_AUDIO || '').toLowerCase();
  if (override === 'off') return null;
  if (override === 'loopback') return 'loopback';
  if (override === 'nochrome') return 'loopbackWithoutChrome';

  if (platform === 'win32') {
    const chromeMajor = parseInt(String(chromeVersion || '0'), 10) || 0;
    if (chromeMajor >= MIN_CHROME_PROCESS_LOOPBACK && windowsBuild(osRelease) >= MIN_WIN_BUILD_PROCESS_LOOPBACK) {
      return 'loopbackWithoutChrome';
    }
    return 'loopback';
  }
  // Linux com o microfone virtual: a tela vai só com vídeo, o site junta o
  // áudio do venmic (sem a call). Sem venmic, mantém o comportamento antigo.
  if (platform === 'linux' && linuxVirtualMic) return null;
  return 'loopback';
}

// ---------- Linux: venmic (PipeWire) ----------
let venmicModule; // undefined = ainda não tentou; null = indisponível
let patchBay = null;
let supportedCache;
let linked = false;

function loadVenmic(requireFn = require) {
  if (venmicModule !== undefined) return venmicModule;
  venmicModule = null;
  if (process.platform !== 'linux') return null;
  try {
    venmicModule = requireFn('@vencord/venmic');
  } catch (err) {
    console.warn('[áudio da tela] venmic indisponível:', err?.message || err);
    venmicModule = null;
  }
  return venmicModule;
}

function isSupported() {
  if (supportedCache !== undefined) return supportedCache;
  supportedCache = false;
  const mod = loadVenmic();
  if (!mod?.PatchBay) return false;
  try {
    supportedCache = !!mod.PatchBay.hasPipeWire();
  } catch (err) {
    console.warn('[áudio da tela] checagem do PipeWire falhou:', err?.message || err);
    supportedCache = false;
  }
  return supportedCache;
}

function getPatchBay() {
  if (patchBay) return patchBay;
  const mod = loadVenmic();
  if (!mod?.PatchBay) return null;
  patchBay = new mod.PatchBay();
  return patchBay;
}

/**
 * Pids do próprio app cujo som NÃO pode ir pro áudio da tela. Preferimos o
 * processo "Audio Service" (é ele que abre os fluxos de som no PipeWire);
 * se não achar, exclui todos os processos do app.
 */
function ownAudioPids(metrics) {
  const list = Array.isArray(metrics) ? metrics : [];
  const audio = list.filter((m) => m && (m.name === 'Audio Service' || m.serviceName === 'audio.mojom.AudioService'));
  const chosen = audio.length ? audio : list;
  const pids = new Set(chosen.map((m) => m?.pid).filter((pid) => Number.isInteger(pid) && pid > 0));
  pids.add(process.pid);
  return [...pids];
}

function buildLinkData(metrics) {
  const exclude = ownAudioPids(metrics).map((pid) => ({ 'application.process.id': String(pid) }));
  // Fluxos de entrada (microfones sendo gravados por qualquer app) nunca.
  exclude.push({ 'media.class': 'Stream/Input/Audio' });
  return { exclude, ignore_devices: true, only_speakers: true };
}

function start(getAppMetrics) {
  if (!isSupported()) return { ok: false, error: 'unsupported' };
  try {
    const bay = getPatchBay();
    if (!bay) return { ok: false, error: 'unsupported' };
    let metrics = [];
    try { metrics = typeof getAppMetrics === 'function' ? getAppMetrics() : []; } catch { metrics = []; }
    const ok = !!bay.link(buildLinkData(metrics));
    linked = ok;
    return ok ? { ok: true, deviceName: VENMIC_DEVICE_NAME } : { ok: false, error: 'link-failed' };
  } catch (err) {
    console.error('[áudio da tela] link falhou:', err);
    return { ok: false, error: String(err?.message || err) };
  }
}

function stop() {
  if (!linked || !patchBay) { linked = false; return { ok: true }; }
  linked = false;
  try { patchBay.unlink(); } catch (err) { console.warn('[áudio da tela] unlink falhou:', err?.message || err); }
  return { ok: true };
}

// Só pra testes.
function _reset() { venmicModule = undefined; patchBay = null; supportedCache = undefined; linked = false; }

module.exports = {
  VENMIC_DEVICE_NAME,
  MIN_WIN_BUILD_PROCESS_LOOPBACK,
  MIN_CHROME_PROCESS_LOOPBACK,
  windowsBuild,
  pickLoopbackAudio,
  ownAudioPids,
  buildLinkData,
  loadVenmic,
  isSupported,
  start,
  stop,
  _reset,
};
