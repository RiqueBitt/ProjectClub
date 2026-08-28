import { Capacitor } from '@capacitor/core';
import { useStore } from '../store/useStore';

// Verificação de versão nova (item pedido) — só faz sentido pro app
// NATIVO (Windows/Linux/Android): a versão WEB é sempre a mais recente
// por definição (é servida ao vivo direto do servidor a cada visita), só
// os pacotes nativos (.exe/.AppImage/.apk) ficam "presos" na versão que
// a pessoa baixou até ela baixar de novo. Usa o mesmo sistema de aviso
// (pushNotice) que já existe pro resto do app — sem UI nova pra
// aprender.
const VERSION_MANIFEST_URL = 'https://raw.githubusercontent.com/RiqueBitt/ProjectClub-Downloads/main/version.json';
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

export async function checkForNativeUpdate() {
  try {
    const localVersion = await getLocalVersion();
    if (!localVersion) return; // web comum, ou não deu pra descobrir — não faz nada

    const res = await fetch(VERSION_MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const manifest = await res.json();
    if (!manifest?.version) return;

    if (isNewer(manifest.version, localVersion)) {
      useStore.getState().pushNotice(
        `🔄 Uma nova versão do app está disponível (${manifest.version}). `
        + `Baixe em ${DOWNLOAD_PAGE_URL} pra atualizar.`,
      );
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
