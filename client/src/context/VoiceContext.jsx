import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useSocket } from './SocketContext.jsx';
import { useStore } from '../store/useStore';
import { playSound } from '../utils/sounds';
import { getPreferredMicId, setPreferredMicId } from '../utils/audioDevices';
import { watchForSilentMic, probeSignal } from '../utils/micDiagnostics';
// Item pedido: "no .apk, se sair do app, continua na call em segundo
// plano" — sem isso, o Android mata o áudio da chamada poucos segundos
// depois de minimizar o app. Importado direto (não via window.Capacitor)
// porque @capacitor/core já é dependência do projeto e funciona igual em
// qualquer plataforma: em web/desktop, isNativePlatform() já resolve
// pra false sozinho, então as funções abaixo viram no-op automático sem
// precisar de nenhum "if" espalhado pelo resto do arquivo.
import { Capacitor } from '@capacitor/core';

let ForegroundServicePlugin = null;
// Import só é resolvido de verdade dentro do bundle Android (o Vite corta
// esse código fora do build web via tree-shaking normal de import
// dinâmico) — carregado uma vez, sob demanda, só quando a plataforma é
// Android de verdade.
async function getForegroundService() {
  if (Capacitor.getPlatform() !== 'android') return null;
  if (!ForegroundServicePlugin) {
    const mod = await import('@capawesome-team/capacitor-android-foreground-service');
    ForegroundServicePlugin = mod.ForegroundService;
    try {
      await ForegroundServicePlugin.createNotificationChannel({
        id: 'voice-call', name: 'Chamada de voz', importance: 3,
      });
    } catch { /* já existe — ok */ }
  }
  return ForegroundServicePlugin;
}

async function startCallForegroundService(channelName) {
  try {
    const fs = await getForegroundService();
    if (!fs) return;
    await fs.startForegroundService({
      id: 1,
      title: 'Project Club — Em chamada de voz',
      body: channelName || 'Conectado',
      smallIcon: 'ic_stat_call',
      notificationChannelId: 'voice-call',
      silent: true,
    });
  } catch (err) {
    console.error('[voz] Não foi possível iniciar o serviço em segundo plano (Android):', err);
  }
}

async function stopCallForegroundService() {
  try {
    const fs = await getForegroundService();
    if (!fs) return;
    await fs.stopForegroundService();
  } catch { /* nem tinha serviço rodando — ok */ }
}

const VoiceContext = createContext(null);

// BUG CORRIGIDO — causa raiz do "entra no canal mas não ouve/não é ouvido
// entre redes diferentes": só STUN nunca é suficiente. STUN só ajuda cada
// peer a descobrir seu próprio endereço público (server-reflexive) — a
// conexão P2P direta só se estabelece se o NAT/firewall de CADA lado
// também deixar o outro peer alcançar esse endereço diretamente. Atrás de
// NAT simétrico/CGNAT (comum em rede de operadora de celular, em muitos
// firewalls corporativos/de campus, e em alguns roteadores residenciais),
// essa checagem de alcance direto falha nos dois lados mesmo que cada
// peer, sozinho, tenha internet normal — a sinalização (Socket.IO, sobre
// HTTPS/WSS comum) continua funcionando, então entrar/sair do canal e o
// chat de texto parecem normais, mas nenhum par de candidatos ICE nunca
// conecta, e o áudio nunca flui. Isso é exatamente o sintoma relatado:
// funciona só quando os dois estão na mesma rede, falha entre redes
// diferentes. Um servidor TURN (ao contrário do STUN, que é público e não
// pede credencial) retransmite a mídia entre esses dois peers, e é o que
// todo produto de chamada de voz em produção usa como último recurso — o
// Discord tem sua própria frota de TURN por esse motivo exato.
//
// Configure um servidor TURN real preenchendo VITE_TURN_URLS/
// VITE_TURN_USERNAME/VITE_TURN_CREDENTIAL em client/.env (veja
// client/.env.example para o passo a passo e onde conseguir um). Sem
// essas variáveis preenchidas, chamadas entre peers que não conseguem se
// alcançar diretamente continuam falhando exatamente como antes — este
// arquivo não pode inventar um endereço/credencial de TURN por você.
function buildIceServers() {
  const servers = [
    // BUG CORRIGIDO — aviso do navegador "Using five or more STUN/TURN
    // servers slows down discovery": eram 3 servidores STUN públicos aqui
    // + até 2 URLs de TURN vindas de VITE_TURN_URLS (ver abaixo, ex.
    // "turn:...,turns:...") = 5 no total, batendo exatamente nesse limite.
    // Dois servidores STUN já dão a mesma redundância prática (se um
    // estiver fora do ar, o outro responde) sem empurrar a contagem total
    // pra cima do limiar que deixa a descoberta de candidatos ICE mais
    // lenta.
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const turnUrlsRaw = (import.meta.env.VITE_TURN_URLS || '').trim();
  const turnUsername = (import.meta.env.VITE_TURN_USERNAME || '').trim();
  const turnCredential = (import.meta.env.VITE_TURN_CREDENTIAL || '').trim();
  const allEntries = turnUrlsRaw.split(',').map((u) => u.trim()).filter(Boolean);
  // Validação defensiva: um valor mal formado em VITE_TURN_URLS (sem o
  // prefixo turn:/turns:, por exemplo colar só o host) faria o
  // `new RTCPeerConnection(...)` inteiro lançar SyntaxError — derrubando
  // TODA chamada de voz de TODO usuário (nem STUN funcionaria mais), não
  // só o TURN. Filtrar aqui garante que uma URL de TURN mal preenchida vira
  // "TURN não configurado direito" (aviso no console, chamada ainda
  // funciona entre peers que se alcançam direto) em vez de quebrar tudo.
  // BUG CORRIGIDO (revertido): uma tentativa anterior de silenciar o aviso
  // "Using five or more STUN/TURN servers" cortou as URLs de TURN de 4
  // pra só 2 — só que isso é um risco real de CONECTIVIDADE (menos rotas
  // possíveis pra atravessar firewall/NAT restritivo, exatamente o
  // cenário de PC e celular em redes diferentes, que foi quando o áudio
  // parou de funcionar). Prioriza chamada funcionando de verdade sobre
  // silenciar um aviso que é só informativo (a descoberta de candidatos
  // ICE fica um pouco mais lenta com mais servidores, não quebra nada) —
  // mantém TODAS as URLs de TURN configuradas em VITE_TURN_URLS.
  const turnUrls = allEntries.filter((u) => /^turns?:/i.test(u));
  const invalidUrls = allEntries.filter((u) => !/^turns?:/i.test(u));
  if (invalidUrls.length > 0 && typeof console !== 'undefined') {
    console.warn(`[voz] Ignorando URL(s) de TURN mal formada(s) em VITE_TURN_URLS (precisa começar com "turn:" ou "turns:"): ${invalidUrls.join(', ')}`);
  }

  if (turnUrls.length > 0 && turnUsername && turnCredential) {
    servers.push({ urls: turnUrls, username: turnUsername, credential: turnCredential });
  } else if (typeof console !== 'undefined') {
    // Não é fatal — chamadas entre peers que conseguem se alcançar
    // diretamente (mesma rede, NAT permissivo) continuam funcionando sem
    // isso. É especificamente entre redes diferentes/CGNAT/firewall
    // restritivo que isso passa a ser necessário. Ver client/.env.example.
    console.warn(
      '[voz] Nenhum servidor TURN configurado (VITE_TURN_URLS / VITE_TURN_USERNAME / '
      + 'VITE_TURN_CREDENTIAL ausentes em client/.env) — chamadas de voz entre usuários '
      + 'em redes diferentes podem falhar. Veja client/.env.example.'
    );
  }

  return servers;
}

const ICE_SERVERS = buildIceServers();
// Quantos candidatos ICE juntar por conexão ANTES mesmo de precisar deles
// (ex.: assim que a chamada começa) — reduz o atraso de conectar quando a
// negociação finalmente acontece, em vez de começar a juntar do zero
// naquele momento.
const ICE_CANDIDATE_POOL_SIZE = 4;
// Quantas vezes tentar restartIce() num mesmo peer antes de desistir e só
// avisar a pessoa — evita ficar tentando pra sempre contra um peer que
// realmente caiu de vez (fechou o app, perdeu internet de vez).
const MAX_ICE_RESTART_ATTEMPTS = 5;
// 'disconnected' é frequentemente transitório (um blip de rede que o
// próprio ICE resolve sozinho em 1-2s) — espera um pouco antes de forçar
// um restartIce(), pra não sair renegociando à toa a cada micro-soluço.
// 'failed' (mais abaixo) é definitivo, então esse não tem espera nenhuma.
const ICE_DISCONNECTED_GRACE_MS = 3000;
// 26 (out of 255) fixed the "indicator stays lit forever after silence"
// problem, but it was tuned against an average taken over the analyser's
// FULL frequency range (0 Hz up to Nyquist, ~22-24kHz depending on the
// device). Human voice only lives in ~100Hz-3.5kHz — everything above that
// is close to silent for a voice signal, so averaging the whole spectrum
// drags a normal speaking voice's level way down (diluted by a wall of
// near-zero high-frequency bins) and only shouting reliably crossed 26.
// Averaging just the voice band below (VOICE_BAND_HZ) concentrates the
// actual speech energy instead of diluting it, so normal conversational
// volume now crosses the threshold, while still requiring genuine
// voice-band energy (not just any noise) to trip it.
const SPEAKING_THRESHOLD = 18; // 0-255 scale, now measured only over the voice band
const VOICE_BAND_HZ = { min: 100, max: 3500 };
const SPEAKING_POLL_MS = 150;

// Item pedido: sem removedor de ruído nem qualquer processamento
// automático de áudio além do essencial pra chamada não virar um eco
// (echoCancellation continua ligado — sem ele, duas pessoas na mesma
// sala com caixa de som em vez de fone criam um loop de feedback que
// torna a chamada inutilizável; isso não é "remoção de ruído", é
// prevenção de eco). noiseSuppression/autoGainControl (tratamento
// automático de volume/ruído do próprio navegador) e o pipeline de
// RNNoise (rede neural própria) foram removidos por completo — o áudio
// vai pro ar exatamente como o microfone capta.
async function acquireMicStream(preferredMicId) {
  const fullConstraints = (deviceId) => ({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      // autoGainControl/noiseSuppression removidos de propósito (item
      // pedido) — só echoCancellation continua (previne eco/feedback,
      // não é "remoção de ruído") + channelCount:1 (evita acúmulo de
      // fase estéreo em alguns drivers).
      echoCancellation: true, channelCount: 1,
    },
  });
  // Cada tentativa, da mais "completa" pra mais "crua". Dispositivo
  // preferido pode ter sido desconectado/trocado, daí a tentativa extra
  // sem fixar deviceId (cobre o caso mais comum: só o ID salvo é que não
  // existe mais neste PC). A última ("audio: true" puro, sem NENHUMA
  // constraint extra) cobre o hardware/driver que rejeita
  // echoCancellation/autoGainControl/channelCount:1 em combinação —
  // qualidade um pouco pior (sem o tratamento nativo do navegador), mas
  // pelo menos capta áudio de verdade em vez de deixar a pessoa muda sem
  // explicação.
  const tiers = [
    () => navigator.mediaDevices.getUserMedia(fullConstraints(preferredMicId)),
    ...(preferredMicId ? [() => navigator.mediaDevices.getUserMedia(fullConstraints(null))] : []),
    () => navigator.mediaDevices.getUserMedia({ audio: true }),
  ];

  let lastStream = null;
  for (let i = 0; i < tiers.length; i += 1) {
    let stream;
    try {
      // eslint-disable-next-line no-await-in-loop
      stream = await tiers[i]();
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn(`[voz] getUserMedia (tentativa ${i + 1}/${tiers.length}) falhou (${err?.name || err}), tentando alternativa...`);
      }
      continue; // eslint-disable-line no-continue
    }
    lastStream = stream;
    const isLastTier = i === tiers.length - 1;
    if (isLastTier) return stream; // último recurso: aceita mesmo mudo — watchForSilentMic avisa a pessoa depois, na chamada.
    // BUG CORRIGIDO: em alguns PCs, pedir o microfone com echoCancellation/
    // noiseSuppression/autoGainControl não lança erro nenhum, mas devolve
    // uma faixa "ao vivo" que só carrega silêncio — exatamente o padrão
    // relatado de "testar microfone nas Configurações funciona (pede só
    // audio:true puro), mas a chamada continua sem mandar áudio nenhum"
    // (ver comentário completo em micDiagnostics.js/probeSignal). Mede um
    // instante de sinal real antes de aceitar; se vier mudo, descarta e
    // cai pra próxima constraint mais simples em vez de aceitar de cara.
    // eslint-disable-next-line no-await-in-loop
    if (await probeSignal(stream)) return stream;
    if (typeof console !== 'undefined') {
      console.warn(`[voz] getUserMedia (tentativa ${i + 1}/${tiers.length}) deu certo mas veio sem áudio real, tentando alternativa mais simples...`);
    }
    stream.getTracks().forEach((t) => t.stop());
  }
  return lastStream;
}
// `quality`/`frameRate` come from ScreenShareModal — the actual choice of
// *which* screen/window/tab to share is made in the browser's own native
// picker that getDisplayMedia() pops up; no web page (outside Electron's
// desktopCapturer, which isn't available here) is allowed to build a custom
// thumbnail grid for that, for privacy/security reasons enforced by the
// browser itself. What we *can* offer beforehand is the quality preset.
const QUALITY_PRESETS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

