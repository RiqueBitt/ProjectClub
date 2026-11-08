// Mini-Jogos — "modo jogo" no celular: tela cheia + tela deitada.
//
// Ao abrir um jogo no celular, o toque que abriu o jogo ainda vale como
// gesto do usuário, então dá pra pedir tela cheia no player e, com ela,
// travar a orientação (screen.orientation.lock só funciona em tela cheia
// nos navegadores). No app Android (Capacitor) preferimos o plugin nativo
// @capacitor/screen-orientation quando ele está instalado no app — trava a
// orientação mesmo sem tela cheia do WebView. Tudo é "melhor esforço":
// qualquer falha (iOS, navegador sem suporte, usuário recusou) é ignorada
// e o jogo continua jogável em pé.
//
// Ao sair do jogo (botão Sair, voltar do Android, fechar a aba) a
// orientação é destravada e a tela cheia é encerrada.

let nativePlugin; // undefined = ainda não procurou; null = não tem
function nativeOrientation() {
  if (nativePlugin !== undefined) return nativePlugin;
  nativePlugin = null;
  try {
    const cap = typeof window !== 'undefined' ? window.Capacitor : null;
    if (cap?.isNativePlatform?.() && cap.isPluginAvailable?.('ScreenOrientation')) {
      // registerPlugin do core global: não precisa importar o pacote npm
      // (o build web continua funcionando mesmo sem ele instalado).
      nativePlugin = cap.Plugins?.ScreenOrientation || cap.registerPlugin?.('ScreenOrientation') || null;
    }
  } catch { nativePlugin = null; }
  return nativePlugin;
}

// Só pra testes/depuração: o que foi tentado por último.
const log = [];
if (typeof window !== 'undefined') window.__pcOrientationLog = log;

async function lockWeb(orientation) {
  try {
    const so = window.screen?.orientation;
    if (!so?.lock) return false;
    log.push(`lock:${orientation}`);
    await so.lock(orientation);
    return true;
  } catch { return false; }
}

function unlockWeb() {
  try {
    const so = window.screen?.orientation;
    if (so?.unlock) { log.push('unlock'); so.unlock(); }
  } catch { /* ignora */ }
}

// orientation: 'landscape' | 'portrait' | 'any'
export function enterGameMode(el, { orientation = 'landscape', fullscreen = true } = {}) {
  if (!el) return;
  const want = orientation === 'portrait' ? 'portrait' : orientation === 'any' ? null : 'landscape';
  const native = nativeOrientation();
  if (native && want) {
    log.push(`native-lock:${want}`);
    native.lock({ orientation: want }).catch(() => {});
  }
  const lock = () => { if (want && !native) lockWeb(want); };
  if (!fullscreen) { lock(); return; }
  if (document.fullscreenElement === el) { lock(); return; }
  try {
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) { lock(); return; }
    log.push('fullscreen');
    const p = req.call(el, { navigationUI: 'hide' });
    if (p?.then) p.then(lock, lock); // sem tela cheia o lock costuma falhar, mas tenta mesmo assim
    else lock();
  } catch { lock(); }
}

export function exitGameMode(el) {
  const native = nativeOrientation();
  if (native) { log.push('native-unlock'); native.unlock().catch(() => {}); }
  unlockWeb();
  try {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs && (!el || fs === el || el.contains(fs))) {
      log.push('exit-fullscreen');
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
    }
  } catch { /* ignora */ }
}
