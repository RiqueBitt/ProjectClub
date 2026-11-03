import { useEffect } from 'react';
import { scanInstalledModsLocally, listInstalledModsLocally } from '../../utils/mods';
import { loadModsLibrary } from './ModsLibrary.jsx';
import { checkableItems, checkUpdatesForItems, pendingUpdates, updateInstalledMod } from './modUpdates.js';
import {
  autoUpdateBridge, normalizeSettings, gameAutoEnabled, shouldStartRound, isModsPageOpen,
  autoUpdatableItems, itemDisplayName, summarizeRound,
  INITIAL_DELAY_MS, INTERVAL_MS, AFTER_ENABLE_DELAY_MS, SETTINGS_EVENT,
} from './autoUpdatePolicy.js';

// Atualização automática de mods em segundo plano (Fase 7) — só no app de
// PC e só com "Atualizar mods automaticamente" ligado (desligado por
// padrão). Usa EXATAMENTE o mesmo caminho do botão "Atualizar tudo"
// (updateInstalledMod), então valem as mesmas checagens de arquivo e de
// pasta do app de PC — e cada instalação guarda a versão anterior até a
// nova ser conferida (desktop/modRollback.js).
//
// Jogo aberto: antes de mexer nos mods de um jogo, pergunta ao app de PC
// (autoUpdate.check). Jogo rodando, ou sem como saber, fica pra próxima.

let running = false;

async function runRound(bridge) {
  if (running) return;
  const got = await bridge.getSettings().catch(() => null);
  const settings = normalizeSettings(got?.settings);
  const gate = shouldStartRound({
    settings, busy: running, pageOpen: isModsPageOpen(), online: typeof navigator === 'undefined' || navigator.onLine !== false,
  });
  if (!gate.ok) return;
  running = true;
  const results = [];
  try {
    const { games } = await loadModsLibrary();
    const targets = (games || []).filter((g) => g.installPath && gameAutoEnabled(settings, g.steamAppId)
      && ['modio', 'thunderstore', 'nexus'].some((s) => g.sources?.[s]));
    for (const game of targets) {
      if (isModsPageOpen()) break; // a pessoa abriu a tela de Mods no meio: para e deixa com ela
      try {
        // eslint-disable-next-line no-await-in-loop
        const scan = await scanInstalledModsLocally(game.installPath, game.steamAppId);
        if (!scan?.success || checkableItems(scan.items).length === 0) continue;
        // eslint-disable-next-line no-await-in-loop
        const found = await checkUpdatesForItems(game, scan.items);
        const items = autoUpdatableItems(pendingUpdates(scan.items, found));
        if (items.length === 0) continue;
        // Só agora (tem o que atualizar) pergunta se o jogo está fechado.
        // eslint-disable-next-line no-await-in-loop
        const verdict = await bridge.check(game.installPath, game.steamAppId);
        if (!verdict?.ok) continue;
        // O que já está instalado (mesmo dado que a tela de Mods usa) — sem
        // isso as dependências do Thunderstore seriam reinstaladas à toa.
        // eslint-disable-next-line no-await-in-loop
        const installed = await listInstalledModsLocally(game.installPath, game.steamAppId).catch(() => null);
        // Sem tela aberta não há cartão de progresso: as outras funções do
        // gerenciador não fazem nada aqui.
        const noop = () => {};
        const mgr = {
          installedFolders: new Set([...(installed?.enabled || []), ...(installed?.disabled || [])]),
          trackInstall: noop, untrackInstall: noop, completeInstall: noop,
        };
        for (const row of items) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const r = await updateInstalledMod({ game, row, mgr });
            results.push({ status: r.status === 'updated' ? 'updated' : 'skipped', name: itemDisplayName(row) });
          } catch {
            // A versão anterior foi mantida pelo app de PC (modRollback).
            results.push({ status: 'failed', name: itemDisplayName(row) });
          }
        }
      } catch { /* um jogo com erro não para os outros */ }
    }
  } finally {
    running = false;
  }
  const summary = summarizeRound(results);
  if (summary.updated.length || summary.failed) {
    await bridge.notify(summary).catch(() => {});
    window.dispatchEvent(new CustomEvent('pc:mods-auto-updated', { detail: summary }));
  }
}

export default function ModAutoUpdater() {
  useEffect(() => {
    const bridge = autoUpdateBridge();
    if (!bridge) return undefined;
    let stopped = false;
    let timer = null;
    const schedule = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (stopped) return;
        try { await runRound(bridge); } catch { /* tenta de novo na próxima */ }
        if (!stopped) schedule(INTERVAL_MS);
      }, ms);
    };
    schedule(INITIAL_DELAY_MS);
    // Ligou a opção agora: primeira rodada em 1 min (não espera 30).
    const onChange = (e) => { if (e?.detail?.enabled) schedule(AFTER_ENABLE_DELAY_MS); };
    window.addEventListener(SETTINGS_EVENT, onChange);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener(SETTINGS_EVENT, onChange); };
  }, []);
  return null;
}