// WebRTC mesh call manager using the "perfect negotiation" pattern (see
// https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation)
// so either side can add/remove tracks (camera, screen share) at any point
// without hand-rolled offer/answer sequencing bugs. The signaling server
// only ever relays opaque {description}/{candidate} payloads between exact
// peers — see server/src/sockets/index.js `voice:signal`.
//
// Stage channels (type STAGE) reuse this exact same mesh — the only
// difference is a server-assigned `role` ('speaker' | 'audience') per
// participant: audience members join force-muted and can't unmute
// themselves (see toggleMute below); moderators promote/demote via
// `voice:set-role`. See server/src/sockets/index.js for the authoritative
// permission checks — the client-side gating here is just UX, not security.
//
// NOTE ON TESTABILITY: this code is verified for wiring correctness (event
// flow, permission gating, cleanup) but real audio/video exchange requires
// two actual browsers with camera/mic hardware — that cannot be simulated
// in a headless sandbox. Test with two browser windows before relying on it.
// Sobe a taxa de bits do áudio enviado — o padrão do WebRTC nos
// navegadores costuma usar um Opus "voice-optimized" com uma taxa bem
// conservadora (às vezes ~32kbps), pensado pra chamada telefônica simples,
// não pra qualidade boa de verdade — isso por si só já deixa a voz com um
// som mais "achatado"/artificial. 64kbps é uma taxa alta o bastante pro
// Opus soar limpo e natural em voz, sem exagerar no consumo de internet.
function boostAudioBitrate(sender) {
  if (!sender || sender.track?.kind !== 'audio') return;
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
  params.encodings[0].maxBitrate = 64000;
  sender.setParameters(params).catch(() => {});
}

// Diagnóstico real de áudio de saída — em vez de assumir que "conectou
// = está mandando áudio" (são coisas diferentes: a conexão WebRTC pode
// ficar 100% 'connected' com o m-line de áudio de saída silenciosamente
// em recvonly, ou com a faixa desabilitada, ou até "sendrecv" mas sem
// nenhum byte de verdade saindo). Usa pc.getStats() — a fonte de
// verdade de baixo nível do próprio navegador — pra medir de verdade se
// bytesSent está subindo, e reporta cada possível causa separadamente
// pra dar certeza (não suposição) de qual é o problema quando alguém
// relata "meu áudio não sai pra ninguém".
function diagnoseOutboundAudio(pc, entry, peerId) {
  setTimeout(async () => {
    try {
      if (pc.connectionState !== 'connected') return; // caiu nesse meio tempo — outra checagem cuida disso
      const sender = entry.audioTransceiver?.sender;
      const track = sender?.track;
      const direction = entry.audioTransceiver?.currentDirection;

      // BUG CORRIGIDO: getStats(sender) estava errado — o argumento de
      // seletor do getStats() só aceita um MediaStreamTrack (ou nada
      // nenhum), nunca um RTCRtpSender. Passar o sender direto fazia o
      // Firefox (e provavelmente outros navegadores mais rigorosos com a
      // spec) rejeitar a chamada inteira com TypeError, derrubando o
      // diagnóstico antes mesmo dele conseguir medir qualquer coisa. Sem
      // seletor nenhum já traz TODAS as estatísticas — o filtro logo
      // abaixo (outbound-rtp + kind audio) já pega exatamente o que
      // interessa, então não perde nada.
      const statsBefore = await pc.getStats();
      let bytesBefore = 0;
      statsBefore.forEach((r) => { if (r.type === 'outbound-rtp' && r.kind === 'audio') bytesBefore = r.bytesSent || 0; });

      await new Promise((r) => setTimeout(r, 2500));
      if (pc.connectionState !== 'connected') return;

      const statsAfter = await pc.getStats();
      let bytesAfter = 0;
      let candidateType = null;
      statsAfter.forEach((r) => { if (r.type === 'outbound-rtp' && r.kind === 'audio') bytesAfter = r.bytesSent || 0; });
      statsAfter.forEach((r) => {
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) {
          statsAfter.forEach((c) => { if (c.id === r.localCandidateId) candidateType = c.candidateType; });
        }
      });

      const growing = bytesAfter > bytesBefore;
      const diag = {
        peerId,
        temFaixaLocal: !!track,
        faixaHabilitada: track?.enabled,
        faixaEstado: track?.readyState,
        direcaoNegociada: direction,
        bytesSaindoAumentando: growing,
        bytesAntes: bytesBefore,
        bytesDepois: bytesAfter,
        tipoDeRota: candidateType, // 'host' (direto), 'srflx' (via STUN), 'relay' (via TURN)
      };
      console.log('[voz][diagnóstico de áudio de saída]', diag);

      if (!track) {
        console.error('[voz] DIAGNÓSTICO: não existe faixa de áudio local anexada a este peer — o microfone nunca foi conectado a essa conexão específica.');
      } else if (!track.enabled) {
        console.error('[voz] DIAGNÓSTICO: a faixa de áudio existe mas está DESABILITADA (mudo) — verifique o estado de mudo.');
      } else if (track.readyState !== 'live') {
        console.error(`[voz] DIAGNÓSTICO: a faixa de áudio não está mais "live" (estado: ${track.readyState}) — o microfone caiu ou foi encerrado.`);
      } else if (direction !== 'sendrecv' && direction !== 'sendonly') {
        console.error(`[voz] DIAGNÓSTICO: a direção NEGOCIADA do áudio é "${direction}" — não deveria ser diferente de sendrecv/sendonly. Isso indica um problema na negociação SDP em si, não no microfone.`);
      } else if (!growing) {
        console.error(`[voz] DIAGNÓSTICO: a faixa está habilitada e a direção está correta, mas NENHUM byte novo saiu em 2.5s pela rede (rota: ${candidateType || 'desconhecida'}) — o problema é na camada de rede/ICE, não no microfone nem no código de sinalização.`);
        useStore.getState().pushNotice('Detectamos que seu áudio não está chegando a alguém na chamada (problema de rede/conexão, não do microfone). Abra o Console do navegador (F12) para ver o diagnóstico detalhado.');
      } else {
        console.log('[voz] DIAGNÓSTICO: áudio de saída está fluindo normalmente pela rede — se ainda assim ninguém ouve, o problema está do lado de quem RECEBE, não de quem envia.');
      }
    } catch (err) {
      console.error('[voz] Diagnóstico de áudio falhou ao rodar:', err);
    }
  }, 2000);
}

