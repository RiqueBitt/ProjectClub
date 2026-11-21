// Atualização automática de mods (Fase 7) — a parte do app de PC.
//
// Quem procura atualização e baixa é o site rodando dentro do app (o mesmo
// código do botão "Atualizar tudo", ver client/src/pages/mods/
// ModAutoUpdater.jsx), porque é ele que tem a conta e fala com o servidor.
// Este módulo cuida do que só o app de PC sabe fazer:
//  - guardar a configuração ("Atualizar mods automaticamente", desligada
//    por padrão, e a escolha de cada jogo) num JSON da pasta de dados;
//  - dizer se o jogo está aberto AGORA — nunca atualiza com o jogo
//    rodando (arquivo em uso, e trocar mod no meio da partida quebra o
//    jogo). Na dúvida (não deu pra listar os processos), responde "não
//    sei" e o site NÃO atualiza;
//  - decidir se pode rodar (desligado, jogo aberto, intervalo mínimo).
// A instalação em si continua passando por modsManager.installCore, que
// guarda a versão anterior até a nova ser conferida (modRollback.js).
//
// Sem Electron no topo — testado com dependências falsas.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SETTINGS_FILE = 'mods-auto-update.json';
// Intervalo mínimo entre duas rodadas no MESMO jogo (o site verifica a
// cada 30 min; isto é só um teto contra rodadas repetidas).
const MIN_INTERVAL_MS = 20 * 60 * 1000;
const MAX_GAMES = 500;

const DEFAULT_SETTINGS = Object.freeze({ enabled: false, games: {} });

function validAppId(id) {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : null;
}

// Só o formato esperado sobrevive (o arquivo pode ter sido editado à mão).
function sanitizeSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const games = {};
  const srcGames = src.games && typeof src.games === 'object' && !Array.isArray(src.games) ? src.games : {};
  for (const [k, v] of Object.entries(srcGames).slice(0, MAX_GAMES)) {
    const id = validAppId(k);
    if (id && typeof v === 'boolean') games[id] = v;
  }
  return { enabled: src.enabled === true, games };
}

// Aplica uma mudança vinda do site: { enabled?, game?: { steamAppId, enabled } }.
function applyPatch(current, patch) {
  const next = sanitizeSettings(current);
  if (!patch || typeof patch !== 'object') return next;
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (patch.game && typeof patch.game === 'object') {
    const id = validAppId(patch.game.steamAppId);
    if (id && typeof patch.game.enabled === 'boolean') next.games[id] = patch.game.enabled;
  }
  return sanitizeSettings(next);
}

function createSettingsStore(userDataDir) {
  const file = path.join(userDataDir, SETTINGS_FILE);
  let cache = null;
  return {
    get() {
      if (cache) return { ...cache, games: { ...cache.games } };
      try { cache = sanitizeSettings(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { cache = sanitizeSettings(DEFAULT_SETTINGS); }
      return { ...cache, games: { ...cache.games } };
    },
    set(patch) {
      const next = applyPatch(this.get(), patch);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Grava num temporário e troca — arquivo nunca fica pela metade.
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
      fs.renameSync(tmp, file);
      cache = next;
      return this.get();
    },
  };
}

// Jogo com atualização automática? Global ligado + o jogo não desligado.
function isGameEnabled(settings, steamAppId) {
  const s = sanitizeSettings(settings);
  if (!s.enabled) return false;
  const id = validAppId(steamAppId);
  if (!id) return false;
  return s.games[id] !== false;
}

// ---------- Jogo aberto? ----------
function normalizeForCompare(p, platform) {
  let out = String(p || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  if (platform === 'win32') out = out.toLowerCase();
  return out;
}

// Algum executável rodando está DENTRO da pasta do jogo?
function anyPathInside(exePaths, installPath, platform = process.platform) {
  const root = normalizeForCompare(installPath, platform);
  if (!root || root.length < 4) return false; // nunca compara com "C:" ou "/"
  return (exePaths || []).some((exe) => {
    const e = normalizeForCompare(exe, platform);
    return e.startsWith(`${root}/`);
  });
}

function execText(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : String(stdout || '')));
  });
}

