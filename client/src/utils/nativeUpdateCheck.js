import { Capacitor } from '@capacitor/core';
import { useStore } from '../store/useStore';
import { openExternal } from './openExternal';
import { isNewer } from './versionCompare';

// Atualizações dos apps nativos — ver docs/android-updates.md.
//
// ANDROID: o app NÃO embala o site — ele abre https://projectclub.squareweb.app
// ao vivo (server.url em client/capacitor.config.json). Então o CONTEÚDO
// (telas, correções, recursos novos) chega sozinho a cada deploy do site,
// sem baixar .apk nenhum. Este arquivo:
//   1. Pergunta ao servidor (GET /api/mobile/update) se a parte NATIVA
//      instalada ainda serve. Só quando ela é mais velha que a
//      "minNativeVersion" (plugin/código nativo novo — ver o passo
//      "Impressão digital da parte nativa" do build-apps.yml) é que baixa
//      e instala o .apk novo. Antes, TODA release pedia um .apk novo, mesmo
//      quando só o site tinha mudado.
//   2. Ao voltar pro app (resume) depois de um deploy, recarrega a página
//      pra pegar o conteúdo novo — nunca no meio de uma chamada de voz.
//
// WINDOWS/LINUX: electron-updater (desktop/main.js) já atualiza sozinho;
// aqui é só um aviso de reforço.

const RELEASES_URL = 'https://api.github.com/repos/RiqueBitt/ProjectClub/releases/latest';
const APK_DOWNLOAD_URL = 'https://github.com/RiqueBitt/ProjectClub/releases/latest/download/ProjectClub.apk';
const DOWNLOAD_PAGE_URL = 'https://projectclub.squareweb.app/#download';
const LAST_SEEN_KEY = 'pc_last_seen_native_version';
const RESUME_CHECK_MIN_GAP_MS = 5 * 60 * 1000;

// Versão do conteúdo que está rodando agora (gerada no build — vite.config.js).
// eslint-disable-next-line no-undef
export const WEB_VERSION = typeof __WEB_VERSION__ !== 'undefined' ? __WEB_VERSION__ : '';

const isAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export async function getNativeVersion() {
  if (typeof window !== 'undefined' && window.electronAPI?.getAppVersion) {
    try { return await window.electronAPI.getAppVersion(); } catch { return null; }
  }
  if (isAndroid()) {
    try {
      const { App } = await import('@capacitor/app');
      const info = await App.getInfo();
      return info.version; // versionName do build.gradle (= tag da release)
    } catch { return null; }
  }
  return null;
}

// Baixa uma URL mostrando progresso. Lê o corpo em streaming pra conseguir a
// porcentagem (fetch().blob() não dá progresso nenhum). onProgress recebe a
// porcentagem inteira (0–100) quando o tamanho total é conhecido
// (Content-Length), ou null quando não é — aí a barra fica indeterminada em
// vez de presa em 0%. Também cai pra indeterminado se nada chegar nos
// primeiros 4s. Sem suporte a stream, baixa de uma vez (sem progresso).
async function downloadWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download falhou: ${res.status}`);
  if (!res.body || typeof res.body.getReader !== 'function') return res.blob();
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0; let gotAny = false; let lastPct = -1;
  const stallTimer = setTimeout(() => { if (!gotAny) onProgress(null); }, 4000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) {
        gotAny = true; chunks.push(value); received += value.length;
        if (total > 0) {
          const pct = Math.max(0, Math.min(100, Math.round((received / total) * 100)));
          if (pct !== lastPct) { lastPct = pct; onProgress(pct); }
        } else { onProgress(null); }
      }
    }
  } finally { clearTimeout(stallTimer); }
  return new Blob(chunks);
}

// Plugin de instalar .apk (@m430/capacitor-app-install). Qualquer falha cai
// no aviso com link pro navegador, que sempre funciona.
async function downloadAndInstallApk(version, apkUrl) {
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { AppInstallPlugin } = await import('@m430/capacitor-app-install');

    const store = useStore.getState();
    const label = `⬇️ Baixando a atualização (${version})`;
    // Começa JÁ indeterminado (barra animada), nunca um "0%" congelado.
    store.setDownloadProgress({ indeterminate: true }, label);
    const blob = await downloadWithProgress(apkUrl || APK_DOWNLOAD_URL, (pc) => {
      if (pc == null) store.setDownloadProgress({ indeterminate: true }, label);
      else store.setDownloadProgress({ percent: pc }, `${label} — ${pc}%`);
    });
    store.setDownloadProgress({ indeterminate: true }, '📦 Preparando a instalação…');
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const written = await Filesystem.writeFile({
      path: 'ProjectClub-update.apk',
      data: base64,
      directory: Directory.Cache,
    });

    useStore.getState().clearDownloadProgress();

    const { granted } = await AppInstallPlugin.canInstallUnknownApps();
    if (!granted) {
      // O Android exige liberar "instalar de fontes desconhecidas" na
      // primeira vez — proteção do próprio sistema, não dá pra pular.
      useStore.getState().pushNotice(
        '⚠️ Pra instalar a atualização, autorize "instalar apps de fontes desconhecidas" na tela que vai abrir.',
      );
      await AppInstallPlugin.openInstallUnknownAppsSettings();
      return;
    }

    await AppInstallPlugin.installApk({ filePath: written.uri });
  } catch (err) {
    console.error('[atualização] baixar/instalar automático falhou, caindo pro link manual:', err);
    useStore.getState().clearDownloadProgress();
    useStore.getState().pushNotice(
      `🔄 Uma nova versão do app está disponível (${version}).`,
      { label: 'Baixar agora', onClick: () => openExternal(DOWNLOAD_PAGE_URL) },
    );
  }
}

async function fetchMobileUpdate(nativeVersion) {
  const qs = new URLSearchParams({ native: nativeVersion || '', current: WEB_VERSION || '' });
  const r = await fetch(`/api/mobile/update?${qs}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Recarrega pra pegar o conteúdo novo — só quando é seguro.
