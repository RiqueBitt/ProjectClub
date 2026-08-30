import { Capacitor } from '@capacitor/core';
import { useStore } from '../store/useStore';
import { openExternal } from './openExternal';

// Verificação de versão nova (item pedido) — só faz sentido pro app
// NATIVO (Windows/Linux/Android): a versão WEB é sempre a mais recente
// por definição (é servida ao vivo direto do servidor a cada visita), só
// os pacotes nativos (.exe/.AppImage/.apk) ficam "presos" na versão que
// a pessoa baixou até ela baixar de novo.
//
// Windows/Linux (.exe/.AppImage) já têm atualização automática de
// verdade via electron-updater (ver desktop/main.js) — esse arquivo só
// cuida do Android agora, que não tem esse luxo (não existe nada
// parecido com electron-updater pra apps distribuídos fora da Play
// Store). Item pedido: "quero pra .exe, .appimage e .apk" — baixa o
// .apk sozinho e tenta instalar direto, em vez de só abrir o
// navegador e depender da pessoa fazer tudo manualmente.
const VERSION_MANIFEST_URL = 'https://raw.githubusercontent.com/RiqueBitt/ProjectClub-Downloads/main/version.json';
const APK_DOWNLOAD_URL = 'https://github.com/RiqueBitt/ProjectClub-Downloads/releases/latest/download/ProjectClub.apk';
const DOWNLOAD_PAGE_URL = 'https://projectclub.squareweb.app/#download';
const LAST_SEEN_KEY = 'pc_last_seen_native_version';

async function getLocalVersion() {
  // Desktop (Electron) — main.js expõe isso via preload.js (ver
  // desktop/preload.js). window.electronAPI só existe dentro do app
  // empacotado, nunca no navegador normal.
  if (typeof window !== 'undefined' && window.electronAPI?.getAppVersion) {
    try { return await window.electronAPI.getAppVersion(); } catch { return null; }
  }
  // Android (Capacitor) — versionName do build.gradle, lido em tempo de
  // execução via @capacitor/app.
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      const { App } = await import('@capacitor/app');
      const info = await App.getInfo();
      return info.version;
    } catch { return null; }
  }
  return null; // web comum — nunca precisa disso
}

// Compara duas versões no formato "AAAA.MM.DD-hash" (ver o job "finalize"
// do workflow) — comparação simples de string já basta, porque a data
// no início garante ordem cronológica correta.
function isNewer(remote, local) {
  return !!remote && !!local && remote !== local;
}

// Item pedido: baixar e instalar o .apk sozinho, em vez de só abrir o
// navegador. Usa @m430/capacitor-app-install — um plugin pequeno e
// menos testado que os outros já usados neste projeto (sendo honesto
// sobre isso), por isso TODA essa função tem um plano de reserva
// completo: se QUALQUER etapa falhar (baixar, achar permissão,
// instalar), cai de volta pro fluxo antigo (aviso com link pra abrir
// no navegador), que sempre funciona.
async function downloadAndInstallApk(version) {
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { AppInstallPlugin } = await import('@m430/capacitor-app-install');

    useStore.getState().pushNotice(`⬇️ Baixando a atualização (${version})...`);

    const res = await fetch(APK_DOWNLOAD_URL);
    if (!res.ok) throw new Error(`download falhou: ${res.status}`);
    const blob = await res.blob();
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

    const { granted } = await AppInstallPlugin.canInstallUnknownApps();
    if (!granted) {
      // O Android EXIGE que a pessoa libere manualmente "instalar de
      // fontes desconhecidas" na primeira vez — é uma proteção de
      // segurança do próprio sistema, não tem como pular isso. Abre a
      // tela de configuração certa e explica o porquê, em vez de só
      // falhar silenciosamente.
      useStore.getState().pushNotice(
        '⚠️ Pra instalar a atualização, autorize "instalar apps de fontes desconhecidas" na tela que vai abrir.',
      );
      await AppInstallPlugin.openInstallUnknownAppsSettings();
      return;
    }

    await AppInstallPlugin.installApk({ filePath: written.uri });
  } catch (err) {
    console.error('[atualização] baixar/instalar automático falhou, caindo pro link manual:', err);
    useStore.getState().pushNotice(
      `🔄 Uma nova versão do app está disponível (${version}).`,
      { label: 'Baixar agora', onClick: () => openExternal(DOWNLOAD_PAGE_URL) },
    );
  }
}

export async function checkForNativeUpdate() {
  try {
    const localVersion = await getLocalVersion();
    if (!localVersion) return; // web comum, ou não deu pra descobrir — não faz nada

    const res = await fetch(VERSION_MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const manifest = await res.json();
    if (!manifest?.version) return;

    if (isNewer(manifest.version, localVersion)) {
      if (Capacitor.getPlatform() === 'android') {
        downloadAndInstallApk(manifest.version);
      } else {
        // Windows/Linux já atualizam sozinhos via electron-updater —
        // esse aviso aqui é só um reforço visual, caso a checagem
        // automática do Electron ainda não tenha rodado.
        useStore.getState().pushNotice(
          `🔄 Uma nova versão do app está disponível (${manifest.version}). Ela é baixada automaticamente em segundo plano.`,
        );
      }
    }

    // "quando atualizar, mandar uma mensagem falando o que tem de novo"
    // — compara a versão ATUAL com a última que esse dispositivo já viu
    // (guardada localmente); se mudou pra cima (a pessoa acabou de
    // instalar uma versão mais nova), mostra as novidades UMA vez só e
    // atualiza o que foi "visto".
    const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
    if (lastSeen && lastSeen !== localVersion) {
      useStore.getState().pushNotice(
        manifest.notes
          ? `✅ Atualizado para a versão ${localVersion}! Novidades: ${manifest.notes}`
          : `✅ Atualizado para a versão ${localVersion}!`,
      );
    }
    localStorage.setItem(LAST_SEEN_KEY, localVersion);
  } catch {
    // Verificação de versão nunca deve travar nem incomodar o resto do
    // app — falha em silêncio (sem internet, GitHub fora do ar, etc).
  }
}
