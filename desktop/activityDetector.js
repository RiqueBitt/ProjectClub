// Item pedido: "Rich Presence" — detecta jogo rodando (varrendo os
// processos do sistema operacional e comparando com gameDatabase.js) e
// o que está tocando no Spotify (via APIs do PRÓPRIO sistema
// operacional — Windows tem uma central de controle de mídia embutida
// que qualquer player "de verdade" (Spotify incluído) se conecta
// sozinho; no Linux o equivalente padrão chama MPRIS). NENHUM dos dois
// precisa de conta/chave de API do Spotify — não é integração com o
// Spotify em si, é "o sistema operacional já sabe o que está tocando,
// só perguntamos pra ele".
const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { matchProcessName, steamCoverUrl } = require('./gameDatabase');
const steamDetector = require('./steamDetector');
const { matchProcessName: matchAppProcessName } = require('./appDatabase');

function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : stdout);
    });
  });
}

// ---------- Detecção de jogo (processos do sistema) ----------
async function listProcessNames(platform) {
  if (platform === 'win32') {
    // /fo csv /nh = formato CSV sem cabeçalho — bem mais simples de
    // separar do que o formato de tabela padrão do tasklist.
    const out = await run('tasklist /fo csv /nh');
    return out.split('\n').map((line) => {
      const match = line.match(/^"([^"]+)"/);
      return match ? match[1] : null;
    }).filter(Boolean);
  }
  // Linux — "comm" já devolve só o nome do executável, uma linha por
  // processo, sem precisar recortar nada.
  const out = await run('ps -eo comm=');
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

// ---------- Janela aberta de verdade? ----------
// BUG CORRIGIDO ("Jogando Roblox" com o Roblox só em segundo plano): o
// processo existir não quer dizer que a pessoa está jogando — launchers,
// atualizadores e apps minimizados na bandeja continuam rodando. Agora o
// jogo só conta se tiver uma janela VISÍVEL e não minimizada. Windows:
// PowerShell (MainWindowHandle + IsWindowVisible/IsIconic do user32).
// Linux: wmctrl/xdotool quando existem; sem eles, não dá pra saber e o
// comportamento antigo (só o processo) fica valendo. Só roda quando um
// jogo foi encontrado, e o resultado vale por alguns segundos.
const VISIBLE_CACHE_MS = 6000;
let visibleAt = 0;
let visibleSet = null; // Set de nomes (minúsculo, sem .exe) | null = não sabe
// Alguma janela visível é de um jogo instalado pela Steam (pasta
// steamapps/common)? Usado pra não contar o jogo que a Steam diz estar
// rodando quando ele está só em segundo plano.
let visibleSteamGame = false;
const STEAM_GAME_PATH = /[\\/]steamapps[\\/]common[\\/]/i;
const WIN_VISIBLE_PS_SCRIPT = `
Add-Type -Namespace PcWin -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);'
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and [PcWin.U]::IsWindowVisible($_.MainWindowHandle) -and -not [PcWin.U]::IsIconic($_.MainWindowHandle) } | ForEach-Object { $_.ProcessName + '|' + $_.Path }
`;
let visibleScriptWritten = false;

