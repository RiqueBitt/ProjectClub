import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useSocket } from './SocketContext.jsx';
import { useStore } from '../store/useStore';
import { playSound, playEntrySound } from '../utils/sounds';
import { getExtra } from '../utils/extraPrefs';
import { getPreferredMicId, setPreferredMicId, getPreferredCameraId } from '../utils/audioDevices';
import { getVoiceJoin, updateUserSettings } from '../api/endpoints';
import { cleanLocalVolumes, mergeVolumesOnLogin, toServerPatch, capLocal } from '../utils/voiceVolumes';
import { summarizeAgoraStats, pushSample } from '../voice/connectionStats.js';
import { getVoicePref, onVoicePrefsChange, setVoicePref, makeReactionRateLimiter, isValidReaction } from '../utils/voicePrefs';
import { buildScreenShareConfig, collectScreenPublishTracks } from '../utils/screenShareTracks';
// Cadeia de provedores de mídia (servidor próprio → Agora → Stream) — ver
// client/src/voice/* e docs/voice-fallback.md. O caminho do Agora é embutido
// aqui; os DEMAIS engines (LiveKit completo, Jitsi reserva, e os pendentes)
// vêm do engineRegistry e só são baixados/instanciados quando a cadeia os
// escolhe. A troca ao vivo entre QUAISQUER dois provedores preserva a sessão,
// o socket, o roster, as reações e o soundboard — só a camada de mídia troca.
import { readJoinResponse, isClientReady, providerLabel, PRIMARY_PROVIDER } from '../voice/providerDecision.js';
import { createEngine, CLIENT_READY_PROVIDERS } from '../voice/engineRegistry.js';
import { isReserveMode } from '../voice/providerDecision.js';
// Item pedido: "no .apk, se sair do app, continua na call em segundo
// plano" — sem isso, o Android mata o áudio da chamada poucos segundos
// depois de minimizar o app. Importado direto (não via window.Capacitor)
// porque @capacitor/core já é dependência do projeto e funciona igual em
// qualquer plataforma: em web/desktop, isNativePlatform() já resolve
// pra false sozinho, então as funções abaixo viram no-op automático sem
// precisar de nenhum "if" espalhado pelo resto do arquivo.
import { Capacitor } from '@capacitor/core';
import { startAndroidScreenShare, stopAndroidScreenShare } from '../native/androidScreenShare';

// "Testar antes de entrar" — só baixa o painel quando alguém vai entrar.
const PreJoinPanel = lazy(() => import('../components/voice/PreJoinPanel.jsx'));

let BackgroundModePlugin = null;
async function getBackgroundMode() {
  if (Capacitor.getPlatform() !== 'android') return null;
  if (!BackgroundModePlugin) {
    const mod = await import('@anuradev/capacitor-background-mode');
    BackgroundModePlugin = mod.BackgroundMode;
  }
  return BackgroundModePlugin;
}

async function startCallForegroundService(channelName) {
  // Atualização automática do app não recarrega a página no meio de uma call.
  window.__pcInCall = true;
  try {
    const bm = await getBackgroundMode();
    if (!bm) return;
    // BUG CORRIGIDO ("sai do app e a call para/não funciona em segundo
    // plano"): o serviço de primeiro plano sozinho (usado antes) só
    // impede o Android de MATAR o processo — não impede o WebView de
    // CONGELAR o JavaScript quando a tela fica invisível, que é uma
    // otimização de bateria separada e mais agressiva. O plugin antigo
    // não tinha como resolver essa parte; esse aqui resolve as DUAS ao
    // mesmo tempo: `allowMicrophoneInBackground` mantém o microfone
    // ativo, e `disableWebViewOptimization: true` engana o Android
    // fazendo ele achar que a tela do app CONTINUA visível mesmo
    // minimizado — é isso que impede o JavaScript (e portanto o Agora,
    // que roda inteiro dentro dele) de ser pausado.
    await bm.requestNotificationsPermission().catch(() => {});
    await bm.requestMicrophonePermission().catch(() => {});
    await bm.enable({
      title: 'Project Club — Em chamada de voz',
      text: channelName || 'Conectado',
      silent: true,
      allowMicrophoneInBackground: true,
      disableWebViewOptimization: true,
      channelName: 'Chamada de voz',
    });
  } catch (err) {
    console.error('[voz] Não foi possível iniciar o serviço em segundo plano (Android):', err);
  }
}

async function stopCallForegroundService() {
  window.__pcInCall = false;
  try {
    const bm = await getBackgroundMode();
    if (!bm) return;
    await bm.disable();
  } catch { /* nem tinha serviço rodando — ok */ }
}

const VoiceContext = createContext(null);

// Item pedido ("site demora pra carregar"): o SDK do Agora só é
// carregado de verdade na primeira vez que alguém entra numa chamada de
// voz — não faz parte do carregamento inicial do site mais. Pra quem só
// navega pelo chat/feeds sem nunca usar voz, esses ~500kB comprimidos
// nunca chegam a ser baixados. As chamadas seguintes reaproveitam a
// mesma promise (nunca baixa duas vezes).
let agoraRtcPromise = null;
// Falha do provedor de voz: avisa o servidor (aparece nos logs como
// [erro-de-tela] voz:<provedor>) e devolve a mensagem certa pra pessoa.
// CAN_NOT_GET_GATEWAY_SERVER = o Agora recusou o projeto/credencial (conta
// desativada, minutos acabaram ou certificado trocado) — não é a internet.
function reportVoiceFailure(provider, err) {
  const message = String(err?.message || err || '').slice(0, 400);
  try {
    fetch('/api/system/client-error', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ where: `voz:${provider}`, path: window.location.pathname, message, stack: String(err?.stack || '').slice(0, 800) }),
    }).catch(() => {});
  } catch { /* sem rede */ }
  if (/CAN_NOT_GET_GATEWAY_SERVER|invalid vendor key|dynamic use static key|token/i.test(message)) {
    return 'O serviço de voz recusou a conexão (configuração do servidor de chamadas). A equipe já foi avisada — tente mais tarde.';
  }
  return 'Não foi possível conectar à chamada de voz agora. Tente de novo em instantes.';
}

function loadAgoraRTC() {
  if (!agoraRtcPromise) {
    agoraRtcPromise = import('agora-rtc-sdk-ng').then((mod) => mod.default);
  }
  return agoraRtcPromise;
}

// Item pedido: "deixando mais rápido pra entrar em canais de voz,
// principalmente no mobile" — sem isso, o download de ~1.5MB do SDK
// só começava no exato momento em que a pessoa clicava pra entrar
// numa call, e em rede móvel esse download sozinho já podia levar
// vários segundos, antes mesmo de qualquer outro passo da conexão
// começar. Chamado pela ÁREA de comunidade (CommunityPage.jsx, onde
// os canais de voz aparecem — não o app inteiro, pra continuar sem
// baixar nada à toa pra quem só usa Feeds/Perfil/etc), adianta esse
// download em segundo plano, sem travar nada — quando a pessoa
// realmente clicar pra entrar, é bem provável que o SDK já esteja
// pronto (ou pelo menos bem adiantado), reduzindo o tempo de espera
// percebido justamente na rede mais lenta, onde mais importa.
export function preloadAgoraRTC() {
  loadAgoraRTC().catch(() => {}); // silencioso — se falhar aqui, tenta de novo na hora de entrar mesmo
}

// MIGRAÇÃO PRA AGORA.IO (item pedido): depois de uma investigação bem
// longa e com prova concreta (diagnóstico de SDP real — ver histórico),
// ficou provado que a malha própria de WebRTC (peer-to-peer, com nosso
// próprio TURN/STUN e sinalização por Socket.IO) tinha o outro lado de
// uma conexão específica respondendo "recvonly" mesmo recebendo uma
// oferta "sendrecv" — algo fora do nosso controle direto (lado do
// cliente do outro participante). Em vez de continuar depurando às
// cegas o próprio protocolo, a chamada de voz inteira agora usa o Agora
// (um serviço de mídia GERENCIADO, com SFU deles, muito mais robusto
// contra esse tipo de problema de rede/negociação do que uma malha P2P
// artesanal) — não precisamos mais hospedar nem STUN nem TURN próprios.
//
// O que NÃO mudou: toda a parte de "quem está em qual sala", papéis
// (palco/plateia), mão levantada, soundboard, chamada de DM tocando —
// tudo isso continua sendo pura sinalização via Socket.IO
// (server/src/sockets/index.js), sem nenhuma relação com o Agora. Só a
// transmissão de mídia em si (áudio/câmera/tela) trocou de mecanismo.
const QUALITY_PRESETS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

// O token/credenciais do provedor (Agora OU Jitsi) são pedidos agora pelo
// fluxo unificado /api/voice/join (ver getVoiceJoin + joinChannel abaixo),
// que já faz a checagem de acesso e devolve qual provedor usar. Sempre um
// token fresco na hora de entrar — nunca reaproveita um velho.

// Volume individual por pessoa/transmissão (0 a 2 = 0% a 200%). Fica salvo
// NA CONTA (UserSettings.voiceVolumes, 0..200 — segue a pessoa entre PC,
// site e celular); o localStorage é só o cache rápido deste aparelho, por
// conta (trocar de conta no mesmo aparelho não mistura os volumes).
// Chave = id do usuário ouvido.
const VOLUMES_KEY = 'pc.voiceVolumes';
const volumesKey = (meId) => (meId ? `${VOLUMES_KEY}:${meId}` : VOLUMES_KEY);
function loadSavedVolumes(meId) {
  try {
    // Cache antigo (antes de ser por conta) vale como ponto de partida.
    const raw = JSON.parse(localStorage.getItem(volumesKey(meId)) || localStorage.getItem(VOLUMES_KEY) || '{}');
    return cleanLocalVolumes(raw);
  } catch { return {}; }
}
function saveVolumes(meId, v) {
  try { localStorage.setItem(volumesKey(meId), JSON.stringify(v)); } catch { /* sem storage — só não lembra */ }
}
// Espera entre a última mudança de volume e o envio pra conta (arrastar o
// controle gera dezenas de mudanças — sobe só uma vez no final).
const VOLUME_SAVE_DEBOUNCE_MS = 1500;
function dropKey(obj, key) {
  if (!(key in obj)) return obj;
  const n = { ...obj }; delete n[key]; return n;
}
// Intervalo da reconciliação com o servidor enquanto está numa chamada.
const VOICE_SYNC_MS = 20000;

