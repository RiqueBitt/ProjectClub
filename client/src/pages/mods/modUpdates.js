import { useCallback, useEffect, useRef, useState } from 'react';
import { getMod, getModDownload, getThunderstorePackage, getNexusMod } from '../../api/endpoints';
import {
  installModLocally, installThunderstorePackageLocally, scanInstalledModsLocally, setModEnabledLocally, modFolderName,
} from '../../utils/mods';
import { useLiveRefresh, sameData } from '../../utils/liveRefresh';
import { installNexusFile, nexusIds } from './NexusViews.jsx';
import { checkModUpdates } from './unifiedApi.js';

// Atualizações de mods (item pedido: "mods desatualizados"). Só vale pra
// mods instalados PELO Project Club — o manifesto local guarda de onde o
// mod veio (source/sourceId) e a versão; o servidor diz qual é a mais nova.

const CHECKABLE = new Set(['modio', 'thunderstore', 'nexus']);
export const updateKey = (item) => `${item.source}:${item.sourceId}`;

// Itens da varredura (scanInstalled) que dá pra checar.
export function checkableItems(items) {
  return (items || []).filter((i) => i.managedByProjectClub && !i.adopted && i.source && i.sourceId && i.version && CHECKABLE.has(i.source));
}

// → { [source:sourceId]: { latestVersion, updateAvailable, needsAccount, ... } }
export async function checkUpdatesForItems(game, items) {
  const list = checkableItems(items);
  if (list.length === 0) return {};
  const d = await checkModUpdates(game.steamAppId, list.map((i) => ({ source: i.source, sourceId: i.sourceId, version: i.version })), game.displayName);
  return d.results || {};
}

// Lista final de atualizações de um jogo (item da varredura + info nova).
export function pendingUpdates(items, results) {
  return checkableItems(items)
    .map((i) => ({ ...i, update: results[updateKey(i)] }))
    .filter((i) => i.update?.updateAvailable);
}

const isLoaderPackage = (name) => /bepinexpack/i.test(name || '');