async function listVisibleWindowProcesses(platform) {
  const now = Date.now();
  if (now - visibleAt < VISIBLE_CACHE_MS) return visibleSet;
  visibleAt = now;
  try {
    if (platform === 'win32') {
      // Script em arquivo (igual ao do Spotify): sem briga de aspas com o cmd.
      const scriptPath = path.join(os.tmpdir(), 'project-club-visible-windows.ps1');
      if (!visibleScriptWritten || !fs.existsSync(scriptPath)) { fs.writeFileSync(scriptPath, WIN_VISIBLE_PS_SCRIPT, 'utf-8'); visibleScriptWritten = true; }
      const out = await run(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`);
      if (!out.trim()) { visibleSet = null; visibleSteamGame = false; return null; }
      const rows = out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('|'); return i < 0 ? [l, ''] : [l.slice(0, i), l.slice(i + 1)]; });
      visibleSet = new Set(rows.map(([n]) => n.toLowerCase()));
      visibleSteamGame = rows.some(([, p]) => STEAM_GAME_PATH.test(p));
      return visibleSet;
    }
    // Linux: janelas mapeadas (wmctrl lista PID por janela; xdotool como reserva).
    let pids = '';
    const wm = await run('wmctrl -lp 2>/dev/null');
    if (wm.trim()) pids = wm.split('\n').map((l) => l.trim().split(/\s+/)[2]).filter((x) => /^\d+$/.test(x)).join(' ');
    else {
      const xd = await run('xdotool search --onlyvisible --name "" getwindowpid %@ 2>/dev/null');
      pids = xd.split('\n').map((l) => l.trim()).filter((x) => /^\d+$/.test(x)).join(' ');
    }
    if (!pids) { visibleSet = null; visibleSteamGame = false; return null; }
    const list = pids.split(' ').slice(0, 200);
    const comm = await run(`ps -o comm= -p ${list.join(',')}`);
    visibleSet = new Set(comm.split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean));
    visibleSteamGame = list.some((pid) => { try { return STEAM_GAME_PATH.test(fs.readlinkSync(`/proc/${pid}/exe`)); } catch { return false; } });
    return visibleSet;
  } catch {
    visibleSet = null;
    visibleSteamGame = false;
    return null;
  }
}

// "RobloxPlayerBeta.exe" → "robloxplayerbeta" (como o PowerShell devolve).
const baseName = (proc) => String(proc || '').toLowerCase().replace(/\.exe$/, '');

// Busca as duas coisas (jogo E app) numa varredura só dos processos —
// não faz sentido listar os processos do sistema duas vezes seguidas
// só porque são dois bancos de dados diferentes. Quem decide a ordem
// de prioridade final entre os dois (e o Spotify) é o laço principal
// (tick() mais abaixo), não esta função — ela só devolve os DOIS
// achados de uma vez.
// Item pedido: "prioridade app -> música -> jogos" (mudou desde a
// versão anterior, que era Jogo -> Spotify -> App).
async function detectGameOrApp(platform) {
  const processes = await listProcessNames(platform);
  const platKey = platform === 'win32' ? 'win' : 'linux';
  let game = null;
  let appMatch = null;
  // ECONOMIA DE CPU: o Spotify só é consultado (PowerShell no Windows,
  // ~1s de CPU por vez) se o processo dele estiver aberto. Antes isso
  // rodava a cada 2s pra todo mundo, mesmo sem Spotify instalado.
  // Lista vazia = não conseguiu listar; aí consulta mesmo assim.
  const spotifyRunning = !processes.length || processes.some((p) => /^spotify(\.exe)?$/i.test(p));
  // Steam aberta? Só aí vale perguntar qual jogo ela está rodando (ver
  // resolveSteamGame abaixo) — sem a Steam, o RunningAppID pode estar
  // "preso" de uma sessão que fechou sem limpar.
  const steamRunning = processes.some((p) => /^steam(\.exe)?$/i.test(p) || /^steamwebhelper(\.exe)?$/i.test(p));
  let gameProc = null;
  let appProc = null;
  for (const proc of processes) {
    if (!game) { game = matchProcessName(proc, platKey); if (game) gameProc = proc; }
    if (!appMatch) { appMatch = matchAppProcessName(proc, platKey); if (appMatch) appProc = proc; }
    if (game && appMatch) break; // achou os dois — não precisa continuar varrendo
  }
  // Jogo em segundo plano (sem janela visível / minimizado) não conta.
  // BUG CORRIGIDO ("aparece que estou usando o HyProject mas ele nem está
  // aberto"): apps (inclusive os do ecossistema, que ficam na bandeja ou
  // com o atualizador rodando) também só contam com janela visível.
  if ((game && gameProc) || (appMatch && appProc)) {
    const visible = await listVisibleWindowProcesses(platform);
    if (visible && game && !visible.has(baseName(gameProc))) game = null;
    if (visible && appMatch && !visible.has(baseName(appProc))) appMatch = null;
  }
  return { game, app: appMatch, spotifyRunning, steamRunning };
}

// ---------- AppID da Steam do jogo rodando ----------
// BUG CORRIGIDO ("Jogando <jogo>" sem capa nos jogos da Steam): o AppID
// só existia pros jogos da lista fixa (gameDatabase.js) — qualquer outro
// jogo aberto pela Steam ficava sem AppID e, sem ele, sem capa. Agora
// pergunta pra própria Steam qual AppID ela está rodando (RunningAppID) e
// completa o jogo detectado (ou detecta um jogo que nem estava na lista).
// A consulta (reg.exe / registry.vdf) é barata, mas mesmo assim fica em
// cache por alguns segundos pra não rodar a cada verificação.
const STEAM_QUERY_CACHE_MS = 6000;
let steamQueryAt = 0;
let steamQueryValue = null;
async function runningSteamAppId(platform, steamRunning) {
  if (!steamRunning) { steamQueryAt = 0; steamQueryValue = null; return null; }
  const now = Date.now();
  if (steamQueryAt && now - steamQueryAt < STEAM_QUERY_CACHE_MS) return steamQueryValue;
  steamQueryAt = now;
  steamQueryValue = await steamDetector.getRunningSteamAppId(platform).catch(() => null);
  return steamQueryValue;
}

// Junta o que a lista fixa achou (por processo) com o que a Steam diz que
// está rodando. Jogo fora da Steam (Valorant, LoL...) continua igual.
function mergeSteamGame(game, runningAppId, nameForAppId) {
  if (!runningAppId) return game;
  // Jogo da lista fixa SEM AppID e sem arte própria (ex.: "Overwatch 2",
  // que também está na Steam): a Steam diz qual é.
  if (game && !game.steamAppId && !game.imageUrl) {
    return { ...game, steamAppId: runningAppId, imageUrl: steamCoverUrl(runningAppId) };
  }
  // Jogo de fora da Steam com arte própria: mantém (pode ser outro jogo
  // aberto ao mesmo tempo).
  if (game && !game.steamAppId) return game;
  // Mesmo AppID: nada a fazer. AppID diferente (ex.: hl2.exe é usado por
  // TF2, Garry's Mod e Half-Life 2) ou jogo fora da lista: a Steam é a
  // fonte certa — desde que dê pra saber o nome do jogo.
  if (game && game.steamAppId === runningAppId) return game;
  const name = nameForAppId(runningAppId);
  if (!name) return game;
  return { name, steamAppId: runningAppId, imageUrl: steamCoverUrl(runningAppId) };
}

// ---------- Detecção de Spotify (mídia tocando agora) ----------
// PowerShell consegue ler a central de mídia do próprio Windows
// (GlobalSystemMediaTransportControlsSessionManager) — a mesma coisa
// que alimenta os controles de mídia que já aparecem na barra de
// tarefas do Windows 10/11 pra qualquer player. Filtra especificamente
// pelo Spotify (AppUserModelId contém "Spotify") — outros players
// (navegador tocando YouTube etc) não entram, só o pedido de verdade.
//
// BUG CORRIGIDO ("Spotify nunca detectava nada"): a primeira versão
// deste script chamava "$op.AsTask()" direto — só que AsTask() é um
// MÉTODO DE EXTENSÃO do C# (WindowsRuntimeSystemExtensions), e o
// PowerShell não consegue chamar métodos de extensão como se fossem
// método normal do objeto sem um truque específico de reflexão. Isso
// fazia o script inteiro falhar silenciosamente toda vez, sem nunca
// conseguir esperar a operação assíncrona terminar de verdade. A
// correção usa o padrão comprovado (pegar o AsTask genérico via
// reflexão, montar o tipo certo, aí sim chamar .Wait()/.Result nele).
const SPOTIFY_PS_SCRIPT = `
# BUG CORRIGIDO ("nome de música/artista com acento vira ?"): por
# padrão, o PowerShell escreve a saída do console usando a "code page"
# local do Windows (ex: CP1252/CP850 em sistemas em português), nunca
# UTF-8 de verdade — mas o Node.js do outro lado sempre interpreta a
# saída como UTF-8. Título/artista com acento (ç, ã, é...) vindo direto
# da central de mídia do Windows atravessavam essa troca de codificação
# errada e viravam "?" ou caracteres estranhos. Forçar as duas pontas
# (console E o próprio stdout) pra UTF-8 aqui garante que o que sai do
# PowerShell já está na mesma codificação que o Node espera do outro
# lado, sem precisar de nenhuma conversão manual depois.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$session = $manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -like "*Spotify*" } | Select-Object -First 1
if ($session -eq $null) { Write-Output "null"; exit }
# Item pedido: "quando eu pausar, some de atividade; quando tocar de
# novo, volta" — igual o Discord já faz. Comparado pelo NOME do valor
# do enum (não pelo número), assim não corre risco nenhum de acertar a
# numeração errada sem poder testar num Windows de verdade.
$playbackInfo = $session.GetPlaybackInfo()
if ($playbackInfo.PlaybackStatus -ne [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing) {
  Write-Output "null"; exit
}
$props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
$timeline = $session.GetTimelineProperties()
$result = @{
  title = $props.Title
  artist = $props.Artist
  positionMs = [math]::Round($timeline.Position.TotalMilliseconds)
  durationMs = [math]::Round($timeline.EndTime.TotalMilliseconds - $timeline.StartTime.TotalMilliseconds)
}
$result | ConvertTo-Json -Compress
`;

// BUG CORRIGIDO: mandar o script inteiro numa linha só, escapando aspas
// à mão, cria um encadeamento de "aspas dentro de aspas dentro de
// aspas" (JS -> string do comando -> PowerShell -> shell do Windows)
// arriscado demais pra confiar sem poder testar num Windows de
// verdade. Escrever o script num ARQUIVO .ps1 temporário e rodar ele
// com -File é muito mais robusto — o conteúdo do script nunca precisa
// passar por nenhum escape de aspas de linha de comando, só é lido
// direto do arquivo.
// BUG CORRIGIDO ("capa do álbum não funciona"): a versão anterior
// tentava ler os BYTES da capa direto do Windows via manipulação manual
// de stream (DataReader) — código que nunca consegui confirmar
// funcionando de verdade (e continuava sem funcionar). Trocado por uma
// abordagem bem mais simples e confiável: busca pública do iTunes (sem
// precisar de chave de API, usada por vários projetos justamente pra
// isso) usando artista+música, que já tenho de qualquer forma — só uma
// chamada HTTP + JSON, sem nenhuma manipulação arriscada de bytes. Como
// bônus, agora funciona tanto no Windows quanto no Linux (antes só
// tentava no Windows).
async function fetchAlbumArtFromItunes(artist, title) {
  try {
    const query = encodeURIComponent(`${artist} ${title}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000); // não trava o laço principal se a rede estiver lenta
    const res = await fetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=1`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return undefined;
    const data = await res.json();
    const artworkUrl = data?.results?.[0]?.artworkUrl100;
    // A API sempre devolve uma miniatura pequena (100x100) — trocar o
    // número no próprio link pede uma versão bem maior, um truque
    // documentado e usado amplamente por quem consome essa API.
    return artworkUrl ? artworkUrl.replace('100x100', '600x600') : undefined;
  } catch {
    return undefined; // sem internet, API fora do ar, música não encontrada — tudo bem, só não mostra capa
  }
}

let spotifyScriptWritten = false;
async function detectSpotifyWindows() {
  const scriptPath = path.join(os.tmpdir(), 'project-club-spotify-check.ps1');
  // Grava o script uma vez só (antes regravava no disco a cada 2s).
  if (!spotifyScriptWritten || !fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, SPOTIFY_PS_SCRIPT, 'utf-8');
    spotifyScriptWritten = true;
  }
  const out = await run(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`);
  const trimmed = out.trim();
  if (!trimmed || trimmed === 'null') return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed.title) return null;
    return {
      name: parsed.title,
      detail: parsed.artist || undefined,
      progressMs: parsed.positionMs,
      durationMs: parsed.durationMs > 0 ? parsed.durationMs : undefined,
    };
  } catch { return null; }
}