export function VoiceProvider({ children }) {
  const { user } = useAuth();
  const { socket } = useSocket();

  const [call, setCall] = useState(null); // { serverId, channelId, channelName, channelType }
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const [micMissing, setMicMissing] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const entrySoundSentRef = useRef(null);
  // Sons de feedback (mutar, áudio, câmera, transmissão) — só durante a
  // call e só quando o estado muda de verdade (não ao entrar/sair).
  const fxPrevRef = useRef(null);
  useEffect(() => {
    const now = { id: call?.channelId || null, muted, deafened, cameraOn, screenOn };
    const prev = fxPrevRef.current;
    fxPrevRef.current = now;
    if (!now.id) { entrySoundSentRef.current = null; return; }
    if (!prev || prev.id !== now.id) return;
    if (prev.deafened !== deafened) playSound(deafened ? 'deafen' : 'undeafen', 0.4);
    else if (prev.muted !== muted) playSound(muted ? 'mute' : 'unmute', 0.4);
    if (prev.cameraOn !== cameraOn) playSound(cameraOn ? 'camOn' : 'camOff', 0.4);
    if (prev.screenOn !== screenOn) playSound(screenOn ? 'streamStart' : 'streamStop', 0.4);
  }, [call?.channelId, muted, deafened, cameraOn, screenOn]);
  // Provedor de mídia ATIVO nesta chamada: 'agora' (normal) ou 'jitsi'
  // (reserva, quando o Agora está perto do limite mensal). Dirige a UI
  // ("Chamada em modo reserva") e para qual engine os botões falam.
  const [provider, setProvider] = useState('agora');
  const activeProviderRef = useRef('agora');
  useEffect(() => { activeProviderRef.current = provider; }, [provider]);
  // Troca de provedor no meio da chamada (Agora → Jitsi): mostra um aviso
  // curto "reconectando a chamada…" enquanto refaz a conexão, sem deslogar.
  const [reconnectingProvider, setReconnectingProvider] = useState(false);
  // Reconexão automática do ENGINE (caiu o wi-fi, celular bloqueou): o
  // engine refaz a sessão sozinho e avisa aqui — a UI mostra "reconectando"
  // em vez de derrubar a pessoa da sala. { attempt } enquanto tenta; null ok.
  const [reconnecting, setReconnecting] = useState(null);
  const [myRole, setMyRole] = useState('speaker');
  const [handsRaised, setHandsRaised] = useState({});
  const [participants, setParticipants] = useState({});
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const localSpeakingRef = useRef(false);
  // Extras de voz: último instante com som no mic local (aviso "microfone
  // sem som") e qualidade de rede por uid (Agora network-quality, 0-6).
  const localSoundAtRef = useRef(0);
  const [netQuality, setNetQuality] = useState({});
  // Barra de chamada: ping (RTT até o Agora, ms), hora em que EU entrei
  // (tempo de chamada) e qualidade atual da transmissão de tela.
  const [myRtt, setMyRtt] = useState(null);
  const [callStartedAt, setCallStartedAt] = useState(null);
  const [screenQuality, setScreenQuality] = useState(null); // { quality, frameRate }
  // Reações rápidas (I): emojis flutuantes efêmeros. Cada item some sozinho.
  const [reactions, setReactions] = useState([]); // { id, userId, emoji, at }
  const reactionLimiterRef = useRef(makeReactionRateLimiter());
  const reactionSeqRef = useRef(0);
  // Gravação com consentimento (N).
  const [recording, setRecording] = useState(null); // { byUserId, byName } enquanto grava
  const [recordingPrompt, setRecordingPrompt] = useState(null); // { requesterId, requesterName } enquanto pergunta
  const [recordingConsents, setRecordingConsents] = useState({}); // userId -> boolean (pra quem pediu ver)
  // Apertar pra falar (F): quando ligado, o mic só vai ao ar enquanto a
  // tecla está pressionada. `pttTalking` = segurando a tecla agora.
  const [pttEnabled, setPttEnabled] = useState(() => getVoicePref('pushToTalkEnabled') === true);
  const [pttTalking, setPttTalking] = useState(false);
  const pttTalkingRef = useRef(false);
  // BUG CORRIGIDO ("transmitindo mas aparece como câmera / não aparece
  // a tela"): antes, cada vídeo remoto era classificado UMA vez, no
  // momento em que chegava do Agora, como "tela" ou "câmera" olhando o
  // estado do socket. Só que o aviso "estou transmitindo" (voice:state)
  // é enviado DEPOIS de publicar, então quase sempre o vídeo chegava
  // antes e era guardado como câmera pra sempre. Agora guarda um vídeo
  // por pessoa e decide tela/câmera na hora de mostrar (useMemo abaixo),
  // então se corrige sozinho assim que o estado chega.
  const [remoteVideoStreams, setRemoteVideoStreams] = useState({});
  const [remoteAudioStreams, setRemoteAudioStreams] = useState({});
  // Quem está conectado na mídia (Agora) agora — usado pra nunca
  // esconder alguém que está na chamada de verdade só porque um evento
  // de socket se perdeu.
  const [mediaUids, setMediaUids] = useState({});
  const [volumes, setVolumes] = useState(() => loadSavedVolumes(user?.id));
  // Mudanças de volume ainda não enviadas pra conta ({ userId: ganho }).
  const pendingVolumesRef = useRef({});
  const volumeSaveTimerRef = useRef(null);
  const volumesMergedForRef = useRef(null);
  // Ping dos últimos ~60s (painel "Qualidade da conexão"). Ref — não
  // re-renderiza a cada amostra; o painel lê quando está aberto.
  const pingHistoryRef = useRef([]);
  const recordPing = useCallback((rtt) => {
    if (Number.isFinite(rtt) && rtt > 0) pingHistoryRef.current = pushSample(pingHistoryRef.current, Math.round(rtt));
  }, []);
  // "Testar antes de entrar": canal escolhido esperando a pessoa confirmar.
  const [preJoin, setPreJoin] = useState(null); // { serverId, channelId, channelName, channelType }
  // Entrou pedindo câmera ligada: liga assim que a chamada aparecer.
  const pendingCameraRef = useRef(null);
  const [roster, setRoster] = useState({});
  const [rosterStartedAt, setRosterStartedAt] = useState({});
  const [rosterSpeaking, setRosterSpeaking] = useState({});
  const [incomingCall, setIncomingCall] = useState(null);
  // Espelho de vídeo local pra expor no Provider (ver embaixo) sem
  // precisar de mais um useState só pra isso.
  const [, forceLocalVideoTick] = useState(0);

  const callRef = useRef(null);
  const joiningChannelIdRef = useRef(null);
  // Item pedido: mostrar "Entrando..." no botão de entrar na chamada,
  // desabilitado, enquanto o processo ainda não terminou — diferente
  // de joiningChannelIdRef (só uma referência, não causa nova
  // renderização sozinha), esse ESTADO de verdade atualiza a tela na
  // hora que muda.
  const [joiningChannelId, setJoiningChannelId] = useState(null);
  const leaveChannelRef = useRef(null);
  const soundboardAudiosRef = useRef({});

  const agoraClientRef = useRef(null);
  // Engine do Jitsi (modo reserva) + "host" persistente onde o iframe fica
  // ancorado mesmo quando a tela da chamada não está montada (pra o áudio
  // continuar em segundo plano/janelinha). O VoiceChannelView "pega
  // emprestado" o nó enquanto está aberto (attachJitsi/detachJitsi).
  const mediaEngineRef = useRef(null);
  const jitsiHostRef = useRef(null);
  const [jitsiNode, setJitsiNode] = useState(null);
  // Mídia LOCAL (câmera/tela) quando o provedor ativo é um engine de grade
  // própria SEM faixas do Agora (ex.: LiveKit) — o engine devolve o
  // MediaStream local e guardamos aqui pra o auto-retrato aparecer na grade.
  const [engineLocalCameraStream, setEngineLocalCameraStream] = useState(null);
  const [engineLocalScreenStream, setEngineLocalScreenStream] = useState(null);
  const localAudioTrackRef = useRef(null);
  const cameraTrackRef = useRef(null);
  const screenTrackRef = useRef(null);
  const androidScreenTrackRef = useRef(null);
  const screenAudioTrackRef = useRef(null);
  // Item pedido: "bug de clique duplo" nos botões — mudo/câmera/tela são
  // funções assíncronas (esperam o Agora responder); clicar rápido demais
  // podia disparar a mesma ação duas vezes antes da primeira terminar,
  // criando/fechando a mesma faixa em cima da outra. Uma trava simples
  // por botão (ref, não estado — não precisa re-renderizar por causa
  // disso) ignora cliques extras enquanto a ação anterior ainda não
  // terminou.
  const toggleMuteBusyRef = useRef(false);
  const toggleCameraBusyRef = useRef(false);
  const toggleScreenShareBusyRef = useRef(false);
  // Espelhos em ref do estado local, lidos pelos listeners do socket sem
  // precisar re-registrar tudo a cada clique (ver o efeito dos listeners).
  const localStateRef = useRef({ muted: false, deafened: false, video: false, screenSharing: false });
  useEffect(() => {
    localStateRef.current = { muted, deafened, video: cameraOn, screenSharing: screenOn };
  }, [muted, deafened, cameraOn, screenOn]);
  // Pedido de reconciliação "em breve" (agrupa vários gatilhos num só).
  const syncTimerRef = useRef(null);
  const requestSync = useCallback((delay = 1500) => {
    if (syncTimerRef.current) return;
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      const current = callRef.current;
      if (current && socket?.connected) socket.emit('voice:sync', { channelId: current.channelId });
    }, delay);
  }, [socket]);
  const requestSyncRef = useRef(requestSync);
  useEffect(() => { requestSyncRef.current = requestSync; }, [requestSync]);

  const broadcastState = useCallback((patch) => {
    if (!socket || !callRef.current) return;
    socket.emit('voice:state', { channelId: callRef.current.channelId, ...patch });
  }, [socket]);

  // ---------- Modo reserva (Jitsi): host persistente + anexar/soltar ----------
  // Um <div> fixo e fora da tela guarda o iframe do Jitsi enquanto nenhuma
  // tela de chamada está mostrando — assim o áudio nunca para só porque a
  // pessoa navegou pra outra aba do app. Não usa display:none (alguns
  // navegadores pausam a mídia); fica posicionado fora da área visível.
  const ensureJitsiHost = useCallback(() => {
    if (jitsiHostRef.current || typeof document === 'undefined') return jitsiHostRef.current;
    const host = document.createElement('div');
    host.setAttribute('data-jitsi-host', '');
    host.style.position = 'fixed';
    host.style.left = '-99999px';
    host.style.top = '0';
    host.style.width = '320px';
    host.style.height = '240px';
    host.style.pointerEvents = 'none';
    document.body.appendChild(host);
    jitsiHostRef.current = host;
    return host;
  }, []);
  // VoiceChannelView chama isto pra trazer o iframe pra dentro do palco
  // visível enquanto a tela está aberta, e devolvê-lo ao host ao sair.
  const attachJitsi = useCallback((container) => {
    const engine = mediaEngineRef.current;
    if (!engine || !container) return;
    const node = engine.getNode();
    if (node && node.parentNode !== container) container.appendChild(node);
  }, []);
  const detachJitsi = useCallback(() => {
    const engine = mediaEngineRef.current;
    const host = jitsiHostRef.current;
    if (!engine || !host) return;
    const node = engine.getNode();
    if (node && node.parentNode !== host) host.appendChild(node);
  }, []);

  const setupAgoraClient = useCallback(async () => {
    const AgoraRTC = await loadAgoraRTC();
    const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

    // Alguém entrou na mídia. Se o socket ainda não contou, pede um
    // retrato novo pro servidor (corrige "está na call e não aparece").
    client.on('user-joined', (remoteUser) => {
      const uid = String(remoteUser.uid);
      setMediaUids((s) => (s[uid] ? s : { ...s, [uid]: true }));
      if (!useStore.getState().voiceParticipantsSnapshot?.[uid]) requestSyncRef.current?.();
    });

    client.on('user-published', async (remoteUser, mediaType) => {
      try {
        await client.subscribe(remoteUser, mediaType);
      } catch (err) {
        console.error('[voz] Falha ao se inscrever na mídia de', remoteUser.uid, err);
        return;
      }
      if (agoraClientRef.current !== client) return; // cliente antigo (já saiu)
      const uid = String(remoteUser.uid);
      setMediaUids((s) => (s[uid] ? s : { ...s, [uid]: true }));
      if (mediaType === 'audio') {
        // BUG CORRIGIDO ("eco na voz"): o áudio estava sendo tocado DUAS
        // VEZES ao mesmo tempo — uma vez aqui (remoteUser.audioTrack.
        // play(), que o Agora toca sozinho por baixo dos panos criando
        // um <audio> escondido) e outra vez pelo componente AudioSink
        // (CallBar.jsx), que já pega essa mesma faixa via
        // remoteAudioStreams e toca de novo com seu próprio controle de
        // volume por pessoa. Duas reproduções da MESMA faixa, com
        // latência levemente diferente uma da outra, é exatamente o que
        // soa como eco. O AudioSink sozinho já é suficiente (e melhor —
        // tem volume por pessoa e escolha de dispositivo de saída), then
        // não chama mais .play() aqui.
        const mediaStream = new MediaStream([remoteUser.audioTrack.getMediaStreamTrack()]);
        setRemoteAudioStreams((s) => ({ ...s, [uid]: mediaStream }));
      } else if (mediaType === 'video') {
        const mediaStream = new MediaStream([remoteUser.videoTrack.getMediaStreamTrack()]);
        setRemoteVideoStreams((s) => ({ ...s, [uid]: mediaStream }));
      }
    });

    client.on('user-unpublished', (remoteUser, mediaType) => {
      const uid = String(remoteUser.uid);
      if (mediaType === 'audio') setRemoteAudioStreams((s) => dropKey(s, uid));
      else if (mediaType === 'video') setRemoteVideoStreams((s) => dropKey(s, uid));
    });

    client.on('user-left', (remoteUser) => {
      const uid = String(remoteUser.uid);
      setRemoteAudioStreams((s) => dropKey(s, uid));
      setRemoteVideoStreams((s) => dropKey(s, uid));
      setMediaUids((s) => dropKey(s, uid));
    });

    client.enableAudioVolumeIndicator();
    client.on('volume-indicator', (list) => {
      list.forEach(({ uid, level }) => {
        const speaking = level > 15;
        const uidStr = String(uid);
        if (uidStr === String(user?.id)) {
          if (level >= 1) localSoundAtRef.current = Date.now();
          // Só avisa/re-renderiza quando muda (antes o emit ficava dentro
          // do updater do setState, que o React pode rodar duas vezes).
          if (localSpeakingRef.current !== speaking) {
            localSpeakingRef.current = speaking;
            setLocalSpeaking(speaking);
            socket?.emit('voice:speaking', { channelId: callRef.current?.channelId, speaking });
          }
        } else {
          setParticipants((s) => (s[uidStr] && !!s[uidStr].speaking !== speaking ? { ...s, [uidStr]: { ...s[uidStr], speaking } } : s));
        }
      });
    });

    // Qualidade da conexão (a cada ~2s): a minha + a dos outros. Só
    // re-renderiza quando algum valor muda.
    client.on('network-quality', (stats) => {
      try {
        const next = { [String(user?.id)]: Math.max(stats?.uplinkNetworkQuality || 0, stats?.downlinkNetworkQuality || 0) };
        const remote = client.getRemoteNetworkQuality?.() || {};
        Object.entries(remote).forEach(([uid, q]) => { next[String(uid)] = Math.max(q?.uplinkNetworkQuality || 0, q?.downlinkNetworkQuality || 0); });
        setNetQuality((prev) => {
          const keys = Object.keys(next);
          return keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]) ? prev : next;
        });
      } catch { /* versão do SDK sem isso — só não mostra */ }
      // Ping (ida e volta até o servidor do Agora). Arredonda pra não
      // re-renderizar por 1ms de diferença.
      try {
        const rtt = client.getRTCStats?.()?.RTT;
        recordPing(rtt);
        if (Number.isFinite(rtt) && rtt > 0) {
          const r = Math.round(rtt / 5) * 5;
          setMyRtt((prev) => (prev === r ? prev : r));
        }
      } catch { /* sem estatística — só não mostra o ping */ }
    });

    agoraClientRef.current = client;
    return client;
  }, [socket, user?.id, recordPing]);

  // Lista mostrada na tela = quem o servidor diz que está na sala + quem
  // está conectado na mídia mas o socket ainda não contou (evento perdido,
  // reconexão no meio). Assim ninguém "some" estando na chamada.
  const shownParticipants = useMemo(() => {
    const extra = Object.keys(mediaUids).filter((uid) => !participants[uid] && uid !== String(user?.id));
    if (extra.length === 0) return participants;
    const merged = { ...participants };
    extra.forEach((uid) => {
      merged[uid] = { muted: !remoteAudioStreams[uid], deafened: false, video: false, screenSharing: false, role: 'speaker' };
    });
    return merged;
  }, [participants, mediaUids, remoteAudioStreams, user?.id]);

  // Tela x câmera decidido na hora de mostrar (ver remoteVideoStreams).
  const { remoteCameraStreams, remoteScreenStreams } = useMemo(() => {
    const cams = {}; const screens = {};
    Object.entries(remoteVideoStreams).forEach(([uid, stream]) => {
      if (participants[uid]?.screenSharing) screens[uid] = stream;
      else cams[uid] = stream;
    });
    return { remoteCameraStreams: cams, remoteScreenStreams: screens };
  }, [remoteVideoStreams, participants]);

  useEffect(() => {
    useStore.setState({ voiceParticipantsSnapshot: participants });
  }, [participants]);

  const connectMicrophone = useCallback(async () => {
    const AgoraRTC = await loadAgoraRTC();
    const preferredId = getPreferredMicId();
    // Item pedido B ("Redutor de ruído"): quando ligado (padrão), usa o
    // processamento de áudio do Agora — AEC (cancela eco), ANS (suprime
    // ruído de fundo: ventilador, teclado, chiado) e AGC (nivela o
    // volume). Desligado, o microfone vai "cru", sem nenhum tratamento —
    // útil pra quem usa microfone de estúdio/interface e prefere o som
    // original. A escolha fica guardada por dispositivo (voicePrefs).
    const denoise = getVoicePref('noiseReduction') !== false;
    const baseConfig = {
      AEC: denoise, ANS: denoise, AGC: denoise,
      // Item pedido: "voz mais viva, melhorando o áudio" — high_quality
      // já usava a maior taxa de bits disponível (128kbps), mas em
      // MONO só. high_quality_stereo é o preset mais alto de verdade
      // que o Agora oferece (192kbps, DOIS canais, 48kHz) — voz em
      // estéreo soa muito mais presente/rica que mono, mesmo pra uma
      // única pessoa falando (o microfone capta nuances espaciais
      // sutis que o mono simplesmente descarta).
      encoderConfig: 'high_quality_stereo',
    };
    try {
      const track = await AgoraRTC.createMicrophoneAudioTrack({ microphoneId: preferredId || undefined, ...baseConfig });
      localAudioTrackRef.current = track;
      return true;
    } catch (err) {
      // Item pedido: "deixando o mais fácil possível... aproveitar
      // [o microfone] ao entrar num canal de voz" — se o dispositivo
      // SALVO como preferido não existir mais (a pessoa trocou de
      // fone, formatou o driver mudou de ID, etc), a chamada acima
      // falhava e a pessoa simplesmente não conseguia entrar com
      // áudio nenhum — mesmo tendo um microfone perfeitamente
      // funcional (só que outro) disponível no aparelho. Tenta de
      // novo sem especificar nenhum, deixando o Agora escolher o
      // padrão do sistema sozinho, em vez de desistir na primeira
      // falha.
      if (preferredId) {
        console.warn('[voz] microfone preferido indisponível, usando o padrão do sistema:', err);
        try {
          const track = await AgoraRTC.createMicrophoneAudioTrack(baseConfig);
          localAudioTrackRef.current = track;
          return true;
        } catch (fallbackErr) {
          console.error('[voz] Não foi possível acessar nenhum microfone:', fallbackErr);
        }
      } else {
        console.error('[voz] Não foi possível acessar o microfone:', err);
      }
      localAudioTrackRef.current = null;
      return false;
    }
  }, []);

  const switchMicrophone = useCallback(async (deviceId) => {
    setPreferredMicId(deviceId);
    if (!callRef.current || !localAudioTrackRef.current) return true;
    try {
      await localAudioTrackRef.current.setDevice(deviceId);
      return true;
    } catch (err) {
      console.error('[voz] não foi possível trocar de microfone:', err);
      return false;
    }
  }, []);

  // Desmonta o engine do Jitsi, se houver (sair da chamada ou trocar de
  // provedor). Seguro chamar mesmo quando não tem nenhum.
  const teardownEngine = useCallback(() => {
    const engine = mediaEngineRef.current;
    if (!engine) return;
    mediaEngineRef.current = null;
    setJitsiNode(null);
    setEngineLocalCameraStream(null);
    setEngineLocalScreenStream(null);
    try { engine.dispose(); } catch { /* já foi */ }
  }, []);

  // Encerra SÓ a mídia do Agora (faixas + cliente), SEM sair da sala no
  // nosso servidor nem limpar a UI — usado na troca de provedor no meio da
  // chamada (Agora → Jitsi), pra ninguém ser derrubado da sala/sessão.
  const teardownAgoraMedia = useCallback(async () => {
    const client = agoraClientRef.current;
    const tracks = [localAudioTrackRef.current, cameraTrackRef.current, screenTrackRef.current, screenAudioTrackRef.current];
    const hadAndroidScreen = !!androidScreenTrackRef.current;
    localAudioTrackRef.current = null;
    cameraTrackRef.current = null;
    screenTrackRef.current = null;
    screenAudioTrackRef.current = null;
    androidScreenTrackRef.current = null;
    agoraClientRef.current = null;
    setRemoteAudioStreams({});
    setRemoteVideoStreams({});
    setMediaUids({});
    client?.removeAllListeners?.();
    tracks.forEach((t) => { try { t?.close(); } catch { /* já fechada */ } });
    if (hadAndroidScreen) stopAndroidScreenShare();
    try { if (client) await client.leave(); } catch { /* já desconectado */ }
  }, []);

  // ---------- Conectar por um ENGINE da cadeia (não-Agora) ----------
  // Generaliza o antigo "conectar pelo Jitsi" pra QUALQUER provedor com
  // engine (jitsi, livekit, e os pendentes). O Jitsi embute uma conferência
  // num iframe (sem faixas pra nossa grade); o LiveKit é um SFU e entrega
  // faixas por participante, que caem na MESMA grade/AudioSink do Agora
  // (identidade = nosso userId). `isSwitch` = troca no meio de uma chamada já
  // ativa (não toca som de entrada, não zera o cronômetro, preserva o mudo).
  const connectEngine = useCallback(async ({ serverId, channelId, channelName, channelType, provider: prov, creds, isSwitch, quiet = false, startMuted: wantMuted = false }) => {
    const okCreds = (prov === 'projectclub' && creds?.url && creds?.token)
      || (prov === 'getstream' && creds?.apiKey && creds?.token && creds?.callId);
    if (!creds || !okCreds) {
      if (!quiet) useStore.getState().pushNotice('Não foi possível conectar à chamada de voz agora. Tente de novo em instantes.');
      return false;
    }
    teardownEngine();
    const callbacks = {
      onLeft: () => { leaveChannelRef.current?.(); },
      onReconnecting: (attempt) => { setReconnecting({ attempt }); setNetQuality({}); },
      onReconnected: () => { setReconnecting(null); },
      // Qualidade/ping vindos do engine (SFU próprio / LiveKit), na mesma
      // escala que o Agora usa — cai nos mesmos pontinhos/barras da UI.
      onNetQuality: (next) => {
        setNetQuality((prev) => {
          const keys = Object.keys(next);
          return keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]) ? prev : next;
        });
      },
      onRtt: (rtt) => { recordPing(rtt); const r = Math.round(rtt / 5) * 5; setMyRtt((prev) => (prev === r ? prev : r)); },
      // Fala: espelha no MEU anel verde e reemite pros outros pelo nosso
      // socket (igual ao Agora). No LiveKit também marca a fala dos outros.
      onLocalSpeaking: (speaking) => {
        if (localSpeakingRef.current === speaking) return;
        localSpeakingRef.current = speaking;
        setLocalSpeaking(speaking);
        socket?.emit('voice:speaking', { channelId: callRef.current?.channelId, speaking });
      },
      onRemoteSpeaking: (uid, speaking) => {
        const uidStr = String(uid);
        setParticipants((s) => (s[uidStr] && !!s[uidStr].speaking !== speaking ? { ...s, [uidStr]: { ...s[uidStr], speaking } } : s));
      },
      onSelfMute: (m) => { setMuted(m); broadcastState({ muted: m }); },
      onSelfCamera: (on) => { setCameraOn(on); broadcastState({ video: on }); },
      onSelfScreen: (on) => { setScreenOn(on); broadcastState({ screenSharing: on }); },
      onError: (ev, payload) => { console.error('[voz] engine de voz reportou um erro:', ev, payload); },
      // Faixas por participante (LiveKit/SFU) → mesma grade/AudioSink do Agora.
      onMediaUser: (uid, present) => {
        const uidStr = String(uid);
        if (present) setMediaUids((s) => (s[uidStr] ? s : { ...s, [uidStr]: true }));
        else setMediaUids((s) => dropKey(s, uidStr));
      },
      onRemoteAudio: (uid, stream) => setRemoteAudioStreams((s) => ({ ...s, [String(uid)]: stream })),
      onRemoteVideo: (uid, stream) => setRemoteVideoStreams((s) => ({ ...s, [String(uid)]: stream })),
      onRemoteRemove: (uid, kind) => {
        const uidStr = String(uid);
        if (kind === 'audio' || kind === 'all') setRemoteAudioStreams((s) => dropKey(s, uidStr));
        if (kind === 'video' || kind === 'all') setRemoteVideoStreams((s) => dropKey(s, uidStr));
        if (kind === 'all') setMediaUids((s) => dropKey(s, uidStr));
      },
    };
    const engine = createEngine(prov, callbacks, creds);
    if (!engine) {
      useStore.getState().pushNotice('Este provedor de voz ainda não está disponível neste aparelho.');
      return false;
    }
    mediaEngineRef.current = engine;
    // Jitsi tem um nó de iframe que ancoramos no host persistente; LiveKit e
    // os demais não têm nó (getNode()=null) — a grade é a nossa.
    const node = engine.getNode?.();
    if (node) { const host = ensureJitsiHost(); if (host) host.appendChild(node); }
    setJitsiNode(node || null);
    // Zera o auto-retrato local do engine anterior.
    setEngineLocalCameraStream(null);
    setEngineLocalScreenStream(null);
    try {
      const startMuted = isSwitch ? mutedRef.current : !!wantMuted;
      {
        await engine.join({
          ...creds, userId: user?.id, displayName: user?.displayName, startMuted,
          // Redutor de ruído (RNNoise) no engine próprio — mesma preferência
          // que liga o ANS do Agora.
          noiseSuppression: getVoicePref('noiseReduction') !== false,
        });
      }
    } catch (err) {
      console.error(`[voz] Falha ao conectar no provedor ${prov}:`, err);
      if (mediaEngineRef.current === engine) teardownEngine();
      const msg = reportVoiceFailure(prov, err);
      if (!quiet) useStore.getState().pushNotice(msg);
      return false;
    }
    if (!isSwitch && joiningChannelIdRef.current !== channelId) {
      if (mediaEngineRef.current === engine) teardownEngine();
      return false;
    }
    const next = { serverId, channelId, channelName, channelType };
    setCall(next);
    callRef.current = next;
    setProvider(prov);
    if (!isSwitch) {
      setCallStartedAt(Date.now());
      setMyRole('speaker');
      playSound('callJoin');
      startCallForegroundService(channelName);
      setIncomingCall((c) => (c && c.channelId === channelId ? null : c));
    }
    // Sinalização (roster/quem-está-na-sala) é sempre nossa, via socket —
    // independe do provedor de mídia.
    socket?.emit('voice:join', { channelId });
    return true;
  }, [socket, user?.id, user?.displayName, broadcastState, ensureJitsiHost, teardownEngine, recordPing]);
  const connectEngineRef = useRef(connectEngine);
  useEffect(() => { connectEngineRef.current = connectEngine; }, [connectEngine]);

  // ---------- Subir a mídia do Agora numa chamada JÁ ativa (troca pra Agora) ----------
  // Usado só na troca de provedor ao vivo quando a cadeia volta pro Agora
  // (ex.: a equipe forçou o Agora, ou virou o mês). Não mexe na sessão/socket
  // (a pessoa já está na sala), preserva o mudo atual e não zera o cronômetro.
  const connectAgoraMedia = useCallback(async ({ channelId, agora, isSwitch = true }) => {
    const { token, appId } = agora || {};
    if (!token || !appId) return false;
    const client = await setupAgoraClient();
    let gotMic = false;
    try {
      [, gotMic] = await Promise.all([
        client.join(appId, channelId, token, user.id),
        connectMicrophone(),
      ]);
    } catch (err) {
      console.error('[voz] Falha ao entrar no canal de mídia (troca pra Agora):', err);
      localAudioTrackRef.current?.close();
      localAudioTrackRef.current = null;
      client.removeAllListeners?.();
      client.leave().catch(() => {});
      if (agoraClientRef.current === client) agoraClientRef.current = null;
      return false;
    }
    setProvider('agora');
    setJitsiNode(null);
    if (!gotMic) {
      setMicMissing(true);
      setMuted(true);
      socket?.emit('voice:state', { channelId, muted: true });
      return true;
    }
    try {
      await client.publish([localAudioTrackRef.current]);
      // Preserva o mudo que a pessoa tinha antes da troca.
      if (mutedRef.current) localAudioTrackRef.current.setEnabled(false);
    } catch (err) {
      console.error('[voz] Falha ao publicar o microfone (troca pra Agora):', err);
    }
    void isSwitch;
    return true;
  }, [socket, setupAgoraClient, connectMicrophone, user?.id]);
  const connectAgoraMediaRef = useRef(connectAgoraMedia);
  useEffect(() => { connectAgoraMediaRef.current = connectAgoraMedia; }, [connectAgoraMedia]);

  // Aplica as escolhas do "Testar antes de entrar" logo depois de conectar.
  const applyJoinOptions = useCallback((channelId, opts = {}) => {
    if (opts.startMuted) {
      if (activeProviderRef.current === 'agora') localAudioTrackRef.current?.setEnabled(false);
      setMuted(true);
      socket?.emit('voice:state', { channelId, muted: true });
    }
    // A câmera liga pelo efeito que observa a chamada (precisa do provedor
    // e do cliente já prontos no estado).
    if (opts.startCamera) pendingCameraRef.current = channelId;
  }, [socket]);

  // Entra de verdade (sem o painel "Testar antes de entrar").
  // opts.startMuted: entra com o microfone mudo; opts.startCamera: liga a
  // câmera logo depois de conectar (escolhas do painel de pré-entrada).
  const joinChannelNow = useCallback(async (serverId, channelId, channelName, channelType, opts = {}) => {
    if (callRef.current?.channelId === channelId) return;
    if (joiningChannelIdRef.current === channelId) return;
    joiningChannelIdRef.current = channelId;
    setJoiningChannelId(channelId);
    try {
      if (callRef.current) await leaveChannel();

      // Garante que não sobrou nenhum engine (Jitsi/LiveKit) vivo.
      teardownEngine();

      // Pergunta ao servidor QUAL provedor da cadeia usar + as credenciais
      // dele, já com a checagem de acesso do canal. `CLIENT_READY_PROVIDERS`
      // diz quais este navegador sabe usar hoje (a cadeia pula os pendentes
      // só pra este join). Em paralelo, adianta o SDK do Agora (cacheado; se
      // a cadeia escolher outro, o custo é desprezível). Item pedido original
      // ("delay pra entrar"): o download pesado do SDK continua começando cedo.
      loadAgoraRTC().catch(() => {});
      // Failover automático: se o provedor escolhido não conectar (ex.: o
      // Agora recusando com CAN_NOT_GET_GATEWAY_SERVER, servidor próprio
      // fora), pede o PRÓXIMO da cadeia sem ele — a pessoa entra mesmo assim.
      let ready = [...CLIENT_READY_PROVIDERS];
      for (let attempt = 0; attempt < 4 && ready.length; attempt += 1) {
        const last = attempt === 3 || ready.length === 1;
        const raw = await getVoiceJoin(channelId, ready).catch((err) => {
          console.error('[voz] Falha ao consultar o provedor de voz:', err);
          return null;
        });
        if (joiningChannelIdRef.current !== channelId) return;
        const creds = raw ? readJoinResponse(raw) : null;
        if (!creds) {
          useStore.getState().pushNotice('Não foi possível conectar à chamada de voz agora. Tente de novo em instantes.');
          return;
        }

        // ---- Provedores com engine próprio (servidor próprio, LiveKit, Jitsi...) ----
        if (creds.provider !== 'agora') {
          const ok = await connectEngine({ serverId, channelId, channelName, channelType, provider: creds.provider, creds: creds[creds.provider], isSwitch: false, quiet: !last, startMuted: !!opts.startMuted });
          if (ok) applyJoinOptions(channelId, opts);
          if (ok || joiningChannelIdRef.current !== channelId) return;
          ready = ready.filter((p) => p !== creds.provider);
          continue;
        }

        // ---- Agora ----
        const { token, appId } = creds.agora || {};
        if (!token || !appId) { ready = ready.filter((p) => p !== 'agora'); continue; }
        setProvider('agora');
        const client = await setupAgoraClient();
        if (joiningChannelIdRef.current !== channelId) { client.removeAllListeners?.(); if (agoraClientRef.current === client) agoraClientRef.current = null; return; }

        // Entrar no canal (rede) e pedir o microfone rodam juntos.
        let gotMic = false;
        try {
          [, gotMic] = await Promise.all([
            client.join(appId, channelId, token, user.id),
            connectMicrophone(),
          ]);
        } catch (err) {
          // Se o join falhar, fecha o mic aberto e tenta o próximo provedor.
          console.error('[voz] Falha ao entrar no canal de mídia (Agora):', err);
          localAudioTrackRef.current?.close();
          localAudioTrackRef.current = null;
          client.removeAllListeners?.();
          client.leave().catch(() => {});
          if (agoraClientRef.current === client) agoraClientRef.current = null;
          const msg = reportVoiceFailure('agora', err);
          if (last) { useStore.getState().pushNotice(msg); return; }
          ready = ready.filter((p) => p !== 'agora');
          continue;
        }
        if (joiningChannelIdRef.current !== channelId) {
          // Desistiu no meio (clicou em outro canal): fecha o mic aberto.
          localAudioTrackRef.current?.close();
          localAudioTrackRef.current = null;
          client.removeAllListeners?.();
          await client.leave().catch(() => {});
          return;
        }

        // Avisa o servidor e mostra a chamada assim que a mídia conectou.
        const next = { serverId, channelId, channelName, channelType };
        setCall(next);
        callRef.current = next;
        setCallStartedAt(Date.now());
        setMyRole('speaker');
        socket?.emit('voice:join', { channelId });
        playSound('callJoin');
        startCallForegroundService(channelName);
        setIncomingCall((c) => (c && c.channelId === channelId ? null : c));

        if (!gotMic) {
          useStore.getState().pushNotice('Microfone não encontrado. Você entrou no canal mudo — conecte um microfone e toque no botão de mudo para ativá-lo.');
          setMicMissing(true);
          setMuted(true);
          socket?.emit('voice:state', { channelId, muted: true });
        } else {
          try {
            await client.publish([localAudioTrackRef.current]);
          } catch (err) {
            console.error('[voz] Falha ao publicar o microfone:', err);
            useStore.getState().pushNotice('Não foi possível enviar seu microfone. Tente silenciar e ativar de novo.');
          }
        }
        applyJoinOptions(channelId, opts);
        return;
      }
      useStore.getState().pushNotice('Não foi possível conectar à chamada de voz agora. Tente de novo em instantes.');
    } finally {
      if (joiningChannelIdRef.current === channelId) joiningChannelIdRef.current = null;
      setJoiningChannelId((c) => (c === channelId ? null : c));
    }
  }, [socket, connectMicrophone, setupAgoraClient, user?.id, connectEngine, teardownEngine, applyJoinOptions]);

  // Porta de entrada usada pela UI: se "Testar antes de entrar" estiver
  // ligado (padrão), abre o painel de pré-entrada em vez de conectar na
  // hora. Atender chamada e ser movido de sala (AFK) passam direto.
  const joinChannel = useCallback((serverId, channelId, channelName, channelType, opts = {}) => {
    if (callRef.current?.channelId === channelId) return undefined;
    if (!opts.skipPreJoin && getExtra().preJoinCheck === true) {
      setPreJoin({ serverId, channelId, channelName, channelType });
      return undefined;
    }
    return joinChannelNow(serverId, channelId, channelName, channelType, opts);
  }, [joinChannelNow]);
  const confirmPreJoin = useCallback(({ startMuted = false, startCamera = false } = {}) => {
    const pj = preJoin;
    setPreJoin(null);
    if (!pj) return;
    joinChannelNow(pj.serverId, pj.channelId, pj.channelName, pj.channelType, { startMuted, startCamera });
  }, [preJoin, joinChannelNow]);
  const cancelPreJoin = useCallback(() => setPreJoin(null), []);

  const answerIncomingCall = useCallback(() => {
    if (!incomingCall) return;
    const { conversationId, channelId } = incomingCall;
    const convo = useStore.getState().conversations.find((c) => c.id === conversationId);
    const name = convo ? (convo.isGroup ? convo.name : (convo.members.find((m) => m.id !== user?.id)?.displayName || 'Chamada')) : 'Chamada';
    joinChannelNow(null, channelId, name, 'DM');
  }, [incomingCall, joinChannelNow, user?.id]);

  const declineIncomingCall = useCallback(() => {
    if (!incomingCall) return;
    socket?.emit('dm-call:reject', { conversationId: incomingCall.conversationId });
    setIncomingCall(null);
  }, [incomingCall, socket]);

  const leaveChannel = useCallback(async () => {
    const current = callRef.current;
    if (!current) return;
    socket?.emit('voice:leave', { channelId: current.channelId });
    playSound('callLeave');
    stopCallForegroundService();
    Object.values(soundboardAudiosRef.current).forEach((el) => { el.pause(); el.src = ''; });
    soundboardAudiosRef.current = {};
    if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null; }
    setNetQuality({});
    setMyRtt(null);
    setReconnecting(null);
    setCallStartedAt(null);
    setScreenQuality(null);
    pingHistoryRef.current = [];
    pendingCameraRef.current = null;
    // Modo reserva: encerra a conferência do Jitsi (se era esse o provedor)
    // e volta o provedor pro padrão pra próxima chamada.
    teardownEngine();
    setProvider('agora');
    setReconnectingProvider(false);

    // BUG CORRIGIDO ("demora pra sair" / "tela travada ao sair e entrar
    // de novo"): a tela só limpava DEPOIS do Agora terminar de sair
    // (pode levar 1–2s) e os listeners do cliente antigo continuavam
    // vivos, podendo jogar vídeo/áudio velho na chamada nova. Agora
    // limpa a tela na hora, desliga os listeners e encerra a mídia logo
    // em seguida.
    const client = agoraClientRef.current;
    const tracks = [localAudioTrackRef.current, cameraTrackRef.current, screenTrackRef.current, screenAudioTrackRef.current];
    const hadAndroidScreen = !!androidScreenTrackRef.current;
    localAudioTrackRef.current = null;
    cameraTrackRef.current = null;
    screenTrackRef.current = null;
    screenAudioTrackRef.current = null;
    androidScreenTrackRef.current = null;
    agoraClientRef.current = null;

    setCall(null);
    callRef.current = null;
    setParticipants({});
    setHandsRaised({});
    setMuted(false);
    setDeafened(false);
    setCameraOn(false);
    setScreenOn(false);
    setMyRole('speaker');
    setMicMissing(false);
    setRemoteAudioStreams({});
    setRemoteVideoStreams({});
    setMediaUids({});
    localSpeakingRef.current = false;
    setLocalSpeaking(false);
    setReactions([]);
    setRecording(null);
    setRecordingPrompt(null);
    setRecordingConsents({});
    pttTalkingRef.current = false;
    setPttTalking(false);
    forceLocalVideoTick((n) => n + 1);

    client?.removeAllListeners?.();
    tracks.forEach((t) => { try { t?.close(); } catch { /* já fechada */ } });
    if (hadAndroidScreen) stopAndroidScreenShare();
    try {
      if (client) await client.leave();
    } catch { /* já desconectado — ok */ }
  }, [socket, teardownEngine]);
  useEffect(() => { leaveChannelRef.current = leaveChannel; }, [leaveChannel]);

  const toggleMute = useCallback(async () => {
    if (toggleMuteBusyRef.current) return;
    toggleMuteBusyRef.current = true;
    try {
    if (callRef.current?.channelType === 'STAGE' && myRole === 'audience') return;
    // Modo reserva (Jitsi): o microfone vive dentro do iframe; só mandamos
    // o comando e o estado real volta pelo evento audioMuteStatusChanged
    // (que atualiza `muted` + avisa os outros via socket).
    // Provedor com engine próprio (Jitsi/LiveKit): o microfone é controlado
    // pelo engine; o estado real volta pelo callback onSelfMute (que atualiza
    // `muted` + avisa os outros via socket).
    if (activeProviderRef.current !== 'agora') {
      mediaEngineRef.current?.setMicEnabled(mutedRef.current); // mutado agora => quero desmutar
      return;
    }
    if (muted && !localAudioTrackRef.current) {
      const gotMic = await connectMicrophone();
      if (!gotMic) {
        useStore.getState().pushNotice('Ainda não encontrei um microfone. Conecte um e tente novamente.');
        return;
      }
      await agoraClientRef.current?.publish([localAudioTrackRef.current]);
      setMuted(false);
      broadcastState({ muted: false });
      return;
    }
    setMuted((prev) => {
      const next = !prev;
      localAudioTrackRef.current?.setEnabled(!next);
      broadcastState({ muted: next });
      return next;
    });
    } finally {
      toggleMuteBusyRef.current = false;
    }
  }, [broadcastState, myRole, muted, connectMicrophone]);

  const toggleDeafen = useCallback(() => {
    setDeafened((prev) => {
      const next = !prev;
      // Modo reserva (Jitsi): não dá pra silenciar o áudio que CHEGA pela
      // External API (ele é tocado dentro do iframe) — degrada
      // graciosamente para "mutar o próprio microfone", mantendo o estado
      // coerente. Ver docs/voice-fallback.md.
      // Engine próprio (Jitsi/LiveKit): não dá pra silenciar o áudio que
      // CHEGA (ele é tocado pelo iframe no Jitsi; e no LiveKit o AudioSink já
      // zera pelo estado `deafened`) — degrada graciosamente pra "mutar o
      // próprio microfone", mantendo o estado coerente. Ver docs/voice-fallback.md.
      if (activeProviderRef.current !== 'agora') {
        if (next) { mediaEngineRef.current?.setMicEnabled(false); setMuted(true); }
        broadcastState({ deafened: next, muted: next ? true : muted });
        return next;
      }
      if (next && localAudioTrackRef.current) {
        localAudioTrackRef.current.setEnabled(false);
        setMuted(true);
      }
      // BUG CORRIGIDO: aqui também tentava mexer na reprodução própria
      // do Agora (.stop()/.play()), que não é mais usada — o AudioSink
      // (CallBar.jsx) já silencia sozinho quando ensurdecido, através da
      // prop volume={deafened ? 0 : ...}, lendo o mesmo estado
      // `deafened` direto do contexto. Chamar .stop() aqui também podia
      // interferir na MESMA faixa de mídia que o AudioSink depende (os
      // dois vêm do mesmo getMediaStreamTrack()), então foi removido.
      broadcastState({ deafened: next, muted: next ? true : muted });
      return next;
    });
  }, [broadcastState, muted]);

  const toggleCamera = useCallback(async () => {
    if (toggleCameraBusyRef.current) return;
    toggleCameraBusyRef.current = true;
    try {
    // Modo reserva (Jitsi): câmera é comando do iframe; o estado volta pelo
    // evento videoMuteStatusChanged.
    // Engine próprio (Jitsi/LiveKit): a câmera é comando do engine. O Jitsi
    // não devolve faixa pra nossa grade (null); o LiveKit devolve o
    // MediaStream local, que guardamos pro auto-retrato. O estado `cameraOn`
    // volta pelo callback onSelfCamera.
    if (activeProviderRef.current !== 'agora') {
      const stream = await mediaEngineRef.current?.setCamera(!cameraOn, { deviceId: getPreferredCameraId() || undefined });
      setEngineLocalCameraStream(stream || null);
      return;
    }
    const client = agoraClientRef.current;
    if (!client) return;
    if (cameraOn) {
      await client.unpublish([cameraTrackRef.current]).catch(() => {});
      cameraTrackRef.current?.close();
      cameraTrackRef.current = null;
      setCameraOn(false);
      broadcastState({ video: false });
      forceLocalVideoTick((n) => n + 1);
      return;
    }
    const AgoraRTC = await loadAgoraRTC();
    // Câmera escolhida (painel de pré-entrada); se sumiu, usa a padrão.
    const cameraId = getPreferredCameraId();
    const track = await AgoraRTC.createCameraVideoTrack({ encoderConfig: '360p', cameraId: cameraId || undefined })
      .catch((err) => (cameraId ? AgoraRTC.createCameraVideoTrack({ encoderConfig: '360p' }) : Promise.reject(err)));
    cameraTrackRef.current = track;
    await client.publish([track]);
    setCameraOn(true);
    broadcastState({ video: true });
    forceLocalVideoTick((n) => n + 1);
    } catch (err) {
      useStore.getState().pushNotice('Não foi possível acessar a câmera.');
    } finally {
      toggleCameraBusyRef.current = false;
    }
  }, [cameraOn, broadcastState]);

  const toggleScreenShare = useCallback(async (options = {}) => {
    if (toggleScreenShareBusyRef.current) return;
    toggleScreenShareBusyRef.current = true;
    try {
      // Modo reserva (Jitsi): o próprio iframe faz a captura e mostra pros
      // outros; só alternamos. O estado volta por screenSharingStatusChanged.
      // Engine próprio (Jitsi/LiveKit): a captura é do engine. O Jitsi mostra
      // pros outros pelo iframe (sem faixa local pra nós); o LiveKit devolve o
      // MediaStream local, guardado pro auto-retrato. O estado volta por
      // onSelfScreen.
      if (activeProviderRef.current !== 'agora') {
        const stream = await mediaEngineRef.current?.setScreen(!screenOn, options);
        setEngineLocalScreenStream(stream || null);
        return;
      }
      const client = agoraClientRef.current;
      if (!client) return;
      if (screenOn) {
        const tracks = [screenTrackRef.current, screenAudioTrackRef.current].filter(Boolean);
        await client.unpublish(tracks).catch(() => {});
        screenTrackRef.current?.close();
        screenAudioTrackRef.current?.close();
        screenTrackRef.current = null;
        screenAudioTrackRef.current = null;
        // Item pedido: compartilhamento de tela no Android — se a
        // faixa que estava no ar era a capturada pelo plugin nativo
        // (não a padrão do navegador), também precisa avisar o lado
        // Android pra parar a captura de verdade (serviço em primeiro
        // plano, MediaProjection) — só despublicar do Agora não seria
        // suficiente, a captura continuaria rodando escondida.
        if (androidScreenTrackRef.current) {
          stopAndroidScreenShare();
          androidScreenTrackRef.current = null;
        }
        setScreenOn(false);
        setScreenQuality(null);
        broadcastState({ screenSharing: false });
        forceLocalVideoTick((n) => n + 1);
        return;
      }
      const isNativeApp = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
      if (isNativeApp) {
        // Item pedido: "jeito mais fácil de fazer o celular
        // compartilhar a tela" — plugin nativo (ScreenSharePlugin.java)
        // entrega os pixels da tela como imagens; esse caminho as
        // transforma numa faixa de vídeo de verdade via <canvas> (ver
        // native/androidScreenShare.js) e publica ela como uma faixa
        // CUSTOMIZADA do Agora — o mesmo mecanismo documentado
        // oficialmente pelo Agora pra qualquer fonte de vídeo que não
        // seja câmera/tela padrão do navegador.
        try {
          // Item pedido: "faça se possível como o Stoat ou o Discord"
          // — 12fps/qualidade 65, pesquisado a partir de como esses
          // apps configuram compartilhamento de tela mobile, e agora
          // possível sem pesar mais que antes graças à resolução de
          // captura reduzida (ver ScreenCaptureService.java, que
          // manda os frames já em ~720p em vez da resolução nativa da
          // tela — bem mais leve de comprimir, sobra margem pra mais
          // fps sem sobrecarregar).
          const mediaStreamTrack = await startAndroidScreenShare({ fps: 12, quality: 65 });
          if (!mediaStreamTrack) return; // pessoa negou a permissão do sistema
          const AgoraRTC = await loadAgoraRTC();
          const customTrack = await AgoraRTC.createCustomVideoTrack({ mediaStreamTrack, frameRate: 6 });
          screenTrackRef.current = customTrack;
          androidScreenTrackRef.current = mediaStreamTrack;
          await client.publish([customTrack]);
          setScreenOn(true);
          broadcastState({ screenSharing: true });
          forceLocalVideoTick((n) => n + 1);
        } catch (err) {
          useStore.getState().pushNotice('Não foi possível compartilhar a tela.');
          stopAndroidScreenShare();
        }
        return;
      }
      // Item pedido C ("o compartilhamento NÃO pode levar a voz do mic"):
      // o que entra na transmissão de tela é decidido por buildScreenShareConfig
      // (ver utils/screenShareTracks.js) — a captura de tela (getDisplayMedia
      // por baixo do createScreenVideoTrack) só pega vídeo da tela + ÁUDIO
      // DO SISTEMA/ABA, nunca o microfone. A voz continua indo por uma
      // faixa SEPARADA (localAudioTrackRef), publicada à parte.
      const cfg = buildScreenShareConfig(options);
      try {
        const AgoraRTC = await loadAgoraRTC();
        const result = await AgoraRTC.createScreenVideoTrack({
          encoderConfig: cfg.encoderConfig,
          // 'motion' prioriza fluidez (jogos/vídeo) sobre nitidez.
          optimizationMode: cfg.optimizationMode,
        }, cfg.audioParam);
        const [screenTrack, screenAudioTrack] = Array.isArray(result) ? result : [result, null];
        screenTrackRef.current = screenTrack;
        screenAudioTrackRef.current = screenAudioTrack || null;
        // collectScreenPublishTracks garante, por construção, que a faixa
        // do microfone JAMAIS entra no conjunto compartilhado.
        const toPublish = collectScreenPublishTracks(screenTrack, screenAudioTrack, localAudioTrackRef.current);
        await client.publish(toPublish);
        // BUG CORRIGIDO ("tela congelada pra quem assiste"): ao clicar em
        // "Parar de compartilhar" na barra do navegador, isto chamava a
        // versão ANTIGA da função (de quando screenOn ainda era false) —
        // que tentava COMEÇAR outra transmissão em vez de parar, deixando
        // a faixa encerrada publicada (último quadro congelado pros outros).
        screenTrack.on('track-ended', () => { if (screenTrackRef.current === screenTrack) toggleScreenShareRef.current?.(); });
        setScreenQuality({ quality: cfg.quality, frameRate: cfg.frameRate });
        setScreenOn(true);
        broadcastState({ screenSharing: true });
        forceLocalVideoTick((n) => n + 1);
      } catch (err) {
        if (!(err?.message?.toLowerCase().includes('permission') || err?.code === 'PERMISSION_DENIED')) {
          useStore.getState().pushNotice('Não foi possível compartilhar a tela.');
        }
      }
    } finally {
      toggleScreenShareBusyRef.current = false;
    }
  }, [screenOn, broadcastState]);
  // Trocar a qualidade da tela SEM parar a transmissão (setEncoderConfiguration
  // do Agora na faixa que já está no ar). Também lembra a escolha pra próxima vez.
  const setScreenShareQuality = useCallback(async ({ quality, frameRate }) => {
    const dims = QUALITY_PRESETS[quality];
    if (!dims || ![15, 30, 60].includes(frameRate)) return false;
    try {
      const saved = JSON.parse(localStorage.getItem('screenShareOptions') || 'null') || {};
      localStorage.setItem('screenShareOptions', JSON.stringify({ audio: true, ...saved, quality, frameRate }));
    } catch { /* sem storage */ }
    const track = screenTrackRef.current;
    if (!track || androidScreenTrackRef.current || typeof track.setEncoderConfiguration !== 'function') return false;
    try {
      await track.setEncoderConfiguration({ width: dims.width, height: dims.height, frameRate });
      setScreenQuality({ quality, frameRate });
      return true;
    } catch (err) {
      console.error('[voz] não foi possível trocar a qualidade da tela:', err);
      useStore.getState().pushNotice('Não foi possível trocar a qualidade da transmissão agora.');
      return false;
    }
  }, []);
  const toggleScreenShareRef = useRef(toggleScreenShare);
  useEffect(() => { toggleScreenShareRef.current = toggleScreenShare; }, [toggleScreenShare]);

  // Volume individual (0–2 = 0%–200%). Quem toca o áudio é o AudioSink
  // (CallBar.jsx), via GainNode — por isso passa de 100% sem distorcer
  // o elemento <audio>. Salvo na conta (com cache local por aparelho).
  const meIdRef = useRef(user?.id);
  useEffect(() => { meIdRef.current = user?.id; }, [user?.id]);
  const volumesRef = useRef(volumes);
  useEffect(() => { volumesRef.current = volumes; saveVolumes(meIdRef.current, volumes); }, [volumes]);

  // Envia pra conta só o que mudou ({ userId: 0..200 | null }); o servidor
  // mescla com o que já está salvo (dois aparelhos não se apagam).
  const flushVolumeSavesRef = useRef(null);
  const flushVolumeSaves = useCallback(() => {
    clearTimeout(volumeSaveTimerRef.current);
    volumeSaveTimerRef.current = null;
    const pending = pendingVolumesRef.current;
    pendingVolumesRef.current = {};
    const patch = toServerPatch(pending);
    if (!Object.keys(patch).length) return;
    updateUserSettings({ voiceVolumesPatch: patch }).then((res) => {
      const vv = res?.settings?.voiceVolumes;
      if (vv) useStore.setState((st) => (st.userSettings ? { userSettings: { ...st.userSettings, voiceVolumes: vv } } : {}));
    }).catch((err) => {
      // Sem rede/servidor fora: volta pra fila (sem passar por cima de
      // mudanças mais novas) e tenta de novo. Recusa (4xx) não adianta repetir.
      const status = err?.response?.status;
      if (status && status < 500) return;
      pendingVolumesRef.current = { ...pending, ...pendingVolumesRef.current };
      if (!volumeSaveTimerRef.current) volumeSaveTimerRef.current = setTimeout(() => flushVolumeSavesRef.current?.(), 15000);
    });
  }, []);
  useEffect(() => { flushVolumeSavesRef.current = flushVolumeSaves; }, [flushVolumeSaves]);
  const scheduleVolumeSave = useCallback(() => {
    clearTimeout(volumeSaveTimerRef.current);
    volumeSaveTimerRef.current = setTimeout(() => flushVolumeSavesRef.current?.(), VOLUME_SAVE_DEBOUNCE_MS);
  }, []);
  // Saindo da aba/fechando o app: manda o que ainda estava esperando.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden' && Object.keys(pendingVolumesRef.current).length) flushVolumeSavesRef.current?.(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); clearTimeout(volumeSaveTimerRef.current); };
  }, []);

  // Trocou de conta neste aparelho: carrega o cache local dessa conta.
  const volumesUserRef = useRef(user?.id);
  useEffect(() => {
    if (volumesUserRef.current === user?.id) return;
    volumesUserRef.current = user?.id;
    volumesMergedForRef.current = null;
    pendingVolumesRef.current = {};
    setVolumes(loadSavedVolumes(user?.id));
  }, [user?.id]);

  // Configurações da conta chegaram: mescla uma vez por conta (a conta
  // vence; o que só existia neste aparelho sobe pra conta).
  const serverVolumes = useStore((st) => st.userSettings?.voiceVolumes);
  useEffect(() => {
    if (!user?.id || !serverVolumes || typeof serverVolumes !== 'object') return;
    if (volumesMergedForRef.current === user.id) return;
    volumesMergedForRef.current = user.id;
    const { merged, patch } = mergeVolumesOnLogin(volumesRef.current, serverVolumes);
    setVolumes(merged);
    const keys = Object.keys(patch);
    if (keys.length) {
      keys.forEach((k) => { pendingVolumesRef.current[k] = merged[k]; });
      scheduleVolumeSave();
    }
  }, [user?.id, serverVolumes, scheduleVolumeSave]);

  const setParticipantVolume = useCallback((userId, volume) => {
    const id = String(userId);
    const v = Math.min(2, Math.max(0, Number(volume) || 0));
    // Quem mudou vai pro fim (mais recente) — o limite tira os mais antigos.
    setVolumes((st) => capLocal({ ...dropKey(st, id), [id]: v }));
    pendingVolumesRef.current[id] = v;
    scheduleVolumeSave();
  }, [scheduleVolumeSave]);

  // Entrou com "câmera ligada" no painel de pré-entrada: liga assim que a
  // chamada estiver de pé (provedor/cliente já no estado).
  useEffect(() => {
    if (!call?.channelId || pendingCameraRef.current !== call.channelId) return;
    pendingCameraRef.current = null;
    if (!cameraOn) toggleCamera();
  }, [call?.channelId, cameraOn, toggleCamera]);

  // Painel "Qualidade da conexão": leitura detalhada sob demanda, no mesmo
  // formato pra qualquer provedor (ver voice/connectionStats.js). Provedor
  // sem estatísticas devolve supported: false — a UI mostra o que tiver.
  const getConnectionStats = useCallback(async () => {
    const prov = activeProviderRef.current;
    let snap = null;
    try {
      if (prov === 'agora') {
        const c = agoraClientRef.current;
        if (c) {
          snap = summarizeAgoraStats({
            rtc: c.getRTCStats?.(), localAudio: c.getLocalAudioStats?.(), remoteAudio: c.getRemoteAudioStats?.(),
            localVideo: c.getLocalVideoStats?.(),
            screenOn: localStateRef.current.screenSharing, cameraOn: localStateRef.current.video,
          });
        }
      } else if (typeof mediaEngineRef.current?.getConnectionStats === 'function') {
        snap = await mediaEngineRef.current.getConnectionStats();
      }
    } catch { snap = null; }
    return { provider: prov, providerLabel: providerLabel(prov), supported: !!snap, server: null, ...(snap || {}) };
  }, []);

  const raiseHand = useCallback((raised = true) => {
    if (!socket || !callRef.current) return;
    socket.emit('voice:raise-hand', { channelId: callRef.current.channelId, raised });
    setHandsRaised((s) => ({ ...s, [user.id]: raised }));
  }, [socket, user?.id]);

  // ---------- Reações rápidas (I) ----------
  const sendReaction = useCallback((emoji) => {
    if (!socket || !callRef.current || !isValidReaction(emoji)) return;
    if (!reactionLimiterRef.current()) return; // limite anti-spam local
    socket.emit('voice:reaction', { channelId: callRef.current.channelId, emoji });
  }, [socket]);

  // ---------- Redutor de ruído (B) ----------
  // Troca a preferência e aplica na hora: recria a faixa do microfone com
  // (ou sem) o processamento de áudio. Fora de uma chamada só guarda a
  // escolha pra valer na próxima vez.
  const setNoiseReduction = useCallback(async (on) => {
    setVoicePref('noiseReduction', !!on);
    // Engine próprio (mediasoup): liga/desliga o RNNoise na hora.
    const engine = mediaEngineRef.current;
    if (engine && typeof engine.setNoiseSuppression === 'function') {
      try { await engine.setNoiseSuppression(!!on); } catch (err) { console.error('[voz] redutor de ruído:', err); }
      return;
    }
    const client = agoraClientRef.current;
    const old = localAudioTrackRef.current;
    if (!client || !old) return;
    const wasEnabled = old.enabled !== false;
    try {
      await client.unpublish([old]).catch(() => {});
      old.close();
      localAudioTrackRef.current = null;
      const ok = await connectMicrophone();
      if (!ok) { setMicMissing(true); return; }
      localAudioTrackRef.current.setEnabled(wasEnabled && !mutedRef.current);
      await client.publish([localAudioTrackRef.current]);
    } catch (err) {
      console.error('[voz] não foi possível aplicar o redutor de ruído agora:', err);
    }
  }, [connectMicrophone]);

  // ---------- Gravação com consentimento (N) ----------
  const requestRecording = useCallback(() => {
    if (!socket || !callRef.current) return;
    setRecordingConsents({});
    socket.emit('voice:recording-request', { channelId: callRef.current.channelId });
  }, [socket]);
  const respondRecording = useCallback((accepted) => {
    if (!socket || !callRef.current) return;
    socket.emit('voice:recording-consent', { channelId: callRef.current.channelId, accepted: !!accepted });
    setRecordingPrompt(null);
  }, [socket]);
  const stopRecording = useCallback(() => {
    if (!socket || !callRef.current) return;
    socket.emit('voice:recording-stop', { channelId: callRef.current.channelId });
  }, [socket]);

  const setParticipantRole = useCallback((targetUserId, role) => {
    if (!socket || !callRef.current) return;
    socket.emit('voice:set-role', { channelId: callRef.current.channelId, userId: targetUserId, role });
  }, [socket]);

  const stepDownFromStage = useCallback(() => setParticipantRole(user?.id, 'audience'), [setParticipantRole, user?.id]);

  // Refs pros listeners abaixo: antes o efeito dependia de `deafened` e
  // `joinChannel`, então TODOS os listeners eram removidos e recolocados a
  // cada ensurdecer/desensurdecer — e a marca "caiu a conexão" (usada pra
  // reentrar sozinho na chamada ao reconectar) era zerada junto, fazendo
  // a reentrada automática se perder.
  const deafenedRef = useRef(deafened);
  useEffect(() => { deafenedRef.current = deafened; }, [deafened]);
  // Movido de sala pelo servidor (AFK): entra direto, sem o painel.
  const joinChannelRef = useRef(joinChannelNow);
  useEffect(() => { joinChannelRef.current = joinChannelNow; }, [joinChannelNow]);
  const sawDisconnectRef = useRef(false);

  useEffect(() => {
    if (!socket) return;

    const onJoined = ({ channelId, participants: existing, myRole: role, sync }) => {
      if (callRef.current?.channelId !== channelId) return;
      // Som de entrada escolhido em Configurações → Voz e vídeo (toca pra todos).
      if (!sync && entrySoundSentRef.current !== channelId) {
        entrySoundSentRef.current = channelId;
        const entry = getExtra().joinSoundId;
        if (entry) { socket.emit('voice:entry-sound', { channelId, sound: entry }); playEntrySound(entry); }
      }
      const map = {};
      existing.forEach((p) => { map[p.userId] = p; });
      // Mantém o "falando" de quem já estava (o retrato do servidor não tem isso).
      setParticipants((prev) => {
        Object.keys(map).forEach((uid) => { if (prev[uid]?.speaking) map[uid] = { ...map[uid], speaking: true }; });
        return map;
      });
      // Entrada nova/reentrada depois de queda: o servidor começa com tudo
      // desligado — reenvia o estado real (mudo, câmera, tela) pra todos
      // verem certo. No retrato periódico (sync) não precisa.
      if (!sync) {
        const st = localStateRef.current;
        if (st.muted || st.deafened || st.video || st.screenSharing) socket.emit('voice:state', { channelId, ...st });
      }
      if (role) {
        setMyRole(role);
        if (role === 'audience' && localAudioTrackRef.current) {
          localAudioTrackRef.current.setEnabled(false);
          setMuted(true);
        }
      }
    };
    const onUserJoined = ({ channelId, userId, role }) => {
      if (callRef.current?.channelId !== channelId) return;
      if (userId !== user?.id) playSound('userJoin', 0.4);
      setParticipants((s) => ({ ...s, [userId]: { muted: role === 'audience', deafened: false, video: false, screenSharing: false, role } }));
    };
    const onUserLeft = ({ channelId, userId }) => {
      if (callRef.current?.channelId !== channelId) return;
      if (userId !== user?.id) playSound('userLeave', 0.4);
      setParticipants((s) => { const n = { ...s }; delete n[userId]; return n; });
    };
    const onState = ({ channelId, userId, ...state }) => {
      if (callRef.current?.channelId !== channelId) return;
      setParticipants((s) => ({ ...s, [userId]: { ...s[userId], ...state } }));
    };
    const onSpeaking = ({ channelId, userId, speaking }) => {
      if (callRef.current?.channelId === channelId) {
        setParticipants((s) => (s[userId] ? { ...s, [userId]: { ...s[userId], speaking } } : s));
      }
      setRosterSpeaking((s) => ({ ...s, [channelId]: { ...(s[channelId] || {}), [userId]: speaking } }));
    };
    const onRoster = ({ channelId, participants: list, startedAt }) => {
      setRoster((s) => ({ ...s, [channelId]: list }));
      // Lista pública da minha sala diferente do que eu vejo dentro dela?
      // Algum evento se perdeu — pede o retrato completo ao servidor.
      if (callRef.current?.channelId === channelId) {
        const mine = useStore.getState().voiceParticipantsSnapshot || {};
        const others = list.filter((p) => p.userId !== user?.id);
        if (others.length !== Object.keys(mine).length || others.some((p) => !mine[p.userId])) requestSyncRef.current?.(800);
      }
      setRosterStartedAt((s) => (startedAt ? { ...s, [channelId]: startedAt } : (() => {
        const next = { ...s }; delete next[channelId]; return next;
      })()));
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
          localAudioTrackRef.current?.setEnabled(false);
          setMuted(true);
        } else if (role === 'speaker' && !deafenedRef.current) {
          localAudioTrackRef.current?.setEnabled(true);
          setMuted(false);
        }
      }
    };
    const onJoinDenied = ({ channelId, reason }) => {
      if (callRef.current?.channelId !== channelId) return;
      useStore.getState().pushNotice(reason || 'Não foi possível entrar no canal de voz.');
      leaveChannelRef.current?.();
    };
    // BUG CORRIGIDO ("entro na call de outro dispositivo e o primeiro
    // fica travado"): quando a MESMA conta entra nessa call de um
    // dispositivo diferente, o servidor avisa esse dispositivo aqui
    // (o mais antigo) explicitamente — sem isso, a mídia já teria sido
    // derrubada por dentro pelo Agora (dois clientes com o mesmo
    // usuário não são permitidos no mesmo canal), mas a TELA continuaria
    // mostrando "você está na call" mesmo já sem áudio de verdade indo
    // ou vindo. Sai de forma limpa e avisa com clareza o motivo, em vez
    // de deixar a pessoa presa numa call morta sem saber por quê.
    const onKickedByOtherDevice = ({ channelId }) => {
      if (callRef.current?.channelId !== channelId) return;
      useStore.getState().pushNotice('Você entrou nesta chamada em outro dispositivo — saindo daqui.');
      leaveChannelRef.current?.();
    };
    const onEntrySound = ({ channelId, sound }) => {
      if (callRef.current?.channelId !== channelId || deafenedRef.current) return;
      playEntrySound(sound);
    };
    const onSoundboardPlay = ({ channelId, sound }) => {
      if (callRef.current?.channelId !== channelId || deafenedRef.current) return;
      try {
        const previous = soundboardAudiosRef.current[sound.id];
        if (previous) { previous.pause(); previous.src = ''; }
        const el = new Audio();
        el.volume = 0.7 * ((getExtra().sfxVolume ?? 100) / 100);
        el.preload = 'auto';
        const startFromZero = () => {
          try { el.currentTime = 0; } catch { /* not seekable yet, fine */ }
          el.play().catch(() => {});
        };
        if (el.readyState >= 1) startFromZero();
        else el.addEventListener('loadedmetadata', startFromZero, { once: true });
        el.addEventListener('error', () => { if (soundboardAudiosRef.current[sound.id] === el) delete soundboardAudiosRef.current[sound.id]; });
        el.addEventListener('ended', () => { if (soundboardAudiosRef.current[sound.id] === el) delete soundboardAudiosRef.current[sound.id]; });
        soundboardAudiosRef.current[sound.id] = el;
        el.src = sound.url;
        el.load();
      } catch { /* not fatal */ }
    };
    // Reações rápidas (I): emoji flutuante efêmero. Some sozinho após ~2,6s.
    const onReaction = ({ channelId, userId: fromId, emoji }) => {
      if (callRef.current?.channelId !== channelId) return;
      reactionSeqRef.current += 1;
      const id = `${Date.now()}-${reactionSeqRef.current}`;
      setReactions((list) => [...list.slice(-24), { id, userId: fromId, emoji, at: Date.now() }]);
      setTimeout(() => setReactions((list) => list.filter((r) => r.id !== id)), 2600);
    };
    // Gravação com consentimento (N).
    const onRecordingPrompt = ({ channelId, requesterId, requesterName }) => {
      if (callRef.current?.channelId !== channelId) return;
      // Quem pediu não precisa responder a si mesmo (já aceitou no servidor).
      if (String(requesterId) === String(user?.id)) {
        setRecordingConsents({ [String(user?.id)]: true });
        return;
      }
      // "Permitir que minha voz seja gravada nos clipes" desligado: recusa sozinho.
      if (getExtra().clipVoice === false) {
        socket.emit('voice:recording-consent', { channelId, accepted: false });
        useStore.getState().pushNotice(`${requesterName || 'Alguém'} pediu pra gravar a call — recusado automaticamente (sua voz não pode ser gravada, ver Configurações → Privacidade).`);
        return;
      }
      setRecordingPrompt({ requesterId, requesterName });
    };
    const onRecordingConsentUpdate = ({ channelId, userId: whoId, accepted }) => {
      if (callRef.current?.channelId !== channelId) return;
      setRecordingConsents((s) => ({ ...s, [String(whoId)]: !!accepted }));
    };
    const onRecordingStarted = ({ channelId, byUserId, byName }) => {
      if (callRef.current?.channelId !== channelId) return;
      setRecordingPrompt(null);
      setRecording({ byUserId, byName: byName || 'Alguém' });
      useStore.getState().pushNotice(`A chamada está sendo gravada por ${byName || 'alguém'}.`);
    };
    const onRecordingDenied = ({ channelId, reason }) => {
      if (callRef.current?.channelId !== channelId) return;
      setRecordingPrompt(null);
      setRecording(null);
      setRecordingConsents({});
      useStore.getState().pushNotice(reason || 'A gravação não foi autorizada por todos.');
    };
    const onRecordingStopped = ({ channelId }) => {
      if (callRef.current?.channelId !== channelId) return;
      setRecording(null);
      setRecordingPrompt(null);
      setRecordingConsents({});
    };
    const onDmCallRinging = ({ conversationId, channelId: ringChannelId, fromUserId, callerName }) => {
      const resolvedChannelId = ringChannelId || `dm:${conversationId}`;
      if (callRef.current?.channelId === resolvedChannelId) return;
      setIncomingCall({ conversationId, channelId: resolvedChannelId, fromUserId, callerName });
    };
    const onDmCallDeclined = ({ conversationId }) => {
      setIncomingCall((c) => (c && c.conversationId === conversationId ? null : c));
    };
    const onDmCallEnded = ({ conversationId }) => {
      setIncomingCall((c) => (c && c.conversationId === conversationId ? null : c));
    };
    const onAfkMove = ({ channelId, channelName }) => {
      if (!callRef.current) return;
      joinChannelRef.current?.(callRef.current.serverId, channelId, channelName, 'VOICE');
    };
    // Retrato completo de todas as salas (pedido ao conectar) — substitui
    // o que tinha, então salas que esvaziaram enquanto estava offline somem.
    const onRosters = (map) => {
      const entries = Object.entries(map || {});
      setRoster(Object.fromEntries(entries.map(([cid, r]) => [cid, r.participants || []])));
      setRosterStartedAt(Object.fromEntries(entries.filter(([, r]) => r.startedAt).map(([cid, r]) => [cid, r.startedAt])));
      setRosterSpeaking((s) => Object.fromEntries(Object.entries(s).filter(([cid]) => map?.[cid])));
    };
    // O servidor diz que não estou mais na sala (caí e a tolerância
    // passou, ou o servidor reiniciou) mas a mídia continua: entra de novo.
    const onNotInRoom = ({ channelId }) => {
      if (callRef.current?.channelId !== channelId) return;
      socket.emit('voice:join', { channelId });
    };

    const onSocketDisconnect = () => { sawDisconnectRef.current = true; if (callRef.current) playSound('disconnect', 0.4); };
    const onSocketConnect = () => {
      socket.emit('voice:rosters');
      if (!sawDisconnectRef.current) return;
      sawDisconnectRef.current = false;
      const current = callRef.current;
      if (!current) return;
      playSound('reconnect', 0.4);
      socket.emit('voice:join', { channelId: current.channelId });
    };

    socket.on('voice:joined', onJoined);
    socket.on('voice:join-denied', onJoinDenied);
    socket.on('voice:kicked-by-other-device', onKickedByOtherDevice);
    socket.on('voice:user-joined', onUserJoined);
    socket.on('voice:user-left', onUserLeft);
    socket.on('voice:state', onState);
    socket.on('voice:speaking', onSpeaking);
    socket.on('voice:roster', onRoster);
    socket.on('voice:hand-raised', onHandRaised);
    socket.on('voice:role-update', onRoleUpdate);
    socket.on('soundboard:play', onSoundboardPlay);
    socket.on('voice:entry-sound', onEntrySound);
    socket.on('voice:reaction', onReaction);
    socket.on('voice:recording-prompt', onRecordingPrompt);
    socket.on('voice:recording-consent-update', onRecordingConsentUpdate);
    socket.on('voice:recording-started', onRecordingStarted);
    socket.on('voice:recording-denied', onRecordingDenied);
    socket.on('voice:recording-stopped', onRecordingStopped);
    socket.on('dm-call:ringing', onDmCallRinging);
    socket.on('dm-call:declined', onDmCallDeclined);
    socket.on('dm-call:ended', onDmCallEnded);
    socket.on('voice:afk-move', onAfkMove);
    socket.on('voice:rosters', onRosters);
    socket.on('voice:not-in-room', onNotInRoom);
    socket.on('connect', onSocketConnect);
    // Já conectado quando o efeito montou: pede o retrato inicial agora.
    if (socket.connected) socket.emit('voice:rosters');
    socket.on('disconnect', onSocketDisconnect);

    return () => {
      socket.off('voice:joined', onJoined);
      socket.off('voice:join-denied', onJoinDenied);
      socket.off('voice:kicked-by-other-device', onKickedByOtherDevice);
      socket.off('voice:user-joined', onUserJoined);
      socket.off('voice:user-left', onUserLeft);
      socket.off('voice:state', onState);
      socket.off('voice:speaking', onSpeaking);
      socket.off('voice:roster', onRoster);
      socket.off('voice:hand-raised', onHandRaised);
      socket.off('voice:role-update', onRoleUpdate);
      socket.off('soundboard:play', onSoundboardPlay);
      socket.off('voice:entry-sound', onEntrySound);
      socket.off('voice:reaction', onReaction);
      socket.off('voice:recording-prompt', onRecordingPrompt);
      socket.off('voice:recording-consent-update', onRecordingConsentUpdate);
      socket.off('voice:recording-started', onRecordingStarted);
      socket.off('voice:recording-denied', onRecordingDenied);
      socket.off('voice:recording-stopped', onRecordingStopped);
      socket.off('dm-call:ringing', onDmCallRinging);
      socket.off('dm-call:declined', onDmCallDeclined);
      socket.off('dm-call:ended', onDmCallEnded);
      socket.off('voice:afk-move', onAfkMove);
      socket.off('voice:rosters', onRosters);
      socket.off('voice:not-in-room', onNotInRoom);
      socket.off('connect', onSocketConnect);
      socket.off('disconnect', onSocketDisconnect);
    };
  }, [socket, user?.id]);

  // Reconciliação periódica enquanto está numa chamada (servidor = fonte
  // da verdade) + ao voltar pra aba. Leve: um evento pequeno a cada 20s,
  // só pra quem está em chamada.
  const callChannelId = call?.channelId;
  useEffect(() => {
    if (!socket || !callChannelId) return undefined;
    const tick = () => { if (socket.connected) socket.emit('voice:sync', { channelId: callChannelId }); };
    const iv = setInterval(tick, VOICE_SYNC_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    // Fechou a aba/janela: avisa na hora em vez de esperar a tolerância
    // do servidor (os outros veem a saída imediatamente).
    const onPageHide = (e) => { if (!e.persisted) socket.emit('voice:leave', { channelId: callChannelId }); };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [socket, callChannelId]);

  // ---------- Troca de provedor NO MEIO da chamada (QUALQUER → QUALQUER) ----------
  // Generaliza a antiga troca Agora → Jitsi pra uma troca entre QUAISQUER dois
  // provedores da cadeia, SEM te deslogar e SEM te tirar da sala: derruba só a
  // mídia atual (Agora OU engine) e sobe a do novo provedor no MESMO canal,
  // mantendo sessão, socket, roster, reações e soundboard montados. Um aviso
  // curto "Reconectando…" aparece no meio.
  //
  // Dispara em dois casos:
  //  (a) a equipe mudou a cadeia no painel (evento de socket voice:provider-changed)
  //      — troca IMEDIATA; e
  //  (b) um provedor cruzou o limite mensal no meio da chamada — pego por um
  //      poll leve de /api/voice/join (que já devolve o provedor decidido).
  // Best-effort: se a troca ao vivo falhar, a chamada atual continua no
  // provedor de antes e a próxima já entra no provedor certo.
  const switchingRef = useRef(false);
  const runSwapCheckRef = useRef(null);
  useEffect(() => {
    if (!callChannelId) return undefined;
    let cancelled = false;
    const POLL_MS = 60000;
    const check = async () => {
      if (cancelled || switchingRef.current) return;
      if (joiningChannelIdRef.current) return; // entrando agora: espera
      const current = callRef.current;
      if (!current || current.channelId !== callChannelId) return;
      let raw;
      try { raw = await getVoiceJoin(current.channelId, CLIENT_READY_PROVIDERS); } catch { return; }
      if (cancelled) return;
      const creds = raw ? readJoinResponse(raw) : null;
      if (!creds) return;
      const target = creds.provider;
      // O servidor não deveria mandar um provedor que o cliente não sabe usar
      // (mandamos clientReady), mas por garantia ignoramos se vier.
      if (!isClientReady(target)) return;
      if (target === activeProviderRef.current) return; // nada mudou
      if (callRef.current?.channelId !== current.channelId) return;
      switchingRef.current = true;
      setReconnectingProvider(true);
      const previous = activeProviderRef.current;
      // Sobe a mídia de um provedor no MESMO canal (sem sair da sala).
      const connectTo = async (prov, c) => (prov === 'agora'
        ? connectAgoraMediaRef.current?.({ channelId: current.channelId, agora: c.agora, isSwitch: true })
        : connectEngineRef.current?.({
          serverId: current.serverId, channelId: current.channelId,
          channelName: current.channelName, channelType: current.channelType,
          provider: prov, creds: c[prov], isSwitch: true, quiet: true,
        }));
      try {
        // Derruba a mídia atual (preserva sessão/socket/roster/UI).
        if (previous === 'agora') await teardownAgoraMedia();
        else teardownEngine();
        // Sobe o novo provedor.
        let ok = !!(await connectTo(target, creds));
        // Não conectou: tenta os outros da cadeia (começando pelo de antes),
        // pra chamada nunca ficar muda no meio de uma troca.
        if (!ok) {
          const order = [previous, ...CLIENT_READY_PROVIDERS].filter((p, i, a) => p && p !== target && a.indexOf(p) === i);
          for (const prov of order) {
            if (callRef.current?.channelId !== current.channelId) break;
            const again = await getVoiceJoin(current.channelId, [prov]).then(readJoinResponse).catch(() => null);
            if (!again || again.provider !== prov) continue;
            if (await connectTo(prov, again)) { ok = true; break; }
          }
          if (!ok) useStore.getState().pushNotice('A conexão de voz caiu e não deu pra reconectar. Saia e entre na chamada de novo.');
        } else if (target !== PRIMARY_PROVIDER && target !== 'projectclub') {
          useStore.getState().pushNotice('A chamada trocou de provedor para continuar funcionando (modo reserva).');
        }
      } catch (err) {
        console.error('[voz] Falha ao trocar de provedor no meio da chamada:', err);
      } finally {
        if (!cancelled) setReconnectingProvider(false);
        switchingRef.current = false;
      }
    };
    runSwapCheckRef.current = check;
    const iv = setInterval(check, POLL_MS);
    return () => { cancelled = true; runSwapCheckRef.current = null; clearInterval(iv); };
  }, [callChannelId, teardownAgoraMedia, teardownEngine]);

  // Reação imediata ao aviso do servidor (a equipe mexeu na cadeia): refaz a
  // checagem na hora em vez de esperar o próximo poll.
  useEffect(() => {
    if (!socket) return undefined;
    const onProviderChanged = () => { runSwapCheckRef.current?.(); };
    socket.on('voice:provider-changed', onProviderChanged);
    return () => { socket.off('voice:provider-changed', onProviderChanged); };
  }, [socket]);

  // ---------- Apertar pra falar (F) ----------
  // Mantém pttEnabled em sincronia com a preferência salva (pode mudar
  // nas Configurações enquanto a chamada está aberta).
  useEffect(() => onVoicePrefsChange((p) => setPttEnabled(p.pushToTalkEnabled === true)), []);

  // Enquanto o "apertar pra falar" está ligado e você está numa chamada,
  // o microfone fica mudo por padrão e só vai ao ar enquanto a tecla
  // escolhida está pressionada. Ao desligar o modo, volta pro estado
  // normal (ligado, a não ser que você tenha mutado na mão).
  useEffect(() => {
    if (!callChannelId) return undefined;
    // Apertar-pra-falar depende da faixa local do Agora; em qualquer outro
    // provedor (engine próprio) o microfone é controlado pelo engine e não dá
    // pra gatilhar por tecla com a mesma precisão — degrada graciosamente
    // (fica desligado). Ver docs/voice-fallback.md.
    if (provider !== 'agora') return undefined;
    const track = () => localAudioTrackRef.current;
    const setTalking = (on) => {
      if (pttTalkingRef.current === on) return;
      pttTalkingRef.current = on;
      setPttTalking(on);
      playSound(on ? 'pttActivate' : 'pttDeactivate', 0.3);
      track()?.setEnabled(on);
      // Os outros veem seu mudo refletir a tecla (igual a mutar/desmutar).
      socket?.emit('voice:state', { channelId: callChannelId, muted: !on });
      socket?.emit('voice:speaking', { channelId: callChannelId, speaking: false });
    };
    if (!pttEnabled) {
      // Saiu do modo: destrava o mic conforme o mudo manual atual.
      if (pttTalkingRef.current) { pttTalkingRef.current = false; setPttTalking(false); }
      if (track() && !micMissing) track().setEnabled(!mutedRef.current);
      return undefined;
    }
    // Entrou no modo: fecha o mic até segurar a tecla.
    if (track()) track().setEnabled(false);
    socket?.emit('voice:state', { channelId: callChannelId, muted: true });

    const key = getVoicePref('pushToTalkKey') || 'Space';
    const isTypingTarget = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    const onDown = (e) => {
      if (e.repeat || e.code !== key || isTypingTarget(e.target) || micMissing) return;
      if (key === 'Space') e.preventDefault(); // não rola a página
      setTalking(true);
    };
    const onUp = (e) => { if (e.code === key) setTalking(false); };
    const onBlur = () => setTalking(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [pttEnabled, callChannelId, micMissing, socket, provider]);

  // ---------- Sensibilidade de entrada (Configurações → Voz e vídeo) ----------
  // Com "Determinar automaticamente" desligado, o microfone só vai ao ar
  // quando o volume passa do limite escolhido (em dB); abaixo disso, a
  // faixa fica em volume zero (com 300 ms de folga pra não cortar palavras).
  useEffect(() => {
    if (!callChannelId || provider !== 'agora') return undefined;
    let open = true;
    let quietSince = 0;
    const setOpen = (on) => {
      if (open === on) return;
      open = on;
      try { localAudioTrackRef.current?.setVolume?.(on ? 100 : 0); } catch { /* faixa fechando */ }
    };
    const timer = setInterval(() => {
      const p = getExtra();
      const tr = localAudioTrackRef.current;
      if (!tr || p.sensitivityAuto !== false || pttTalkingRef.current) { setOpen(true); quietSince = 0; return; }
      const level = Number(tr.getVolumeLevel?.() || 0);
      const db = level > 0 ? 20 * Math.log10(level) : -100;
      if (db >= (p.sensitivityDb ?? -60)) { quietSince = 0; setOpen(true); return; }
      if (!quietSince) quietSince = Date.now();
      if (Date.now() - quietSince > 300) setOpen(false);
    }, 60);
    return () => { clearInterval(timer); setOpen(true); };
  }, [callChannelId, provider]);

  // ---------- Aviso "sua conexão está instável" (D) ----------
  // Só pra VOCÊ: quando a sua qualidade de rede (Agora, 0-6) fica ruim
  // (>=4) por alguns segundos seguidos, mostra um aviso — no máximo uma
  // vez a cada 45s, pra não virar spam.
  const myNetQuality = netQuality[String(user?.id)] ?? 0;
  const lastUnstableToastRef = useRef(0);
  const badSinceRef = useRef(0);
  useEffect(() => {
    if (!callChannelId) { badSinceRef.current = 0; return; }
    const bad = myNetQuality >= 4;
    if (!bad) { badSinceRef.current = 0; return; }
    if (!badSinceRef.current) badSinceRef.current = Date.now();
    // Ruim há mais de 4s seguidos e faz mais de 45s do último aviso.
    if (Date.now() - badSinceRef.current >= 4000 && Date.now() - lastUnstableToastRef.current > 45000) {
      lastUnstableToastRef.current = Date.now();
      useStore.getState().pushNotice('Sua conexão está instável — o áudio pode falhar. Tente se aproximar do Wi-Fi ou trocar de rede.');
    }
  }, [myNetQuality, callChannelId]);

  useEffect(() => () => {
    if (callRef.current) leaveChannel();
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    try { jitsiHostRef.current?.parentNode?.removeChild(jitsiHostRef.current); } catch { /* ok */ }
    jitsiHostRef.current = null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // BUG CORRIGIDO ("vídeo piscando/travando"): o MediaStream local era
  // recriado a CADA renderização do contexto (várias por segundo com o
  // indicador de fala), e cada objeto novo fazia o <video> reiniciar.
  // Agora só muda quando a faixa muda de verdade.
  const camTrack = cameraTrackRef.current;
  const scrTrack = screenTrackRef.current;
  const localCameraStream = useMemo(() => (camTrack ? new MediaStream([camTrack.getMediaStreamTrack()]) : null), [camTrack]);
  const localScreenStream = useMemo(() => (scrTrack ? new MediaStream([scrTrack.getMediaStreamTrack()]) : null), [scrTrack]);

  return (
    <VoiceContext.Provider value={{
      call, muted, micMissing, deafened, cameraOn, screenOn, participants: shownParticipants, roster, rosterStartedAt, rosterSpeaking, myRole, handsRaised,
      localSpeaking, joiningChannelId,
      remoteCameraStreams, remoteScreenStreams, remoteAudioStreams, volumes,
      // Auto-retrato local: do Agora (faixa) quando ativo; do engine (ex.:
      // LiveKit devolve o MediaStream local) nos demais provedores.
      localCameraStream: provider === 'agora' ? localCameraStream : engineLocalCameraStream,
      localScreenStream: provider === 'agora' ? localScreenStream : engineLocalScreenStream,
      joinChannel, joinChannelNow, leaveChannel, toggleMute, toggleDeafen, toggleCamera, toggleScreenShare, setParticipantVolume,
      raiseHand, setParticipantRole, stepDownFromStage,
      incomingCall, answerIncomingCall, declineIncomingCall,
      switchMicrophone,
      netQuality, getMicLastSoundAt: () => localSoundAtRef.current,
      getLocalAudioTrack: () => localAudioTrackRef.current,
      myRtt, callStartedAt, screenQuality, setScreenShareQuality,
      // Painel "Qualidade da conexão" (CallBar).
      getConnectionStats, getPingHistory: () => pingHistoryRef.current,
      // "Testar antes de entrar".
      preJoin, confirmPreJoin, cancelPreJoin,
      // Extras novos:
      reactions, sendReaction,
      recording, recordingPrompt, recordingConsents, requestRecording, respondRecording, stopRecording,
      pttEnabled, pttTalking,
      setNoiseReduction,
      // Provedor de mídia (Agora normal ⇆ Jitsi reserva):
      // Provedor de mídia ATIVO na cadeia (agora / livekit / jitsi / ...).
      // fallbackActive = qualquer provedor que não seja o primário (Agora).
      // fallbackActive = provedor depois do primário na cadeia (o servidor
      // próprio e o Agora NÃO são reserva).
      provider, fallbackActive: isReserveMode(provider), reconnectingProvider,
      reconnecting,
      providerLabel: providerLabel(provider),
      jitsiNode, attachJitsi, detachJitsi,
    }}
    >
      {children}
      {preJoin && (
        <Suspense fallback={null}>
          <PreJoinPanel
            key={preJoin.channelId}
            channelName={preJoin.channelName}
            inOtherCall={!!call}
            otherCallName={call?.channelName}
            onJoin={confirmPreJoin}
            onCancel={cancelPreJoin}
          />
        </Suspense>
      )}
    </VoiceContext.Provider>
  );
}

export function useVoice() {
  return useContext(VoiceContext);
}