// Caminho do executável de cada processo. null = não deu pra saber.
async function listProcessPaths(platform = process.platform, deps = {}) {
  if (platform === 'win32') {
    const run = deps.execText || execText;
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process | Where-Object { $_.Path } | ForEach-Object { $_.Path }']);
    if (out == null) return null;
    return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
  if (platform === 'linux') {
    const fsx = deps.fs || fs;
    try {
      const out = [];
      for (const name of fsx.readdirSync('/proc')) {
        if (!/^\d+$/.test(name)) continue;
        try { out.push(fsx.readlinkSync(`/proc/${name}/exe`)); } catch { /* processo de outro usuário / já saiu */ }
        // Jogos do Proton/Wine: o executável é o wine, o .exe do jogo
        // aparece na linha de comando.
        try {
          const cmd = fsx.readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0').filter(Boolean);
          // "Z:\\home\\..." do Wine = "/home/..." de verdade.
          for (const part of cmd.slice(0, 4)) if (/[\\/]/.test(part)) out.push(part.replace(/^[zZ]:(?=[\\/])/, ''));
        } catch { /* idem */ }
      }
      return out;
    } catch { return null; }
  }
  return null;
}

// { running: true|false, known: bool, reason }. Qualquer sinal positivo
// basta (Steam diz que está rodando, atividade detectada ou processo
// dentro da pasta). Sem nenhum sinal e sem conseguir listar processos:
// known = false (o site não atualiza).
async function checkGameRunning({ gameInstallPath, steamAppId }, deps = {}) {
  const platform = deps.platform || process.platform;
  const appId = validAppId(steamAppId);
  if (appId && deps.currentActivity) {
    const act = deps.currentActivity();
    const ids = [act?.steamAppId, act?.playingGame?.steamAppId].map(validAppId);
    if (ids.includes(appId)) return { running: true, known: true, reason: 'activity' };
  }
  if (appId && deps.getRunningSteamAppId) {
    const running = validAppId(await Promise.resolve(deps.getRunningSteamAppId(platform)).catch(() => null));
    if (running && running === appId) return { running: true, known: true, reason: 'steam' };
  }
  if (!gameInstallPath) return { running: false, known: false, reason: 'no-path' };
  const paths = await (deps.listProcessPaths || listProcessPaths)(platform, deps);
  if (paths == null) return { running: false, known: false, reason: 'no-process-list' };
  if (anyPathInside(paths, gameInstallPath, platform)) return { running: true, known: true, reason: 'process' };
  return { running: false, known: true, reason: 'closed' };
}

// ---------- Pode atualizar agora? ----------
// { ok, reason }: 'disabled' | 'game-disabled' | 'game-running' |
// 'unknown-running' | 'too-soon' | 'ok'.
function decide({ settings, steamAppId, running, lastRunAt, now = Date.now(), minIntervalMs = MIN_INTERVAL_MS }) {
  const s = sanitizeSettings(settings);
  if (!s.enabled) return { ok: false, reason: 'disabled' };
  if (!isGameEnabled(s, steamAppId)) return { ok: false, reason: 'game-disabled' };
  if (!running || running.known !== true) return { ok: false, reason: 'unknown-running' };
  if (running.running) return { ok: false, reason: 'game-running' };
  if (lastRunAt && now - lastRunAt < minIntervalMs) return { ok: false, reason: 'too-soon' };
  return { ok: true, reason: 'ok' };
}

// Texto curto do aviso final (o site manda os nomes já prontos).
function notificationText(summary) {
  const updated = (summary?.updated || []).filter((x) => typeof x === 'string').map((x) => x.slice(0, 80));
  const failed = Number(summary?.failed) || 0;
  if (updated.length === 0 && !failed) return null;
  const title = updated.length === 1 ? 'Mod atualizado' : updated.length > 1 ? `${updated.length} mods atualizados` : 'Atualização de mods';
  const names = updated.slice(0, 3).join(', ') + (updated.length > 3 ? ` e mais ${updated.length - 3}` : '');
  const parts = [];
  if (names) parts.push(names);
  if (failed) parts.push(`${failed} não ${failed === 1 ? 'pôde ser atualizado' : 'puderam ser atualizados'} (versão anterior mantida)`);
  return { title, body: parts.join(' · ').slice(0, 240) };
}

module.exports = {
  SETTINGS_FILE, MIN_INTERVAL_MS, DEFAULT_SETTINGS,
  sanitizeSettings, applyPatch, createSettingsStore, isGameEnabled,
  anyPathInside, listProcessPaths, checkGameRunning, decide, notificationText,
};