// Linux — MPRIS é o padrão de facto pra controle de mídia (Spotify pro
// Linux já se conecta nele sozinho); playerctl é a ferramenta de linha
// de comando mais comum pra ler isso, mas nem todo sistema tem ela
// instalada — se não tiver, só não detecta nada (sem quebrar o resto).
async function detectSpotifyLinux() {
  const status = (await run('playerctl -p spotify status 2>/dev/null')).trim();
  if (status !== 'Playing') return null;
  const metadata = await run(
    'playerctl -p spotify metadata --format \'{{title}}|||{{artist}}|||{{mpris:length}}|||{{position}}\' 2>/dev/null',
  );
  const [title, artist, durationUs, positionUs] = metadata.trim().split('|||');
  if (!title) return null;
  return {
    name: title,
    detail: artist || undefined,
    durationMs: durationUs ? Math.round(Number(durationUs) / 1000) : undefined,
    progressMs: positionUs ? Math.round(Number(positionUs) / 1000) : undefined,
  };
}

// Cache simples: a capa de uma música não muda enquanto ela continua
// tocando — sem isso, cada verificação (a cada poucos segundos)
// buscaria a MESMA capa de novo à toa, gastando chamadas de rede sem
// necessidade nenhuma. Só busca de novo quando a música muda de
// verdade.
let lastArtCacheKey = null;
let lastArtCacheUrl = undefined;

