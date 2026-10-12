import { lazy } from 'react';

// Depois de um deploy, uma aba aberta ainda pede os pedaços (chunks) da
// versão antiga, que não existem mais. Antes, main.jsx chamava
// preventDefault() no 'vite:preloadError' — o import() então "resolvia"
// com undefined e o React.lazy estourava "Cannot read properties of
// undefined (reading 'default')" (visto em produção em /channels/:id, no
// seletor de emoji). Agora o erro sobe de verdade e este helper tenta o
// import mais uma vez; se falhar de novo, recarrega a página (uma vez a
// cada 30s, pra nunca entrar em loop).
export const CHUNK_ERROR_RE = /dynamically imported module|Importing a module script failed|error loading dynamically imported|reading 'default'|Failed to fetch dynamically|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed/i;

export function isChunkLoadError(err) {
  return CHUNK_ERROR_RE.test(String(err?.message || err || ''));
}

export function reloadForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem('pc-chunk-reload') || 0);
    if (Date.now() - last < 30000) return false; // evita loop
    sessionStorage.setItem('pc-chunk-reload', String(Date.now()));
  } catch { /* sem storage */ }
  window.location.reload();
  return true;
}

function checkModule(mod) {
  if (!mod || typeof mod !== 'object' || !('default' in mod) || mod.default === undefined) {
    throw new Error("Módulo carregado sem export default (reading 'default')");
  }
  return mod;
}

export function lazyWithRetry(factory) {
  return lazy(async () => {
    try {
      return checkModule(await factory());
    } catch (err) {
      await new Promise((r) => { setTimeout(r, 500); });
      try {
        return checkModule(await factory());
      } catch (err2) {
        if (isChunkLoadError(err2) || isChunkLoadError(err)) reloadForNewVersion();
        throw err2;
      }
    }
  });
}