export function VoiceProvider({ children }) {
  const { user } = useAuth();
  const { socket } = useSocket();

  const [call, setCall] = useState(null); // { serverId, channelId, channelName, channelType }
  const [muted, setMuted] = useState(false);
  // Sempre reflete o `muted` mais recente — a detecção de fala roda dentro
  // de um setInterval que já estava rodando quando o mudo foi ligado/
  // desligado, então ler `muted` direto (fechamento antigo, capturado só
  // uma vez quando o intervalo começou) ficava desatualizado até a
  // detecção reiniciar por outro motivo qualquer. Um ref sempre atual
  // corrige isso sem precisar reiniciar o intervalo toda vez que muda.
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  const [micMissing, setMicMissing] = useState(false); // true = joined without a working mic, forced muted
  const [deafened, setDeafened] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [myRole, setMyRole] = useState('speaker'); // 'speaker' | 'audience' — only meaningful on STAGE channels
  const [handsRaised, setHandsRaised] = useState({}); // userId -> bool
  const [participants, setParticipants] = useState({}); // userId -> { muted, deafened, video, screenSharing, speaking, role }
  // Bug fix: the analyser loop below always computed the local user's own
  // speaking state (that's what it broadcasts to everyone else via
  // `voice:speaking`) but never stored it anywhere for the LOCAL client's
  // own tile to read — `participants` only ever held OTHER people. That
  // meant your own avatar/tile never got the green speaking ring no matter
  // how loud you talked, only everyone else's did.
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [remoteCameraStreams, setRemoteCameraStreams] = useState({}); // userId -> MediaStream
  const [remoteScreenStreams, setRemoteScreenStreams] = useState({}); // userId -> MediaStream
  const [remoteAudioStreams, setRemoteAudioStreams] = useState({}); // userId -> MediaStream (mic)
  const [volumes, setVolumes] = useState({}); // userId -> 0..1 (persists across a session)
  const [roster, setRoster] = useState({}); // channelId -> participants[] (server-wide, for sidebar — doesn't require being in the call)
  // channelId -> ms timestamp (server-authoritative, see sockets/index.js's
  // voiceRoomStartedAt) of when the channel's roster last went from empty
  // to non-empty. Powers ChannelSidebar.jsx's live voice-channel timer —
  // deliberately just a single number synced from the server rather than
  // something the client starts its own clock for, so a page refresh mid-
  // call (or opening the app while a call is already going) still shows
  // the correct elapsed time instead of restarting from 0.
  const [rosterStartedAt, setRosterStartedAt] = useState({});
  // channelId -> { userId: boolean } — same idea as `roster` above (visible
  // to every server member, not just people in the call) but for live
  // speaking state, so the channel sidebar can show the same green ring the
  // in-call tiles grid shows, even while you're just browsing text channels.
  const [rosterSpeaking, setRosterSpeaking] = useState({});
  // A DM call ringing in for us right now — { conversationId, channelId,
  // fromUserId, callerName } | null. Drives the top-of-screen
  // IncomingCallBanner (accept/reject). Separate from `call` (which only
  // exists once we've actually joined a room) since we haven't joined
  // anything yet at this point — just been told someone's calling.
  const [incomingCall, setIncomingCall] = useState(null);

  const micStreamRef = useRef(null);
  // BUG CORRIGIDO / arquitetura nova — antes, cada pedaço do código que
  // precisava saber "qual faixa de áudio está indo pra chamada agora"
  // recalculava isso na hora (`(rnnoiseRef.current?.stream || mic).getAudioTracks()[0]`,
  // repetido em uns 4 lugares diferentes), e o mudo/desmudo mexia direto
  // na faixa CRUA do microfone (`micStreamRef`) em vez da faixa que
  // realmente ia pro RTCPeerConnection quando o RNNoise estava ativo (uma
  // faixa DIFERENTE, gerada pelo AudioWorklet). Os dois às vezes
  // divergiam. Agora só existe UM lugar que sabe "a faixa que está
  // indo pra chamada agora" — este ref — atualizado em connectMicrophone/
  // switchMicrophone e lido por toggleMute/onRoleUpdate/getOrCreatePeer.
  // Nunca mais dá pra mutar uma faixa e continuar mandando outra.
  const localAudioTrackRef = useRef(null);
  // Cancela o check de "microfone mudo por bloqueio do SO" (ver
  // utils/micDiagnostics.js) em andamento — usado ao sair da chamada ou
  // trocar de microfone antes dele terminar, pra não segurar um
  // AudioContext extra aberto nem disparar o aviso fora de hora.
  const silentMicWatchRef = useRef(null);
  // Item pedido: sem pipeline de remoção de ruído — o áudio cru do
  // microfone (localAudioTrackRef) já é a única fonte de verdade que vai
  // pros peers, sem nenhuma etapa extra no meio.
  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peersRef = useRef({}); // userId -> { pc, polite, makingOffer, ignoreOffer }
  const callRef = useRef(null);
  // Trava de reentrância (itens pedidos: "idempotente", "proteção contra
  // requisições simultâneas") — guarda qual canal está NO MEIO de um
  // processo de entrada agora mesmo. Diferente de callRef (que só reflete
  // o estado DEPOIS que o React aplica o setCall, um ciclo de render
  // depois), esse ref é lido/escrito de forma síncrona, então cliques
  // repetidos no botão de entrar — antes mesmo do primeiro clique
  // terminar de pedir o microfone — são ignorados na hora, em vez de
  // cada clique disparar sua própria entrada em paralelo.
  const joiningChannelIdRef = useRef(null);
  // Lets the join-denied handler (registered in an effect that runs before
  // leaveChannel exists further down the file) always call the *current*
  // leaveChannel without needing it in that effect's dependency array.
  const leaveChannelRef = useRef(null);
  const speakingIntervalRef = useRef(null);
  const audioCtxRef = useRef(null);
  // Soundboard playback (see onSoundboardPlay below) — keyed by sound.id so
  // triggering the same effect again restarts it instead of layering a
  // second overlapping copy on top, and so we always hold a live reference
  // to every in-flight <audio> element (an Audio() with no reference kept
  // anywhere is a real, browser-documented gotcha: it can get garbage
  // collected mid-playback, which silently kills the sound partway through
  // — exactly the "the effect doesn't play, or I only hear a tail end of
  // something" bug report this fixes).
  const soundboardAudiosRef = useRef({});

  useEffect(() => { callRef.current = call; }, [call]);

  const cleanupPeer = useCallback((peerId) => {
    const entry = peersRef.current[peerId];
    if (entry) {
      entry.clearRestartTimer?.();
      entry.pc.close();
      delete peersRef.current[peerId];
    }
    setRemoteCameraStreams((s) => { const n = { ...s }; delete n[peerId]; return n; });
    setRemoteScreenStreams((s) => { const n = { ...s }; delete n[peerId]; return n; });
    setRemoteAudioStreams((s) => { const n = { ...s }; delete n[peerId]; return n; });
    setParticipants((s) => { const n = { ...s }; delete n[peerId]; return n; });
    setHandsRaised((s) => { const n = { ...s }; delete n[peerId]; return n; });
  }, []);

  const sendSignal = useCallback((to, data) => {
    if (!socket || !callRef.current) return;
    socket.emit('voice:signal', { channelId: callRef.current.channelId, to, data });
  }, [socket]);

  // Empurra a faixa de áudio atual (a que REALMENTE deve ir pra chamada —
  // ver comentário do localAudioTrackRef acima) pra TODOS os peers já
  // conectados, de uma vez, usando replaceTrack no transceiver de áudio
  // fixo de cada um (ver getOrCreatePeer). `track` pode ser `null` (ex.:
  // microfone caiu no meio da chamada) — nesse caso o transceiver
  // continua existindo, só para de mandar áudio, sem precisar renegociar
  // nada.
  const pushAudioTrackToPeers = useCallback((track) => {
    Object.values(peersRef.current).forEach((entry) => {
      entry.audioTransceiver?.sender.replaceTrack(track || null).catch(() => {});
    });
  }, []);

  const attachExistingVideoTracks = useCallback((pc) => {
    if (cameraStreamRef.current) pc.addTrack(cameraStreamRef.current.getVideoTracks()[0], cameraStreamRef.current);
    if (screenStreamRef.current) pc.addTrack(screenStreamRef.current.getVideoTracks()[0], screenStreamRef.current);
  }, []);

  const getOrCreatePeer = useCallback((peerId) => {
    if (peersRef.current[peerId]) return peersRef.current[peerId];
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: ICE_CANDIDATE_POOL_SIZE });
    const polite = user.id > peerId; // both sides compute the complementary value from their own id — see module docstring

    const entry = { pc, polite, makingOffer: false, ignoreOffer: false, restartTimer: null, restartAttempts: 0 };
    peersRef.current[peerId] = entry;

    const clearRestartTimer = () => {
      if (entry.restartTimer) {
        clearTimeout(entry.restartTimer);
        entry.restartTimer = null;
      }
    };
    // Exposed so cleanupPeer (below) can cancel a pending restart timer
    // when the peer is torn down for good (they actually left), instead
    // of it firing later against a closed/removed RTCPeerConnection.
    entry.clearRestartTimer = clearRestartTimer;

    // Recovers a peer connection whose ICE path broke — a network change
    // (switching wifi<->cellular, VPN toggling, router hiccup) on either
    // side, without the underlying Socket.IO connection itself dropping.
    // restartIce() (native browser API) flags the transport for renegotiation
    // and lets the EXISTING onnegotiationneeded handler below build and
    // send the new offer — reusing the exact same perfect-negotiation
    // offer/answer flow already in place, just with fresh ICE candidates.
    const attemptIceRestart = () => {
      clearRestartTimer();
      if (!peersRef.current[peerId] || pc.connectionState === 'closed') return;
      if (entry.restartAttempts >= MAX_ICE_RESTART_ATTEMPTS) {
        useStore.getState().pushNotice('Conexão de voz instável com um participante. Se o áudio não voltar, tente sair e entrar de novo no canal.');
        return;
      }
      entry.restartAttempts += 1;
      try {
        if (typeof pc.restartIce === 'function') {
          pc.restartIce();
        } else if (!entry.makingOffer) {
          // Fallback for older browsers without restartIce(): build the
          // ICE-restart offer by hand instead.
          entry.makingOffer = true;
          pc.createOffer({ iceRestart: true })
            .then((offer) => pc.setLocalDescription(offer))
            .then(() => sendSignal(peerId, { description: pc.localDescription }))
            .catch(() => {})
            .finally(() => { entry.makingOffer = false; });
        }
      } catch (err) {
        // A later state-change tick will retry if it's still broken.
      }
    };
    entry.attemptIceRestart = attemptIceRestart;

    // ARQUITETURA NOVA — antes, a faixa de áudio era anexada com
    // `pc.addTrack(track, stream)` igual câmera/tela: se a chamada
    // começasse sem microfone (nenhum ainda conectado) e um funcionasse
    // depois, "adicionar" a faixa de áudio pela primeira vez exigia uma
    // renegociação inteira nova (m-line nova), e cada troca de microfone/
    // religação do RNNoise dependia de achar "o sender cujo .track é de
    // áudio" na mão em vários lugares do código — fácil de um lugar
    // esquecer e mandar áudio de uma faixa desatualizada. Agora todo peer
    // nasce com UM transceiver de áudio fixo (`entry.audioTransceiver`),
    // sempre 'sendrecv', existindo mesmo sem microfone ainda — trocar de
    // faixa (ligar o mic, trocar de dispositivo, mic caiu e voltou) é
    // sempre só um replaceTrack() no MESMO transceiver, nunca precisa
    // renegociar a estrutura da chamada de novo. Ver pushAudioTrackToPeers
    // acima, que agora é o ÚNICO lugar que decide o que sai daqui.
    entry.audioTransceiver = localAudioTrackRef.current
      ? pc.addTransceiver(localAudioTrackRef.current, { direction: 'sendrecv' })
      : pc.addTransceiver('audio', { direction: 'sendrecv' });
    boostAudioBitrate(entry.audioTransceiver.sender);

    attachExistingVideoTracks(pc);

    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal(peerId, { candidate: e.candidate });
    };

    // Camera and screen-share tracks are sent as separate MediaStreams whose
    // ids we tag on the sending side (`camera-<userId>` / `screen-<userId>`);
    // that tag survives the wire, so the receiver can route each incoming
    // track to the right bucket without any extra signaling.
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      if (e.track.kind === 'audio') {
        setRemoteAudioStreams((s) => ({ ...s, [peerId]: stream }));
      } else if (stream.id.startsWith('screen-')) {
        setRemoteScreenStreams((s) => ({ ...s, [peerId]: stream }));
      } else {
        setRemoteCameraStreams((s) => ({ ...s, [peerId]: stream }));
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        sendSignal(peerId, { description: pc.localDescription });
      } catch (err) {
        // ignore — a subsequent negotiationneeded will retry
      } finally {
        entry.makingOffer = false;
      }
    };

    // BUG CORRIGIDO: este handler só tinha um comentário e nunca fazia
    // nada — uma conexão que caísse em 'failed' (o caso definitivo, não o
    // 'disconnected' transitório mencionado no comentário antigo) nunca
    // era recuperada; a única forma de voltar a ouvir essa pessoa era sair
    // e entrar de novo no canal inteiro. Tanto connectionState quanto
    // iceConnectionState são observados (nem todo navegador/versão expõe
    // os dois de forma confiável) para não perder o sinal de queda.
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        attemptIceRestart();
      } else if (pc.connectionState === 'connected') {
        clearRestartTimer();
        entry.restartAttempts = 0; // volta a ficar saudável — zera o backoff
        // Diagnóstico real (não suposição): confere depois de alguns
        // segundos se o áudio de SAÍDA está de fato saindo pela rede —
        // não só "a chamada conectou", que é uma coisa completamente
        // diferente de "o áudio realmente está fluindo". Usa as
        // estatísticas de verdade do WebRTC (bytesSent do transceiver de
        // áudio) em vez de inferir pelo estado da conexão.
        diagnoseOutboundAudio(pc, entry, peerId);
      }
      // 'closed' é sempre resultado de cleanupPeer (voice:user-left) —
      // nada a recuperar, a pessoa realmente saiu.
    };
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === 'failed') {
        attemptIceRestart();
      } else if (state === 'disconnected') {
        // Dá uma chance de se recuperar sozinho antes de forçar a
        // renegociação — ver comentário de ICE_DISCONNECTED_GRACE_MS.
        clearRestartTimer();
        entry.restartTimer = setTimeout(attemptIceRestart, ICE_DISCONNECTED_GRACE_MS);
      } else if (state === 'connected' || state === 'completed') {
        clearRestartTimer();
        entry.restartAttempts = 0;
      }
    };

    return entry;
  }, [attachExistingVideoTracks, sendSignal, user?.id]);

  const handleSignal = useCallback(async ({ from, data }) => {
    const entry = getOrCreatePeer(from);
    const { pc } = entry;
    try {
      if (data.description) {
        const offerCollision = data.description.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
        entry.ignoreOffer = !entry.polite && offerCollision;
        if (entry.ignoreOffer) return;

        if (offerCollision) {
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' }),
            pc.setRemoteDescription(data.description),
          ]);
        } else {
          await pc.setRemoteDescription(data.description);
        }

        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          sendSignal(from, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          if (!entry.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      // Non-fatal signaling races are expected under perfect negotiation.
    }
  }, [getOrCreatePeer, sendSignal]);

  // --- Speaking detection (local mic -> analyser -> throttled broadcast) ---
  const startSpeakingDetection = useCallback((channelId) => {
    if (!micStreamRef.current) return;
    // Defensive: AudioContext/analyser setup can throw in some browser
    // states (autoplay-policy restrictions, an already-closed context from
    // a fast leave+rejoin, etc) — letting that escape uncaught here used
    // to take down the whole app's render tree (see ErrorBoundary.jsx),
    // which is a much worse failure mode than just not having a speaking
    // indicator for this session.
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      // Mesma correção já aplicada no playback remoto (AudioSink, em
      // CallBar.jsx): um AudioContext pode nascer "suspended" por política
      // de autoplay do navegador — nesse estado o analyser só lê silêncio,
      // então a detecção de fala (e a animaçãozinha do avatar) nunca
      // disparava, mesmo com o microfone captando áudio normalmente.
      ctx.resume().catch(() => {});
      // A detecção de fala sempre analisa o microfone cru (nunca teve
      // nenhum processamento no meio) — só precisa de um nível de sinal
      // confiável pra saber "está falando ou não", não de áudio limpo.
      const source = ctx.createMediaStreamSource(micStreamRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      // Bins that fall inside VOICE_BAND_HZ — computed from the actual
      // context sample rate (44.1kHz vs 48kHz devices land on different bin
      // widths), so we only ever average the part of the spectrum where a
      // human voice actually has energy.
      const hzPerBin = ctx.sampleRate / analyser.fftSize;
      const minBin = Math.max(1, Math.floor(VOICE_BAND_HZ.min / hzPerBin));
      const maxBin = Math.min(data.length - 1, Math.ceil(VOICE_BAND_HZ.max / hzPerBin));
      let wasSpeaking = false;
      let smoothedLevel = 0;

      speakingIntervalRef.current = setInterval(() => {
        try {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = minBin; i <= maxBin; i++) sum += data[i];
          const avg = sum / (maxBin - minBin + 1);
          // Light smoothing (not a slow decay — both attack and release use
          // the same fast blend) just to stop a single noisy frame from
          // flickering the indicator; it still falls below the threshold
          // within one or two polls of actual silence.
          smoothedLevel = smoothedLevel * 0.5 + avg * 0.5;
          const speaking = smoothedLevel > SPEAKING_THRESHOLD && !mutedRef.current;
          if (speaking !== wasSpeaking) {
            wasSpeaking = speaking;
            setLocalSpeaking(speaking);
            socket?.emit('voice:speaking', { channelId, speaking });
          }
        } catch {
          // A single bad tick shouldn't kill the whole call.
        }
      }, SPEAKING_POLL_MS);
    } catch (err) {
      // No speaking indicator this session, but the call itself still works.
    }
  }, [socket]);

  const stopSpeakingDetection = useCallback(() => {
    if (speakingIntervalRef.current) clearInterval(speakingIntervalRef.current);
    speakingIntervalRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLocalSpeaking(false);
  }, []);

  // --- Socket event wiring ---
  useEffect(() => {
    if (!socket) return;

    const onJoined = ({ channelId, participants: existing, myRole: role }) => {
      if (callRef.current?.channelId !== channelId) return;
      const map = {};
      existing.forEach((p) => { map[p.userId] = p; getOrCreatePeer(p.userId); });
      setParticipants(map);
      if (role) {
        setMyRole(role);
        if (role === 'audience' && localAudioTrackRef.current) {
          localAudioTrackRef.current.enabled = false;
          setMuted(true);
        }
      }
    };
    const onUserJoined = ({ channelId, userId, role }) => {
      if (callRef.current?.channelId !== channelId) return;
      setParticipants((s) => ({ ...s, [userId]: { muted: role === 'audience', deafened: false, video: false, screenSharing: false, role } }));
    };
    const onUserLeft = ({ channelId, userId }) => {
      if (callRef.current?.channelId !== channelId) return;
      cleanupPeer(userId);
    };
    const onSignal = (payload) => {
      if (callRef.current?.channelId !== payload.channelId) return;
      handleSignal(payload);
    };
    const onState = ({ channelId, userId, ...state }) => {
      if (callRef.current?.channelId !== channelId) return;
      setParticipants((s) => ({ ...s, [userId]: { ...s[userId], ...state } }));
    };
    const onSpeaking = ({ channelId, userId, speaking }) => {
      // In-call tiles grid — only relevant if this is the call we're actually in.
      if (callRef.current?.channelId === channelId) {
        setParticipants((s) => (s[userId] ? { ...s, [userId]: { ...s[userId], speaking } } : s));
      }
      // Sidebar roster — relevant for any voice channel on any server we're a member of.
      setRosterSpeaking((s) => ({ ...s, [channelId]: { ...(s[channelId] || {}), [userId]: speaking } }));
    };
    const onRoster = ({ channelId, participants: list, startedAt }) => {
      setRoster((s) => ({ ...s, [channelId]: list }));
      setRosterStartedAt((s) => (startedAt ? { ...s, [channelId]: startedAt } : (() => {
        const next = { ...s }; delete next[channelId]; return next;
      })()));
      // Drop stale speaking flags for anyone who's no longer actually in the
      // channel (otherwise a user who left mid-"speaking" would show a green
      // ring forever in the sidebar).
      setRosterSpeaking((s) => {
        const present = new Set(list.map((p) => p.userId));
        const existing = s[channelId] || {};
        const pruned = Object.fromEntries(Object.entries(existing).filter(([uid]) => present.has(uid)));
        return { ...s, [channelId]: pruned };
      });
    };
    const onHandRaised = ({ channelId, userId, raised }) => {
      if (callRef.current?.channelId !== channelId) return;
      setHandsRaised((s) => ({ ...s, [userId]: raised }));
    };
    const onRoleUpdate = ({ channelId, userId: targetUserId, role, muted: forcedMuted }) => {
      if (callRef.current?.channelId !== channelId) return;
      setParticipants((s) => (s[targetUserId] ? { ...s, [targetUserId]: { ...s[targetUserId], role, muted: forcedMuted } } : s));
      if (targetUserId === user.id) {
        setMyRole(role);
        setHandsRaised((s) => ({ ...s, [user.id]: false }));
        if (role === 'audience') {
          if (localAudioTrackRef.current) localAudioTrackRef.current.enabled = false;
          setMuted(true);
        } else if (role === 'speaker' && !deafened) {
          // Invited up to speak — unmute automatically so there's no extra
          // manual step between "promoted" and "audible".
          if (localAudioTrackRef.current) localAudioTrackRef.current.enabled = true;
          setMuted(false);
        }
      }
    };

    // The join was optimistic client-side (mic grabbed, call state set
    // before the server confirms) — if the server actually rejects it
    // (permission revoked, or the channel hit its user limit), unwind that
    // optimistic state the same way leaveChannel() already does instead of
    // leaving the UI stuck showing an empty, not-really-connected call.
    const onJoinDenied = ({ channelId, reason }) => {
      if (callRef.current?.channelId !== channelId) return;
      useStore.getState().pushNotice(reason || 'Não foi possível entrar no canal de voz.');
      leaveChannelRef.current?.();
    };

    // Soundboard (see SoundboardPanel.jsx) — the server only broadcasts to
    // the `voice:${channelId}` room, but a stale/duplicate event after
    // already leaving that channel is still possible in flight, hence the
    // same callRef.current?.channelId guard every other handler above uses.
    // Plays the clip directly from its URL (not the named-sound helper in
    // utils/sounds.js — this is arbitrary server-hosted audio, not one of
    // the bundled notification chimes).
    const onSoundboardPlay = ({ channelId, sound }) => {
      if (callRef.current?.channelId !== channelId || deafened) return;
      try {
        // If this exact effect is already mid-playback (double-click, or a
        // duplicate/rapid re-trigger), stop and discard the old element
        // first instead of letting two copies of it overlap — otherwise
        // what you hear next can be the *tail* of the previous play
        // colliding with the new one, which is exactly what got reported
        // as "sounds like it plays the end of the audio".
        const previous = soundboardAudiosRef.current[sound.id];
        if (previous) {
          previous.pause();
          previous.src = '';
        }

        const el = new Audio();
        el.volume = 0.7;
        el.preload = 'auto';
        // Force playback to start from frame zero explicitly rather than
        // trusting whatever position a freshly-constructed element happens
        // to report — belt-and-braces against browsers that resume a
        // media element's last playback position when its underlying
        // resource is re-used from the disk/HTTP cache.
        const startFromZero = () => {
          try { el.currentTime = 0; } catch { /* not seekable yet, fine */ }
          el.play().catch(() => {});
        };
        if (el.readyState >= 1) startFromZero();
        else el.addEventListener('loadedmetadata', startFromZero, { once: true });
        el.addEventListener('error', () => {
          if (soundboardAudiosRef.current[sound.id] === el) delete soundboardAudiosRef.current[sound.id];
        });
        el.addEventListener('ended', () => {
          if (soundboardAudiosRef.current[sound.id] === el) delete soundboardAudiosRef.current[sound.id];
        });
        soundboardAudiosRef.current[sound.id] = el;
        el.src = sound.url;
        el.load();
      } catch { /* not fatal */ }
    };

    // --- Incoming DM call (ring / accept / reject) ---
    // See sockets/index.js's voice:join `dm:` branch (rings once when a
    // call actually starts) and dm-call:reject (explicit decline).
    const onDmCallRinging = ({ conversationId, channelId: ringChannelId, fromUserId, callerName }) => {
      const resolvedChannelId = ringChannelId || `dm:${conversationId}`;
      // Already in this exact call ourselves (e.g. we started it from
      // another tab/device) — nothing to ring for.
      if (callRef.current?.channelId === resolvedChannelId) return;
      setIncomingCall({ conversationId, channelId: resolvedChannelId, fromUserId, callerName });
    };
    const onDmCallDeclined = ({ conversationId }) => {
      setIncomingCall((c) => (c && c.conversationId === conversationId ? null : c));
    };
    const onDmCallEnded = ({ conversationId }) => {
      // Caller hung up (or the call otherwise ended) before we answered —
      // stop ringing, there's nothing left to accept.
      setIncomingCall((c) => (c && c.conversationId === conversationId ? null : c));
    };

    // BUG CORRIGIDO — reconexão: se o socket cair e voltar (troca de wifi
    // pra dados móveis, VPN, um blip de rede) enquanto em chamada, o
    // servidor já derruba a pessoa da sala de voz no handler de
    // `disconnect` (ver server/src/sockets/index.js), avisando os outros
    // participantes via `voice:user-left` — que aí fecham a
    // RTCPeerConnection deles com ela. Sem este handler, o cliente que
    // reconectou nunca ficava sabendo disso: continuava com `call` setado
    // e com RTCPeerConnections antigas (mortas, do lado dos outros) em
    // peersRef, sem nunca voltar a mandar/receber áudio de ninguém — só
    // saindo e entrando de novo no canal na mão resolvia. Ao detectar que
    // o socket voltou depois de ter caído (não a primeira conexão), com
    // uma chamada ainda ativa: descarta as conexões antigas (que o outro
    // lado já derrubou mesmo) e reentra no canal pelo fluxo normal de
    // `voice:join`, que reconstrói a malha de peers do zero.
    let sawDisconnect = false;
    const onSocketDisconnect = () => { sawDisconnect = true; };
    const onSocketConnect = () => {
      if (!sawDisconnect) return; // primeira conexão desta sessão — nada a recuperar
      sawDisconnect = false;
      const current = callRef.current;
      if (!current) return;
      Object.keys(peersRef.current).forEach(cleanupPeer);
      socket.emit('voice:join', { channelId: current.channelId });
      useStore.getState().pushNotice('Conexão recuperada — reconectando o áudio...');
    };

    socket.on('voice:joined', onJoined);
    socket.on('voice:join-denied', onJoinDenied);
    socket.on('voice:user-joined', onUserJoined);
    socket.on('voice:user-left', onUserLeft);
    socket.on('voice:signal', onSignal);
    socket.on('voice:state', onState);
    socket.on('voice:speaking', onSpeaking);
    socket.on('voice:roster', onRoster);
    socket.on('voice:hand-raised', onHandRaised);
    socket.on('voice:role-update', onRoleUpdate);
    socket.on('soundboard:play', onSoundboardPlay);
    socket.on('dm-call:ringing', onDmCallRinging);
    socket.on('dm-call:declined', onDmCallDeclined);
    socket.on('dm-call:ended', onDmCallEnded);
    socket.on('connect', onSocketConnect);
    socket.on('disconnect', onSocketDisconnect);

    return () => {
      socket.off('voice:joined', onJoined);
      socket.off('voice:join-denied', onJoinDenied);
      socket.off('voice:user-joined', onUserJoined);
      socket.off('voice:user-left', onUserLeft);
      socket.off('voice:signal', onSignal);
      socket.off('voice:state', onState);
      socket.off('voice:speaking', onSpeaking);
      socket.off('voice:roster', onRoster);
      socket.off('voice:hand-raised', onHandRaised);
      socket.off('voice:role-update', onRoleUpdate);
      socket.off('soundboard:play', onSoundboardPlay);
      socket.off('dm-call:ringing', onDmCallRinging);
      socket.off('dm-call:declined', onDmCallDeclined);
      socket.off('dm-call:ended', onDmCallEnded);
      socket.off('connect', onSocketConnect);
      socket.off('disconnect', onSocketDisconnect);
    };
  }, [socket, getOrCreatePeer, handleSignal, cleanupPeer, user?.id, deafened]);

  const broadcastState = useCallback((patch) => {
    if (!socket || !callRef.current) return;
    socket.emit('voice:state', { channelId: callRef.current.channelId, ...patch });
  }, [socket]);

  // Tries to acquire the microphone and, if a call is already underway,
  // wires the resulting track into every existing peer connection via
  // pushAudioTrackToPeers (new peers pick it up automatically from
  // localAudioTrackRef in getOrCreatePeer). Returns true/false so callers
  // can decide what to do next.
  const connectMicrophone = useCallback(async () => {
    try {
      // autoGainControl (was missing) matters here specifically because of the
      // echo/feedback report: without it, if the mic signal ever creeps up (room
      // noise, gain from a loud speaker being picked back up), the browser has no
      // instruction to pull that level back down — it just keeps climbing. That
      // climbing gain feeding into a speaker-not-headphones setup is exactly what
      // turns into the "echo that keeps tuning up in pitch until it cuts out"
      // symptom: every mic->speaker->mic pass comes back a little louder than the
      // last, and it runs away. channelCount: 1 avoids a second, purely-mechanical
      // way for that same kind of runaway buildup to happen: stereo capture on a
      // mono source can otherwise get the two channels a few samples out of phase,
      // which briefly reinforces itself the same way a real feedback loop does.
      // acquireMicStream() (ver acima) agora tenta várias combinações de
      // constraints antes de desistir — ver o "BUG CORRIGIDO" ali sobre o
      // microfone do PC falhando silenciosamente por causa disso.
      const preferredMicId = getPreferredMicId();
      const mic = await acquireMicStream(preferredMicId);
      micStreamRef.current = mic;
      setMicMissing(false);

      // Cancela qualquer verificação de silêncio anterior (troca rápida de
      // canal, por exemplo) antes de iniciar uma nova para este stream.
      silentMicWatchRef.current?.();
      silentMicWatchRef.current = watchForSilentMic(mic, () => {
        useStore.getState().pushNotice(
          'Seu microfone foi encontrado e a chamada conectou, mas nenhum áudio real está '
          + 'chegando dele — ninguém consegue te ouvir. Isso costuma ser bloqueio de '
          + 'microfone no próprio sistema (não no site): no Windows, vá em Configurações → '
          + 'Privacidade e segurança → Microfone e ative "Acesso ao microfone" e "Permitir que '
          + 'aplicativos de área de trabalho acessem seu microfone" (isso libera o Chrome/Edge/'
          + 'Firefox); no Mac, em Ajustes do Sistema → Privacidade e Segurança → Microfone, '
          + 'confirme que o navegador está marcado. Verifique também se outro programa não está '
          + 'usando o microfone sozinho (modo exclusivo) e se o dispositivo certo está escolhido '
          + 'em Configurações → Voz e Áudio.'
        );
      });

      // Detecta o microfone sendo derrubado NO MEIO da chamada por causa
      // do sistema operacional (permissão revogada, dispositivo
      // desconectado) — o navegador não lança nenhum erro nesse momento,
      // só dispara esses eventos na track; sem isso a chamada continuava
      // "achando" que estava mandando áudio normalmente pra sempre.
      const rawTrack = mic.getAudioTracks()[0];
      if (rawTrack) {
        rawTrack.onmute = () => {
          useStore.getState().pushNotice('Seu microfone parou de captar áudio (foi desativado pelo sistema ou desconectado). Verifique as permissões de microfone do seu dispositivo.');
        };
        rawTrack.onended = () => {
          setMicMissing(true);
          useStore.getState().pushNotice('O microfone foi desconectado. Conecte um microfone e toque no botão de mudo para tentar de novo.');
        };
      }

      // ARQUITETURA NOVA: em vez de recalcular "qual é a faixa que vai pra
      // chamada" separadamente aqui, guarda ela em localAudioTrackRef (a
      // ÚNICA fonte de verdade — ver comentário no topo do arquivo) e
      // empurra pra todos os peers já conectados de uma vez via
      // pushAudioTrackToPeers, que faz replaceTrack no transceiver de
      // áudio fixo de cada um (nunca precisa renegociar). Isso cobre tanto
      // o primeiro join (nenhum peer ainda existe, o forEach não faz nada,
      // e getOrCreatePeer usa localAudioTrackRef.current pra cada peer
      // novo) quanto reconectar o microfone NO MEIO de uma chamada já em
      // andamento (mic caiu e a pessoa clicou em desmutar de novo — nesse
      // caso os peers já existem e precisam receber a faixa nova agora).
      const track = mic.getAudioTracks()[0];
      localAudioTrackRef.current = track;
      pushAudioTrackToPeers(track);
      if (callRef.current) startSpeakingDetection(callRef.current.channelId);
      return true;
    } catch (err) {
      if (typeof console !== 'undefined') console.error('[voz] não foi possível acessar o microfone:', err);
      return false;
    }
  }, [startSpeakingDetection, pushAudioTrackToPeers]);

  // Troca de microfone SEM sair da chamada — usada pelo menu de
  // configurações de áudio. Troca a faixa em cada conexão já aberta com
  // `replaceTrack` (não `addTrack`, que duplicaria o áudio enviado) e
  // reinicia a detecção de fala com o novo dispositivo.
  const switchMicrophone = useCallback(async (deviceId) => {
    setPreferredMicId(deviceId);
    if (!callRef.current) return true; // fora de chamada: só guarda a preferência pra próxima vez
    try {
      // Mesmo fallback progressivo de connectMicrophone — trocar pra um
      // dispositivo específico no PC podia falhar do mesmo jeito (ver
      // "BUG CORRIGIDO" em acquireMicStream, acima).
      const newMic = await acquireMicStream(deviceId);
      silentMicWatchRef.current?.();
      silentMicWatchRef.current = watchForSilentMic(newMic, () => {
        useStore.getState().pushNotice(
          'Esse microfone foi selecionado, mas nenhum áudio real está chegando dele. '
          + 'Verifique se o sistema operacional está bloqueando o acesso ao microfone para o '
          + 'navegador (Configurações de Privacidade do Windows/macOS) ou se outro programa '
          + 'está usando esse microfone em modo exclusivo.'
        );
      });
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = newMic;
      const newTrack = newMic.getAudioTracks()[0];
      // BUG CORRIGIDO: trocar de microfone enquanto estava mudo destravava
      // o áudio sem querer — uma faixa nova do getUserMedia() sempre nasce
      // com `enabled: true` por padrão, e esse código nunca conferia se a
      // pessoa estava mudo antes de mandar a faixa nova pros outros
      // participantes. Resultado: escolher outro microfone no meio de uma
      // chamada enquanto mudo fazia o áudio voltar a vazar pros outros,
      // mesmo com a interface continuando a mostrar "mudo". Agora a faixa
      // nova nasce respeitando o estado de mudo atual, igual a antiga.
      newTrack.enabled = !mutedRef.current;
      localAudioTrackRef.current = newTrack;
      pushAudioTrackToPeers(newTrack);
      stopSpeakingDetection();
      startSpeakingDetection(callRef.current.channelId);
      return true;
    } catch (err) {
      console.error('[voz] não foi possível trocar de microfone:', err);
      return false;
    }
  }, [startSpeakingDetection, stopSpeakingDetection, pushAudioTrackToPeers]);

  const joinChannel = useCallback(async (serverId, channelId, channelName, channelType) => {
    // Idempotente (item pedido): já estou de verdade NESSE canal — não
    // faz nada, nem manda voice:join de novo à toa.
    if (callRef.current?.channelId === channelId) return;
    // Já estou NO MEIO de entrar nesse mesmo canal (clique duplo/triplo
    // rápido no botão, antes do primeiro clique sequer terminar de pedir
    // o microfone) — ignora os cliques extras, deixa só a primeira
    // chamada em andamento terminar sozinha. É isso que impede vários
    // "voice:join" saindo pro servidor de uma vez só por causa de
    // cliques repetidos.
    if (joiningChannelIdRef.current === channelId) return;
    // Trocando de canal (ou entrando de novo depois de ter clicado em
    // OUTRO canal enquanto o primeiro ainda carregava) — cancela a
    // tentativa anterior visualmente marcando essa como a atual; o
    // "finally" da chamada antiga só limpa a trava se ainda for dona
    // dela, então não atropela essa nova.
    joiningChannelIdRef.current = channelId;
    try {
      if (callRef.current) await leaveChannel();
      const gotMic = await connectMicrophone();
      // Confere de novo depois do await — se outra chamada mais nova já
      // assumiu a trava (a pessoa clicou em outro canal enquanto o
      // microfone ainda tava conectando), essa aqui desiste em vez de
      // continuar entrando num canal que a pessoa já nem quer mais.
      if (joiningChannelIdRef.current !== channelId) return;
      if (!gotMic) {
        // No microphone (none plugged in, permission denied, or unsupported)
        // no longer blocks joining entirely — you can still listen, watch
        // shared screens/cameras, and text chat. You just join muted, with a
        // clear explanation, instead of a dead-end alert() and no call at all.
        useStore.getState().pushNotice('Microfone não encontrado. Você entrou no canal mudo — conecte um microfone e toque no botão de mudo para ativá-lo.');
        setMicMissing(true);
        setMuted(true);
      }
      const next = { serverId, channelId, channelName, channelType };
      setCall(next);
      callRef.current = next; // espelho síncrono — não espera o ciclo de render/effect
      setMyRole('speaker');
      socket?.emit('voice:join', { channelId });
      playSound('callJoin');
      startCallForegroundService(channelName);
      if (gotMic) startSpeakingDetection(channelId);
      // Joining a call this way (banner's "Atender", or just opening the DM
      // and tapping the call button yourself) always resolves any matching
      // ring — otherwise the banner would keep showing "recebendo chamada"
      // for a call you're now already in.
      setIncomingCall((c) => (c && c.channelId === channelId ? null : c));
    } finally {
      // Só limpa a trava se ainda for a dona dela — evita uma chamada
      // ANTIGA (que perdeu a corrida pra uma mais nova) apagar por
      // engano a trava de uma entrada mais recente que já está rolando.
      if (joiningChannelIdRef.current === channelId) joiningChannelIdRef.current = null;
    }
  }, [socket, startSpeakingDetection, connectMicrophone]);

  // Accept the call currently ringing via the IncomingCallBanner.
  const answerIncomingCall = useCallback(() => {
    if (!incomingCall) return;
    const { conversationId, channelId } = incomingCall;
    const convo = useStore.getState().conversations.find((c) => c.id === conversationId);
    const name = convo ? (convo.isGroup ? convo.name : (convo.members.find((m) => m.id !== user?.id)?.displayName || 'Chamada')) : 'Chamada';
    joinChannel(null, channelId, name, 'DM');
  }, [incomingCall, joinChannel, user?.id]);

  // Decline the call currently ringing via the IncomingCallBanner — we were
  // never a room participant, so this is a plain notification to the
  // caller/other members, not a leaveChannel().
  const declineIncomingCall = useCallback(() => {
    if (!incomingCall) return;
    socket?.emit('dm-call:reject', { conversationId: incomingCall.conversationId });
    setIncomingCall(null);
  }, [incomingCall, socket]);

  // AFK move: the server tells us (and only us — see sockets/index.js's
  // AFK sweep) to switch to the server's configured AFK channel after
  // going quiet too long in a voice channel. Only acts if we're actually
  // still in the exact call it's talking about (it could arrive a beat
  // after we'd already left on our own) — reuses the normal joinChannel
  // flow so this goes through the exact same WebRTC teardown/setup as any
  // other channel switch, nothing special-cased.
  useEffect(() => {
    if (!socket) return;
    const onAfkMove = ({ fromChannelId, toChannelId }) => {
      const current = callRef.current;
      if (!current || current.channelId !== fromChannelId) return;
      const { categories, channels } = useStore.getState();
      const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
      const target = allChannels.find((c) => c.id === toChannelId);
      joinChannel(null, toChannelId, target?.name || 'Ausentes', target?.type || 'VOICE');
      useStore.getState().pushNotice('Você foi movido para o canal de ausentes por inatividade.');
    };
    socket.on('voice:afk-move', onAfkMove);
    return () => socket.off('voice:afk-move', onAfkMove);
  }, [socket, joinChannel]);

  const leaveChannel = useCallback(async () => {
    const current = callRef.current;
    if (!current) return;
    socket?.emit('voice:leave', { channelId: current.channelId });
    playSound('callLeave');
    stopCallForegroundService();
    Object.values(soundboardAudiosRef.current).forEach((el) => { el.pause(); el.src = ''; });
    soundboardAudiosRef.current = {};
    Object.keys(peersRef.current).forEach(cleanupPeer);
    silentMicWatchRef.current?.();
    silentMicWatchRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    localAudioTrackRef.current = null;
    cameraStreamRef.current = null;
    screenStreamRef.current = null;
    stopSpeakingDetection();
    setCall(null);
    setParticipants({});
    setHandsRaised({});
    setMuted(false);
    setDeafened(false);
    setCameraOn(false);
    setScreenOn(false);
    setMyRole('speaker');
    setMicMissing(false);
  }, [socket, cleanupPeer, stopSpeakingDetection]);
  useEffect(() => { leaveChannelRef.current = leaveChannel; }, [leaveChannel]);

  // On a STAGE channel, audience members cannot unmute themselves — they
  // must raise their hand and be promoted to speaker by a moderator first.
  const toggleMute = useCallback(async () => {
    if (callRef.current?.channelType === 'STAGE' && myRole === 'audience') return;
    // Trying to unmute with no working mic (joined without one, or it got
    // disconnected) — try to grab one now instead of just flipping a flag
    // that would unmute into silence. If a mic really did just get plugged
    // in, this is what actually lets the person start talking again.
    if (muted && !micStreamRef.current) {
      const gotMic = await connectMicrophone();
      if (!gotMic) {
        useStore.getState().pushNotice('Ainda não encontrei um microfone. Conecte um e tente novamente.');
        return;
      }
      setMuted(false);
      broadcastState({ muted: false });
      return;
    }
    setMuted((prev) => {
      const next = !prev;
      // Mexe direto na faixa que está REALMENTE indo pra chamada (ver
      // comentário do localAudioTrackRef) — nunca mais na faixa crua do
      // microfone, que pode não ser a mesma quando o RNNoise está ativo.
      if (localAudioTrackRef.current) localAudioTrackRef.current.enabled = !next;
      broadcastState({ muted: next });
      return next;
    });
  }, [broadcastState, myRole, muted, connectMicrophone]);

  const toggleDeafen = useCallback(() => {
    setDeafened((prev) => {
      const next = !prev;
      // Deafening also mutes your own mic, matching Discord's behavior.
      if (next && localAudioTrackRef.current) {
        localAudioTrackRef.current.enabled = false;
        setMuted(true);
      }
      broadcastState({ deafened: next, muted: next ? true : muted });
      return next;
    });
  }, [broadcastState, muted]);

  const toggleCamera = useCallback(async () => {
    if (cameraOn) {
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      const track = cameraStreamRef.current?.getVideoTracks()[0];
      Object.values(peersRef.current).forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track === track);
        if (sender) pc.removeTrack(sender);
      });
      cameraStreamRef.current = null;
      setCameraOn(false);
      broadcastState({ video: false });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } });
      // Tag with a well-known id prefix so peers can distinguish this from a screen share track.
      Object.defineProperty(stream, 'id', { value: `camera-${user.id}`, configurable: true });
      cameraStreamRef.current = stream;
      Object.values(peersRef.current).forEach(({ pc }) => pc.addTrack(stream.getVideoTracks()[0], stream));
      setCameraOn(true);
      broadcastState({ video: true });
    } catch (err) {
      alert('Não foi possível acessar a câmera.');
    }
  }, [cameraOn, broadcastState, user?.id]);

  const toggleScreenShare = useCallback(async (options = {}) => {
    if (screenOn) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      const track = screenStreamRef.current?.getVideoTracks()[0];
      Object.values(peersRef.current).forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track === track);
        if (sender) pc.removeTrack(sender);
      });
      screenStreamRef.current = null;
      setScreenOn(false);
      broadcastState({ screenSharing: false });
      return;
    }
    // Most mobile browsers — notably iOS Safari, and many in-app/embedded
    // browsers on Android — don't expose the Screen Capture API to web
    // pages at all. Without this check the button just silently did
    // nothing on those devices (the call below threw, and the catch
    // swallowed it thinking it was just a cancelled picker), which looked
    // exactly like a broken feature instead of an unsupported one.
    // The Android app is a separate case worth its own message: the
    // Chromium-based WebView *defines* getDisplayMedia (so the check below
    // alone wouldn't catch it) but doesn't implement the actual capture
    // picker — calling it just fails silently. True screen capture from
    // this app would need a dedicated native plugin (Android's
    // MediaProjection API), not something fixable from the web side alone.
    const isNativeApp = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
    if (isNativeApp) {
      useStore.getState().pushNotice('Compartilhar tela ainda não é possível pelo app Android — use pelo navegador (Chrome) por enquanto.');
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      useStore.getState().pushNotice('Compartilhar tela não é suportado neste navegador. No celular, tente pelo Chrome mais recente no Android — no Safari/iOS ainda não é possível.');
      return;
    }
    const { quality = '1080p', frameRate = 30, deviceId } = options;
    const dims = QUALITY_PRESETS[quality] || QUALITY_PRESETS['1080p'];
    try {
      let stream;
      if (deviceId) {
        // "Dispositivos" category (ScreenShareModal) — the one part of the
        // new share menu that CAN be a real custom in-app list (cameras,
        // phones connected as a webcam, etc via enumerateDevices), since
        // unlike windows/screens a page is allowed to enumerate and pick a
        // capture *device* directly with getUserMedia — no native picker
        // needed at all for this branch.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId }, width: { ideal: dims.width }, height: { ideal: dims.height }, frameRate: { ideal: frameRate } },
        });
      } else {
        // "Aplicativos" (janelas) / "Tela Inteira" (monitores) categories —
        // displaySurface only *hints* the browser's native picker to
        // pre-filter/prioritize that category, it can't skip the picker
        // entirely (see the top-of-file comment). selfBrowserSurface:
        // 'exclude' is what actually removes "This Tab"/current-tab from
        // ever being offered, which is the specific "não quero mostrar a
        // tela do próprio navegador" behavior that was requested.
        const displaySurface = options.displaySurface || 'monitor';
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface, width: { ideal: dims.width }, height: { ideal: dims.height }, frameRate: { ideal: frameRate } },
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'exclude',
        });
      }
      Object.defineProperty(stream, 'id', { value: `screen-${user.id}`, configurable: true });
      screenStreamRef.current = stream;
      Object.values(peersRef.current).forEach(({ pc }) => pc.addTrack(stream.getVideoTracks()[0], stream));
      // A picked camera/device stream has no native "stop sharing" bar (that
      // only exists for getDisplayMedia captures), so it never fires
      // `onended` on its own — the call bar's own toggle button is the only
      // way to stop it, which is fine since toggleScreenShare() already
      // works as a manual on/off switch either way.
      stream.getVideoTracks()[0].onended = () => toggleScreenShare();
      setScreenOn(true);
      broadcastState({ screenSharing: true });
    } catch (err) {
      // AbortError/NotAllowedError just mean the person cancelled the share
      // picker (the native "choose a screen/window/tab" dialog) or denied
      // it — not worth surfacing. Anything else (hardware issue, an
      // actually-unsupported call that threw instead of rejecting cleanly,
      // etc.) is worth telling them about instead of failing silently.
      if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') {
        useStore.getState().pushNotice('Não foi possível compartilhar a tela.');
      }
    }
  }, [screenOn, broadcastState, user?.id]);

  const setParticipantVolume = useCallback((userId, volume) => {
    setVolumes((s) => ({ ...s, [userId]: volume }));
  }, []);

  // --- Stage: raise hand / promote / demote ---
  const raiseHand = useCallback((raised = true) => {
    if (!socket || !callRef.current) return;
    socket.emit('voice:raise-hand', { channelId: callRef.current.channelId, raised });
    setHandsRaised((s) => ({ ...s, [user.id]: raised }));
  }, [socket, user?.id]);

  const setParticipantRole = useCallback((targetUserId, role) => {
    if (!socket || !callRef.current) return;
    socket.emit('voice:set-role', { channelId: callRef.current.channelId, userId: targetUserId, role });
  }, [socket]);

  const stepDownFromStage = useCallback(() => setParticipantRole(user?.id, 'audience'), [setParticipantRole, user?.id]);

  useEffect(() => () => { if (callRef.current) leaveChannel(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <VoiceContext.Provider value={{
      call, muted, micMissing, deafened, cameraOn, screenOn, participants, roster, rosterStartedAt, rosterSpeaking, myRole, handsRaised,
      localSpeaking,
      remoteCameraStreams, remoteScreenStreams, remoteAudioStreams, volumes,
      localCameraStream: cameraStreamRef.current, localScreenStream: screenStreamRef.current,
      joinChannel, leaveChannel, toggleMute, toggleDeafen, toggleCamera, toggleScreenShare, setParticipantVolume,
      raiseHand, setParticipantRole, stepDownFromStage,
      incomingCall, answerIncomingCall, declineIncomingCall,
      switchMicrophone,
    }}
    >
      {children}
    </VoiceContext.Provider>
  );
}

export function useVoice() {
  return useContext(VoiceContext);
}