async function detectSpotify(platform) {
  try {
    let result = null;
    if (platform === 'win32') result = await detectSpotifyWindows();
    else if (platform === 'linux') result = await detectSpotifyLinux();
    if (result && result.detail) {
      const cacheKey = `${result.detail}|||${result.name}`;
      if (cacheKey === lastArtCacheKey) {
        result.imageUrl = lastArtCacheUrl;
      } else {
        // BUG CORRIGIDO ("primeira música aparece sem foto, só na
        // próxima que aparece"): a chave era marcada como "já
        // tentada" ANTES de saber se a busca teve sucesso — se a
        // primeira tentativa falhasse por qualquer motivo passageiro
        // (rede lenta bem no início, timeout), a música ficava presa
        // sem foto pra sempre, já que a chave nunca seria tentada de
        // novo enquanto ela continuasse tocando. Agora só marca como
        // "tentada" quando a busca realmente teve sucesso — se falhar,
        // a próxima verificação (2s depois, a mesma música ainda
        // tocando) tenta de novo, até conseguir.
        const url = await fetchAlbumArtFromItunes(result.detail, result.name);
        if (url) {
          lastArtCacheKey = cacheKey;
          lastArtCacheUrl = url;
          result.imageUrl = url;
        }
        // Falhou numa música NOVA — não usa lastArtCacheUrl aqui
        // (seria a capa da música ANTERIOR, errada); result.imageUrl
        // fica undefined até a próxima tentativa conseguir.
      }
    }
    return result;
  } catch { /* não é crítico — só significa "não detectou nada agora" */ }
  return null;
}