// Atualiza UM mod reinstalando a versão mais nova por cima (o app desktop
// troca só os arquivos dele). mgr = useModsManager() (progresso/toasts).
// Volta { status: 'updated' | 'skipped', reason? } ou lança erro.
export async function updateInstalledMod({ game, row, mgr }) {
  if (!game.installPath) throw new Error('Não sabemos onde este jogo está instalado.');
  const modName = row.name;
  const wasDisabled = row.enabled === false;
  let id = null;
  try {
    if (row.source === 'modio') {
      const modioGameId = game.sources?.modio?.modioGameId;
      if (!modioGameId) return { status: 'skipped', reason: 'Este mod não está mais disponível para este jogo.' };
      id = Number(row.sourceId);
      const { mod } = await getMod(modioGameId, id);
      mgr?.trackInstall(id, mod?.name || modName);
      const download = await getModDownload(modioGameId, id);
      const r = await installModLocally({
        downloadUrl: download.downloadUrl, filename: download.filename, gameInstallPath: game.installPath, modName, modioModId: id,
        steamAppId: game.steamAppId, source: 'modio', sourceId: id, version: mod?.modfile?.version || null,
      });
      if (!r.success) throw new Error(r.error || 'falha desconhecida');
    } else if (row.source === 'thunderstore') {
      const community = game.sources?.thunderstore?.thunderstoreCommunity;
      if (!community) return { status: 'skipped', reason: 'Este mod não está mais disponível para este jogo.' };
      const d = await getThunderstorePackage(community, row.sourceId);
      const pkg = d.package;
      if (!pkg?.version?.downloadUrl) return { status: 'skipped', reason: 'Sem arquivo pra baixar.' };
      // Dependências novas que ainda não estão instaladas vêm antes.
      const deps = (d.dependencies || []).filter((p) => !mgr?.installedFolders?.has(modFolderName(p.fullName)));
      const queue = [...deps, { fullName: pkg.fullName, name: pkg.name, downloadUrl: pkg.version.downloadUrl, versionNumber: pkg.version.versionNumber }];
      for (const p of queue) {
        id = p.fullName;
        mgr?.trackInstall(p.fullName, p.name);
        const r = await installThunderstorePackageLocally({
          downloadUrl: p.downloadUrl, filename: `${p.fullName}.zip`, gameInstallPath: game.installPath, fullName: p.fullName,
          isLoader: isLoaderPackage(p.name), steamAppId: game.steamAppId, version: p.versionNumber || undefined,
        });
        if (!r.success) throw new Error(`${p.name}: ${r.error || 'falha desconhecida'}`);
        mgr?.completeInstall(p.fullName);
      }
      id = null;
    } else if (row.source === 'nexus') {
      const { domain, modId } = nexusIds(row.sourceId);
      if (!domain || !modId) return { status: 'skipped', reason: 'Mod inválido.' };
      const { mod } = await getNexusMod(domain, modId);
      const file = (mod?.files || []).find((f) => f.primary) || (mod?.files || []).find((f) => f.category === 'MAIN') || mod?.files?.[0];
      if (!file) return { status: 'skipped', reason: 'Sem arquivo pra baixar.' };
      id = modId;
      mgr?.trackInstall(modId, mod?.name || modName);
      try {
        await installNexusFile({ game, domain, modId, file, modName });
      } catch (err) {
        if (err.needsManager) {
          mgr?.untrackInstall(modId);
          return { status: 'skipped', needsAccount: true, reason: 'Este mod só baixa com login no site do mod — abra o mod em "Explorar" e use "Baixar pela página".' };
        }
        throw err;
      }
    } else {
      return { status: 'skipped', reason: 'Este mod não tem atualização automática.' };
    }
    if (id != null) mgr?.completeInstall(id);
    // Reinstalar liga o mod — se ele estava desativado, desativa de novo.
    if (wasDisabled) await setModEnabledLocally({ gameInstallPath: game.installPath, steamAppId: game.steamAppId, modName: row.key, enabled: false }).catch(() => {});
    return { status: 'updated' };
  } catch (err) {
    if (id != null) mgr?.untrackInstall(id);
    throw err;
  }
}

// Atualizações de TODOS os jogos com suporte (álbum + tela inicial).
// Lê o manifesto local de cada jogo e pergunta pro servidor em lote.
// { [steamAppId]: [itens com update] } — só no app desktop.
export function useLibraryUpdates(library) {
  const { desktopReady, loading, games } = library;
  const [byGame, setByGame] = useState({});
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const runningRef = useRef(false);

  const targets = useCallback(() => games.filter((g) => g.installPath && ['modio', 'thunderstore', 'nexus'].some((s) => g.sources[s])), [games]);

  const run = useCallback(async (ctx) => {
    if (!desktopReady || loading || runningRef.current) return;
    runningRef.current = true;
    if (!ctx) setChecking(true);
    try {
      const out = {};
      const list = targets();
      // Dois jogos por vez — leitura local é barata, a rede nem tanto.
      let i = 0;
      await Promise.all([0, 1].map(async () => {
        while (i < list.length) {
          const g = list[i]; i += 1;
          try {
            const scan = await scanInstalledModsLocally(g.installPath, g.steamAppId);
            if (!scan?.success) continue;
            if (checkableItems(scan.items).length === 0) continue;
            const results = await checkUpdatesForItems(g, scan.items);
            const pending = pendingUpdates(scan.items, results);
            if (pending.length) out[g.steamAppId] = pending;
          } catch { /* um jogo com erro não para os outros */ }
        }
      }));
      if (ctx && !ctx.ok()) return;
      setByGame((prev) => (sameData(prev, out) ? prev : out));
      setChecked(true);
    } finally {
      runningRef.current = false;
      setChecking(false);
    }
  }, [desktopReady, loading, targets]);

  useEffect(() => { run(); }, [run]);
  // Ao vivo, mas devagar (o servidor guarda as versões em cache).
  useLiveRefresh((ctx) => run(ctx), { enabled: desktopReady && !loading, interval: 90000 });

  return { byGame, checking, checked, refresh: () => run() };
}