function reloadForNewContent() {
  if (window.__pcInCall) return false; // nunca derruba uma chamada de voz
  try {
    const last = Number(sessionStorage.getItem('pc-content-reload') || 0);
    if (Date.now() - last < 60 * 1000) return false; // evita loop
    sessionStorage.setItem('pc-content-reload', String(Date.now()));
  } catch { /* sem storage */ }
  useStore.getState().pushNotice('🔄 Atualizando o conteúdo do app…');
  setTimeout(() => window.location.reload(), 600);
  return true;
}

// Checagem do Android. `reloadIfNewContent` só no resume/manual — na
// abertura a página acabou de carregar (index.html é sempre revalidado).
// Devolve o resultado (usado pela tela de Configurações).
export async function checkAndroidUpdate({ reloadIfNewContent = false } = {}) {
  const nativeVersion = await getNativeVersion();
  const info = await fetchMobileUpdate(nativeVersion);
  if (info.nativeUpdateRequired) {
    downloadAndInstallApk(info.latestNativeVersion || '', info.apkUrl);
    return { ...info, action: 'native' };
  }
  if (info.webUpdate && reloadIfNewContent) {
    return { ...info, action: reloadForNewContent() ? 'reload' : 'reload-later' };
  }
  return { ...info, action: 'none' };
}

let resumeListenerAdded = false;
let lastResumeCheck = 0;
async function watchResume() {
  if (resumeListenerAdded) return;
  resumeListenerAdded = true;
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('resume', () => {
      if (Date.now() - lastResumeCheck < RESUME_CHECK_MIN_GAP_MS) return;
      lastResumeCheck = Date.now();
      checkAndroidUpdate({ reloadIfNewContent: true }).catch(() => {});
    });
  } catch { /* sem @capacitor/app — só checa na abertura */ }
}

// "Atualizado para a versão X" — uma vez, quando a parte nativa muda.
function announceNativeVersionChange(localVersion, notes) {
  try {
    const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
    if (lastSeen && lastSeen !== localVersion) {
      useStore.getState().pushNotice(
        notes ? `✅ Atualizado para a versão ${localVersion}! Novidades: ${notes}` : `✅ Atualizado para a versão ${localVersion}!`,
      );
    }
    localStorage.setItem(LAST_SEEN_KEY, localVersion);
  } catch { /* sem storage */ }
}

export async function checkForNativeUpdate() {
  try {
    const localVersion = await getNativeVersion();
    if (!localVersion) return; // web comum — o site já é sempre o mais novo

    if (isAndroid()) {
      lastResumeCheck = Date.now();
      watchResume();
      await checkAndroidUpdate().catch(() => {});
      announceNativeVersionChange(localVersion, '');
      return;
    }

    // Desktop (Electron): só um aviso de reforço — quem atualiza é o
    // electron-updater. Primeiro pelo servidor (cópia das releases), GitHub
    // como plano B.
    let rel = null;
    try {
      const r = await fetch('/api/app-catalog/releases/ProjectClub', { cache: 'no-store' });
      if (r.ok) {
        const list = await r.json();
        rel = (Array.isArray(list) ? list : []).find((x) => !x.prerelease && /^v?\d+\.\d+\.\d+$/.test(x.tag_name || '')) || null;
      }
    } catch { /* segue para o GitHub */ }
    if (!rel) {
      const res = await fetch(RELEASES_URL, { cache: 'no-store' });
      if (!res.ok) return;
      rel = await res.json();
    }
    const version = rel?.tag_name;
    if (!version) return;
    if (isNewer(version, localVersion)) {
      useStore.getState().pushNotice(
        `🔄 Uma nova versão do app está disponível (${version}). Ela é baixada automaticamente em segundo plano.`,
      );
    }
    announceNativeVersionChange(localVersion, (rel?.body || '').trim());
  } catch {
    // Nunca trava nem incomoda o resto do app (sem internet, GitHub fora etc).
  }
}