// ---------- Laço principal ----------
// A cada ~15s, verifica jogo E Spotify; só chama onChange quando o
// resultado é DIFERENTE do que já tinha mandado da última vez — evita
// ficar reenviando a mesma coisa repetidamente pro servidor à toa
// (o servidor já tem sua própria expiração/renovação, ver
// activityStore.js, então nem precisaria, mas economiza tráfego).
let lastSentKey = null;
let timer = null;

function activityKey(activity) {
  if (!activity) return 'none';
  return `${activity.type}:${activity.name}:${activity.detail || ''}:${activity.steamAppId || ''}:${activity.playingGame?.name || ''}`;
}

function startActivityDetection(onChange) {
  // BUG CORRIGIDO ("jogo fecho e fica preso, não atualiza"): se a
  // janela recarregar por qualquer motivo (deploy novo, reconexão),
  // "did-finish-load" pode disparar de novo — sem essa trava, um
  // SEGUNDO laço de detecção começava a rodar em paralelo com o
  // primeiro (que nunca era parado), cada um com seu próprio estado
  // "último enviado". Os dois brigavam entre si — um mandava "fechou o
  // jogo" enquanto o outro, um pouco atrasado, mandava de volta "ainda
  // tá jogando", dando a impressão de travado sem nunca atualizar de
  // verdade. Agora sempre para o laço anterior antes de começar um novo.
  stopActivityDetection();

  const platform = process.platform;
  if (platform !== 'win32' && platform !== 'linux') return; // macOS não é o público deste app

  // Uma verificação por vez: o PowerShell do Spotify pode levar mais que
  // o intervalo, e antes as verificações se empilhavam (vários
  // PowerShell rodando juntos). Com o Spotify fechado, verifica a cada
  // 4s (só a lista de processos); com ele aberto, a cada 2s.
  let running = false;
  let spotifyOpen = false;
  let lastTickAt = 0;
  const tick = async () => {
    if (running) return;
    const now = Date.now();
    if (!spotifyOpen && lastTickAt && now - lastTickAt < 3900) return;
    running = true;
    lastTickAt = now;
    try {
      const found = await detectGameOrApp(platform);
      const { app, spotifyRunning } = found;
      // BUG CORRIGIDO ("jogo em segundo plano contando como jogando"): a
      // Steam continua dizendo qual jogo está rodando mesmo com ele
      // minimizado/escondido — e isso recriava o jogo que o filtro de
      // janela visível tinha acabado de tirar. Agora o AppID da Steam só
      // vale se tiver uma janela visível de um jogo da Steam na tela (ou
      // se não deu pra saber quais janelas estão abertas).
      let steamAppId = await runningSteamAppId(platform, found.steamRunning);
      if (steamAppId) {
        const visible = await listVisibleWindowProcesses(platform);
        if (visible && !visibleSteamGame && !(found.game && found.game.steamAppId === steamAppId)) steamAppId = null;
      }
      const game = mergeSteamGame(found.game, steamAppId, steamDetector.installedGameName);
      spotifyOpen = !!spotifyRunning;
      let activity = null;
      // Item pedido: "prioridade app -> música -> jogos" (trocado da
      // ordem anterior, que era Jogo -> Spotify -> App).
      if (app) {
        activity = { type: 'app', name: app.name, imageUrl: app.imageUrl || undefined, startedAt: Date.now() };
      } else {
        const spotify = spotifyRunning ? await detectSpotify(platform) : null;
        if (spotify) {
          activity = { type: 'spotify', ...spotify, startedAt: Date.now() };
        } else if (game) {
          activity = { type: 'game', name: game.name, steamAppId: game.steamAppId || undefined, imageUrl: game.imageUrl || undefined, startedAt: Date.now() };
        }
      }
      // Biblioteca de jogos: se o que aparece é música/app mas tem jogo
      // rodando por trás, avisa o jogo também (só pro tempo de jogo).
      if (activity && activity.type !== 'game' && game) {
        activity.playingGame = { name: game.name, steamAppId: game.steamAppId || undefined, imageUrl: game.imageUrl || undefined };
      }
      const key = activityKey(activity);
      if (key !== lastSentKey || (activity && activity.type === 'spotify')) {
        // Spotify sempre reenvia (o progresso da música muda a cada
        // tick, mesmo sendo "a mesma" música) — jogo só reenvia quando
        // muda de fato, pra não ficar recriando o "tempo jogando" a
        // cada 15s à toa.
        lastSentKey = key;
        onChange(activity);
      }
    } catch (err) {
      console.error('[atividade] falha ao detectar:', err.message);
    } finally {
      running = false;
    }
  };

  tick();
  // Item pedido: "demorou muito pra sumir quando fechei o jogo" — o
  // intervalo era de 15s; reduzido pra 8s deixa a detecção de "fechou o
  // jogo" bem mais rápida. Não pode ser MUITO pequeno também — cada
  // verificação de jogo já lista todos os processos do sistema, e no
  // Windows especificamente ainda tenta ler o Spotify via PowerShell
  // (que sozinho já leva ~1-2s pra rodar) sempre que nenhum jogo é
  // encontrado — um intervalo curto demais deixaria isso rodando quase
  // sem parar, comendo CPU à toa.
  // Item pedido: "quando pulo a música demora pra carregar, deixa mais
  // tempo real" — reduzido de 5s pra 2s. Agora que a busca de capa do
  // álbum só acontece UMA VEZ por música (cache, ver detectSpotify()
  // acima) em vez de a cada verificação, dá pra verificar com mais
  // frequência sem gastar chamada de rede à toa — o pulo de música
  // agora é percebido em até 2s, não mais até 5s.
  timer = setInterval(tick, 2000);
}

function stopActivityDetection() {
  if (timer) clearInterval(timer);
  timer = null;
  lastSentKey = null;
}

module.exports = { startActivityDetection, stopActivityDetection, mergeSteamGame };
