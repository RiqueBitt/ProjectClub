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
const { matchProcessName } = require('./gameDatabase');
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

// Busca as duas coisas (jogo E app) numa varredura só dos processos —
// não faz sentido listar os processos do sistema duas vezes seguidas
// só porque são dois bancos de dados diferentes. Jogo sempre GANHA de
// app quando os dois aparecem rodando ao mesmo tempo (igual o Discord
// já faz — enquanto joga, mesmo com o VS Code aberto atrás, mostra o
// jogo).
// Item pedido: "prioridades: 1 Jogos, 2 Spotify, 3 Apps" — antes o
// Spotify só era checado se NEM jogo NEM app fossem encontrados, então
// um app comum (tipo Discord aberto) sempre "vencia" do Spotify tocando
// ao fundo, o que a pessoa não queria. Pra dar certo, essa função devolve
// os DOIS achados (jogo e app) da mesma varredura de processos — quem
// decide a ordem final (Spotify entrando NO MEIO dos dois) é o laço
// principal (tick()) mais abaixo, não mais essa função sozinha.
async function detectGameOrApp(platform) {
  const processes = await listProcessNames(platform);
  const platKey = platform === 'win32' ? 'win' : 'linux';
  let game = null;
  let appMatch = null;
  for (const proc of processes) {
    if (!game) game = matchProcessName(proc, platKey);
    if (!appMatch) appMatch = matchAppProcessName(proc, platKey);
    if (game && appMatch) break; // achou os dois — não precisa continuar varrendo
  }
  return { game, app: appMatch };
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
# Item pedido: capa do álbum de VERDADE (não um ícone genérico) — o
# Windows já guarda a capa junto com o resto da informação da música
# tocando, só precisa ler os bytes e converter pra base64, pra poder
# embutir direto na resposta sem precisar hospedar imagem nenhuma.
$thumbBase64 = $null
if ($props.Thumbnail -ne $null) {
  try {
    $thumbStream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $reader = [Windows.Storage.Streams.DataReader]::new($thumbStream)
    $bytesToLoad = [uint32]$thumbStream.Size
    Await ($reader.LoadAsync($bytesToLoad)) ([uint32]) | Out-Null
    $bytes = New-Object byte[] $bytesToLoad
    $reader.ReadBytes($bytes)
    $thumbBase64 = [Convert]::ToBase64String($bytes)
  } catch { $thumbBase64 = $null }
}
$result = @{
  title = $props.Title
  artist = $props.Artist
  thumbnailBase64 = $thumbBase64
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
async function detectSpotifyWindows() {
  const scriptPath = path.join(os.tmpdir(), 'project-club-spotify-check.ps1');
  fs.writeFileSync(scriptPath, SPOTIFY_PS_SCRIPT, 'utf-8');
  const out = await run(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`);
  const trimmed = out.trim();
  if (!trimmed || trimmed === 'null') return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed.title) return null;
    return {
      name: parsed.title,
      detail: parsed.artist || undefined,
      // Capa do álbum de verdade, quando o Windows consegue ler ela —
      // vira uma "data URL" (a imagem inteira embutida no próprio
      // texto), sem precisar hospedar nem baixar nada à parte.
      imageUrl: parsed.thumbnailBase64 ? `data:image/jpeg;base64,${parsed.thumbnailBase64}` : undefined,
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

async function detectSpotify(platform) {
  try {
    if (platform === 'win32') return await detectSpotifyWindows();
    if (platform === 'linux') return await detectSpotifyLinux();
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
  return `${activity.type}:${activity.name}:${activity.detail || ''}`;
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

  const tick = async () => {
    try {
      const { game, app } = await detectGameOrApp(platform);
      let activity = null;
      // Item pedido: ordem de prioridade — 1) Jogo, 2) Spotify, 3) App.
      if (game) {
        activity = { type: 'game', name: game.name, imageUrl: game.imageUrl || undefined, startedAt: Date.now() };
      } else {
        const spotify = await detectSpotify(platform);
        if (spotify) {
          activity = { type: 'spotify', ...spotify, startedAt: Date.now() };
        } else if (app) {
          activity = { type: 'app', name: app.name, imageUrl: app.imageUrl || undefined, startedAt: Date.now() };
        }
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
  // Item pedido: "melhore ao máximo a atualização em tempo real" —
  // reduzido de 8s pra 5s. Não dá pra ir muito mais rápido que isso
  // sem desperdiçar CPU à toa (cada verificação já lista todos os
  // processos do sistema, e no Windows ainda tenta ler o Spotify via
  // PowerShell sempre que nenhum jogo/app é encontrado).
  timer = setInterval(tick, 5000);
}

function stopActivityDetection() {
  if (timer) clearInterval(timer);
  timer = null;
  lastSentKey = null;
}

module.exports = { startActivityDetection, stopActivityDetection };
