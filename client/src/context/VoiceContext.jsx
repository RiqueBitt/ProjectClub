import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useSocket } from './SocketContext.jsx';
import { useStore } from '../store/useStore';
import { playSound, playEntrySound } from '../utils/sounds';
import { getExtra, useExtra } from '../utils/extraPrefs';
import { getPreferredMicId, setPreferredMicId } from '../utils/audioDevices';
import { getVoiceJoin, reportVoiceProvider } from '../api/endpoints';
import { createFailureMemory, failureCode, withTimeout, isProviderFailure } from '../voice/resilience.js';
import { getVoicePref, onVoicePrefsChange, setVoicePref, makeReactionRateLimiter, isValidReaction, micInputGainFromPrefs, pttReleaseFromPrefs } from '../utils/voicePrefs';
import { buildScreenShareConfig, SCREEN_QUALITY_PRESETS, ALLOWED_FPS } from '../utils/screenShareTracks';
// Cadeia de provedores de mídia (servidor próprio → LiveKit → ... → Jitsi) —
// ver client/src/voice/* e docs/voice-fallback.md. TODA a mídia passa por um
// ENGINE do engineRegistry (mediasoup próprio, LiveKit, Jitsi, pendentes),
// baixado/instanciado só quando a cadeia o escolhe. A troca ao vivo entre
// QUAISQUER dois provedores preserva a sessão, o socket, o roster, as reações
// e o soundboard — só a camada de mídia troca.
import { readJoinResponse, isClientReady, providerLabel } from '../voice/providerDecision.js';
import { createEngine, CLIENT_READY_PROVIDERS } from '../voice/engineRegistry.js';
import { isReserveMode } from '../voice/providerDecision.js';
import { pickNoiseModel, currentHighQualityAvailability, NOISE_QUALITY, NOISE_MODELS } from '../voice/noiseModels.js';
// Item pedido: "no .apk, se sair do app, continua na call em segundo
// plano" — sem isso, o Android mata o áudio da chamada poucos segundos
// depois de minimizar o app. Importado direto (não via window.Capacitor)
// porque @capacitor/core já é dependência do projeto e funciona igual em
// qualquer plataforma: em web/desktop, isNativePlatform() já resolve
// pra false sozinho, então as funções abaixo viram no-op automático sem
// precisar de nenhum "if" espalhado pelo resto do arquivo.
import { Capacitor } from '@capacitor/core';
import { startAndroidScreenShare, stopAndroidScreenShare } from '../native/androidScreenShare';

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
  // App de PC (Electron): avisa que há chamada — o processo principal não
  // deixa o sistema suspender/estrangular a janela no meio da call.
  try { window.electronAPI?.setVoiceCallActive?.(true); } catch { /* fora do Electron */ }
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
    // minimizado — é isso que impede o JavaScript (e portanto a mídia da
    // chamada, que roda inteira dentro dele) de ser pausado.
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
  try { window.electronAPI?.setVoiceCallActive?.(false); } catch { /* fora do Electron */ }
  try {
    const bm = await getBackgroundMode();
    if (!bm) return;
    await bm.disable();
  } catch { /* nem tinha serviço rodando — ok */ }
}

const VoiceContext = createContext(null);

// Falha do provedor de voz: avisa o servidor (aparece nos logs como
// [erro-de-tela] voz:<provedor>) e devolve a mensagem certa pra pessoa.
// Erro de token/credencial = o servidor de chamadas recusou a entrada (não é
// a internet da pessoa).
// Também avisa o disjuntor da cadeia (POST /api/voice/report): falhas de 2+
// pessoas desarmam o provedor por um tempo e a cadeia pula ele pra todos.
function reportVoiceFailure(provider, err, channelName) {
  const message = String(err?.message || err || '').slice(0, 400);
  try {
    fetch('/api/system/client-error', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ where: `voz:${provider}`, path: window.location.pathname, message, stack: String(err?.stack || '').slice(0, 800) }),
    }).catch(() => {});
  } catch { /* sem rede */ }
  try { reportVoiceProvider(provider, failureCode(err), channelName); } catch { /* aviso opcional */ }
  if (/token|unauthori[sz]ed|4401/i.test(message)) {
    return 'O serviço de voz recusou a conexão (configuração do servidor de chamadas). A equipe já foi avisada — tente mais tarde.';
  }
  return 'Não foi possível conectar à chamada de voz agora. Tente de novo em instantes.';
}

// Tempo máximo pra um provedor conectar antes de contar como falha e ir pro
// próximo da cadeia. Servidor próprio: sinalização (≤10s) + recepção
// conectar (≤12s).
const ENGINE_JOIN_TIMEOUT_MS = 25000;

// Toda a parte de "quem está em qual sala", papéis (palco/plateia), mão
// levantada, soundboard e chamada de DM tocando é pura sinalização via
// Socket.IO (server/src/sockets/index.js), independente do provedor de mídia.
// As credenciais do provedor são pedidas pelo fluxo unificado /api/voice/join
// (ver getVoiceJoin + joinChannel abaixo), que já faz a checagem de acesso e
// devolve qual provedor usar — sempre um token fresco na hora de entrar.

// Volume individual por pessoa/transmissão (0 a 2 = 0% a 200%), lembrado
// entre sessões. Chave = id do usuário.
const VOLUMES_KEY = 'pc.voiceVolumes';
function loadSavedVolumes() {
  try {
    const raw = JSON.parse(localStorage.getItem(VOLUMES_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}
function saveVolumes(v) {
  try { localStorage.setItem(VOLUMES_KEY, JSON.stringify(v)); } catch { /* sem storage — só não lembra */ }
}
// Volume do SOM DA TELA de cada pessoa (separado da voz, igual ao "volume da
// transmissão" do Discord), também lembrado por pessoa.
const STREAM_VOLUMES_KEY = 'pc.voiceStreamVolumes';
function loadSavedStreamVolumes() {
  try {
    const raw = JSON.parse(localStorage.getItem(STREAM_VOLUMES_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}
function saveStreamVolumes(v) {
  try { localStorage.setItem(STREAM_VOLUMES_KEY, JSON.stringify(v)); } catch { /* sem storage — só não lembra */ }
}
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
  const micMissingRef = useRef(false);
  useEffect(() => { micMissingRef.current = micMissing; }, [micMissing]);
  const [deafened, setDeafened] = useState(false);
  // Ref do ensurdecer (lida por listeners/callbacks sem re-registrar nada).
  const deafenedRef = useRef(false);
  useEffect(() => { deafenedRef.current = deafened; }, [deafened]);
  // Mudo de antes de ensurdecer: desensurdecer volta pra ele (igual ao Discord).
  const mutedBeforeDeafenRef = useRef(false);
  // Mudo FORÇADO pelo palco (plateia): não vale pro próximo canal.
  const roleMutedRef = useRef(false);
  // Mudo/ensurdecer DA MODERAÇÃO (servidor), separado do meu próprio mudo.
  const [serverMod, setServerMod] = useState({ serverMuted: false, serverDeafened: false });
  const serverModRef = useRef(serverMod);
  // "Mover para…" de um moderador em andamento ({ to, at }).
  const forceMoveRef = useRef(null);
  // Id do canal AFK em que estou (voice:joined com afk:true) — mudo forçado.
  const afkChannelRef = useRef(null);
  // Entrada que falhou SEM ser culpa do provedor (canal cheio, abortada,
  // sem internet): não troca de provedor nem reporta falha.
  const joinStopRef = useRef(null);
  // Nível do microfone (~10/s, vindo do engine) pra quem quiser desenhar
  // um medidor — por assinatura, sem re-renderizar o contexto inteiro.
  const micLevelListenersRef = useRef(new Set());
  const micMeterOnRef = useRef(false);
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
  // Provedor de mídia ATIVO nesta chamada: 'projectclub' (servidor próprio,
  // o normal) ou uma reserva da cadeia (livekit/jitsi/...). Dirige a UI
  // ("Chamada em modo reserva").
  const [provider, setProvider] = useState('projectclub');
  const activeProviderRef = useRef('projectclub');
  useEffect(() => { activeProviderRef.current = provider; }, [provider]);
  // Troca de provedor no meio da chamada: mostra um aviso
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
  // sem som") e qualidade de rede por uid (0-6, vinda do engine).
  // `micMeterOn` = há um medidor de nível do microfone rodando (sem ele o
  // aviso de "microfone sem som" não tem como saber e fica desligado).
  const localSoundAtRef = useRef(0);
  const [micMeterOn, setMicMeterOn] = useState(false);
  const [netQuality, setNetQuality] = useState({});
  // Barra de chamada: ping (RTT até o servidor de mídia, ms), hora em que EU entrei
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
  // momento em que chegava do provedor, como "tela" ou "câmera" olhando o
  // estado do socket. Só que o aviso "estou transmitindo" (voice:state)
  // é enviado DEPOIS de publicar, então quase sempre o vídeo chegava
  // antes e era guardado como câmera pra sempre. Agora guarda um vídeo
  // por pessoa e decide tela/câmera na hora de mostrar (useMemo abaixo),
  // então se corrige sozinho assim que o estado chega.
  const [remoteVideoStreams, setRemoteVideoStreams] = useState({});
  const [remoteAudioStreams, setRemoteAudioStreams] = useState({});
  // Som da tela de cada pessoa, separado da voz (engine próprio).
  const [remoteScreenAudioStreams, setRemoteScreenAudioStreams] = useState({});
  // Painel "Voz conectada": ping (ms) e perda no envio (0..1) do engine.
  const [connStats, setConnStats] = useState(null);
  // Quem está conectado na mídia neste momento — usado pra nunca
  // esconder alguém que está na chamada de verdade só porque um evento
  // de socket se perdeu.
  const [mediaUids, setMediaUids] = useState({});
  const [volumes, setVolumes] = useState(loadSavedVolumes);
  const [streamVolumes, setStreamVolumes] = useState(loadSavedStreamVolumes);
  const [roster, setRoster] = useState({});
  const [rosterStartedAt, setRosterStartedAt] = useState({});
  const [rosterSpeaking, setRosterSpeaking] = useState({});
  const [incomingCall, setIncomingCall] = useState(null);

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
  // Provedores que falharam NESTE aparelho (10 min): ficam fora do
  // clientReady — nem o join nem o poll de troca voltam pra eles.
  const failureMemoryRef = useRef(null);
  if (!failureMemoryRef.current) failureMemoryRef.current = createFailureMemory();
  const readyProviders = useCallback(() => failureMemoryRef.current.filter(CLIENT_READY_PROVIDERS), []);
  // Refaz a mídia da call atual (mesmo provedor com credencial nova, ou o
  // próximo da cadeia) sem tirar a pessoa da sala — ver o efeito da troca.
  const requestMediaRecoveryRef = useRef(null);

  // Engine de mídia ATIVO (servidor próprio/LiveKit/Jitsi/...) + "host"
  // persistente onde o iframe do Jitsi fica ancorado mesmo quando a tela da
  // chamada não está montada (pra o áudio continuar em segundo plano/
  // janelinha). O VoiceChannelView "pega emprestado" o nó enquanto está
  // aberto (attachJitsi/detachJitsi).
  const engineRef = useRef(null);
  const jitsiHostRef = useRef(null);
  const [jitsiNode, setJitsiNode] = useState(null);
  // Mídia LOCAL (câmera/tela): o engine devolve o MediaStream local e
  // guardamos aqui pra o auto-retrato aparecer na grade.
  const [engineLocalCameraStream, setEngineLocalCameraStream] = useState(null);
  const [engineLocalScreenStream, setEngineLocalScreenStream] = useState(null);
  // Captura de tela nativa do app Android (Capacitor) em andamento.
  const androidScreenTrackRef = useRef(null);
  // Portão do microfone: apertar-pra-falar e sensibilidade de entrada vivem
  // NO ENGINE (voice/micGate.js + micPipeline.js — um pipeline de áudio só);
  // aqui só passamos as preferências. Engine sem portão (Jitsi/LiveKit):
  // ignora.
  const applyEngineMicConfig = useCallback((engine = engineRef.current) => {
    if (!engine) return;
    const p = getExtra();
    try { engine.setPushToTalk?.(getVoicePref('pushToTalkEnabled') === true, { releaseDelayMs: pttReleaseFromPrefs(getVoicePref('pushToTalkReleaseMs')) }); } catch { /* engine sem PTT */ }
    try { engine.setInputGain?.(micInputGainFromPrefs(p)); } catch { /* engine sem ganho */ }
    try {
      engine.setInputSensitivity?.(p.sensitivityAuto === false ? { auto: false, db: Number.isFinite(p.sensitivityDb) ? p.sensitivityDb : -60 } : { auto: true });
    } catch { /* engine sem sensibilidade */ }
  }, []);
  // Mudo/ensurdecer da moderação (servidor): atualiza a tela e avisa.
  const applyServerMod = useCallback((next = {}) => {
    const prev = serverModRef.current;
    const merged = {
      serverMuted: typeof next.serverMuted === 'boolean' ? next.serverMuted : prev.serverMuted,
      serverDeafened: typeof next.serverDeafened === 'boolean' ? next.serverDeafened : prev.serverDeafened,
    };
    if (merged.serverMuted === prev.serverMuted && merged.serverDeafened === prev.serverDeafened) return;
    serverModRef.current = merged;
    setServerMod(merged);
    if (!callRef.current) return;
    if (merged.serverDeafened && !prev.serverDeafened) useStore.getState().pushNotice('Você foi ensurdecido no servidor por um moderador.');
    else if (merged.serverMuted && !prev.serverMuted) useStore.getState().pushNotice('Você foi silenciado no servidor por um moderador.');
    else if (!merged.serverMuted && !merged.serverDeafened) useStore.getState().pushNotice('A moderação liberou seu microfone.');
  }, []);
  // Item pedido: "bug de clique duplo" nos botões — mudo/câmera/tela são
  // funções assíncronas (esperam o engine responder); clicar rápido demais
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
    const engine = engineRef.current;
    if (!engine || !container) return;
    const node = engine.getNode();
    if (node && node.parentNode !== container) container.appendChild(node);
  }, []);
  const detachJitsi = useCallback(() => {
    const engine = engineRef.current;
    const host = jitsiHostRef.current;
    if (!engine || !host) return;
    const node = engine.getNode();
    if (node && node.parentNode !== host) host.appendChild(node);
  }, []);

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

  const switchMicrophone = useCallback(async (deviceId) => {
    setPreferredMicId(deviceId);
    // Engine com troca de microfone (servidor próprio): troca a faixa no
    // producer. Os demais pegam o novo microfone na próxima entrada.
    const engine = engineRef.current;
    if (callRef.current && engine && typeof engine.setMicDevice === 'function') {
      try { return await engine.setMicDevice(deviceId); } catch { return false; }
    }
    return true;
  }, []);

  // Desmonta o engine de mídia, se houver (sair da chamada ou trocar de
  // provedor). Seguro chamar mesmo quando não tem nenhum.
  const teardownEngine = useCallback(() => {
    const engine = engineRef.current;
    const hadAndroidScreen = !!androidScreenTrackRef.current;
    androidScreenTrackRef.current = null;
    if (hadAndroidScreen) stopAndroidScreenShare();
    if (!engine) return;
    engineRef.current = null;
    setJitsiNode(null);
    setEngineLocalCameraStream(null);
    setEngineLocalScreenStream(null);
    if (micMeterOnRef.current) { micMeterOnRef.current = false; setMicMeterOn(false); }
    try { engine.dispose(); } catch { /* já foi */ }
  }, []);

  // ---------- Conectar por um ENGINE da cadeia ----------
  // Vale pra QUALQUER provedor (servidor próprio, livekit, jitsi e os
  // pendentes). O Jitsi embute uma conferência num iframe (sem faixas pra
  // nossa grade); o servidor próprio e o LiveKit são SFUs e entregam faixas
  // por participante, que caem na grade/AudioSink (identidade = nosso
  // userId). `isSwitch` = troca no meio de uma chamada já ativa (não toca som
  // de entrada, não zera o cronômetro, preserva o mudo).
  const connectEngine = useCallback(async ({ serverId, channelId, channelName, channelType, provider: prov, creds, isSwitch, quiet = false }) => {
    const okCreds = (prov === 'jitsi' && creds?.domain && creds?.room)
      || (prov === 'livekit' && creds?.url && creds?.token)
      || (prov !== 'jitsi' && prov !== 'livekit'); // pendentes: o engine falha claro no join
    if (!creds || !okCreds) {
      useStore.getState().pushNotice('Não foi possível conectar à chamada de voz agora. Tente de novo em instantes.');
      return false;
    }
    teardownEngine();
    let engine = null;
    const callbacks = {
      // Engine saiu da sala por conta própria:
      //  - 'replaced': entrou nesta call em outro aparelho → sai daqui, sem
      //    reconectar (senão um aparelho derruba o outro em loop);
      //  - 'token'/'gave-up'/'closed': a mídia caiu e não voltou sozinha →
      //    refaz a mídia (credencial nova / próximo provedor) sem sair da sala;
      //  - resto (desligou pelo próprio Jitsi, expulso): sai.
      onLeft: (info) => {
        if (engineRef.current !== engine) return; // engine antigo
        const reason = info && info.reason;
        if (reason === 'replaced') {
          useStore.getState().pushNotice('Você entrou nesta call em outro aparelho');
          leaveChannelRef.current?.();
          return;
        }
        if (reason === 'full') {
          useStore.getState().pushNotice('Canal cheio');
          leaveChannelRef.current?.();
          return;
        }
        if (reason === 'kicked') {
          const detail = info?.detail;
          // Movido por um moderador: o voice:force-move (socket) troca de
          // canal. Se ele não chegar logo, sai.
          if (detail === 'moved') {
            setTimeout(() => {
              const fm = forceMoveRef.current;
              if (fm && Date.now() - fm.at < 8000) return;
              if (engineRef.current === engine || !engineRef.current) leaveChannelRef.current?.();
            }, 3000);
            return;
          }
          if (detail === 'missed') { leaveChannelRef.current?.(); return; }
          useStore.getState().pushNotice('Você foi desconectado da chamada por um moderador.');
          leaveChannelRef.current?.();
          return;
        }
        if ((reason === 'token' || reason === 'gave-up' || reason === 'closed') && callRef.current) {
          engineRef.current = null;
          setRemoteAudioStreams({});
          setRemoteScreenAudioStreams({});
          setRemoteVideoStreams({});
          setReconnecting(null);
          // Caiu por falta de internet / limite de tentativas: NÃO é falha do
          // provedor (não marca nem reporta) — só refaz a mídia.
          const providerFault = reason === 'gave-up' && isProviderFailure(info);
          if (!providerFault && reason === 'gave-up' && info?.network) useStore.getState().pushNotice('Sua internet caiu — reconectando a chamada…');
          requestMediaRecoveryRef.current?.({ failed: providerFault ? prov : null, code: reason, mediaGone: true });
          return;
        }
        leaveChannelRef.current?.();
      },
      // Mic negado/ausente: entra só ouvindo (os outros continuam audíveis).
      onMicUnavailable: ({ reason } = {}) => {
        setMicMissing(true);
        setMuted(true);
        broadcastState({ muted: true });
        const msg = reason === 'denied'
          ? 'Sem permissão para o microfone — você entrou só ouvindo. Libere o microfone no navegador e toque no botão de mudo.'
          : reason === 'busy'
            ? 'O microfone está sendo usado por outro programa — você entrou só ouvindo. Feche o outro programa e toque no botão de mudo.'
            : 'Microfone não encontrado. Você entrou no canal mudo — conecte um microfone e toque no botão de mudo para ativá-lo.';
        useStore.getState().pushNotice(msg);
      },
      onMicRecovered: () => { setMicMissing(false); },
      // Envio/recepção que nunca conectou depois de entrar: o provedor não
      // serve pra esta rede → avisa e vai pro próximo da cadeia.
      onMediaFailed: ({ code } = {}) => {
        if (engineRef.current !== engine) return;
        reportVoiceFailure(prov, Object.assign(new Error(`mídia não conectou (${code})`), { code }), channelId);
        requestMediaRecoveryRef.current?.({ failed: prov, code });
      },
      onReconnecting: (attempt, why) => { setReconnecting({ attempt, offline: why === 'sem internet' || (typeof navigator !== 'undefined' && navigator.onLine === false) }); setNetQuality({}); },
      onReconnected: () => { setReconnecting(null); },
      // Qualidade/ping vindos do engine (SFU próprio / LiveKit), na escala
      // 0-6 da UI — cai nos mesmos pontinhos/barras.
      onNetQuality: (next) => {
        setNetQuality((prev) => {
          const keys = Object.keys(next);
          return keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]) ? prev : next;
        });
      },
      onRtt: (rtt) => { const r = Math.round(rtt / 5) * 5; setMyRtt((prev) => (prev === r ? prev : r)); },
      // Perda no envio pro painel "Voz conectada" (arredondada: sem render à toa).
      onConnectionStats: ({ sendLoss } = {}) => {
        const loss = Number.isFinite(sendLoss) ? Math.round(sendLoss * 1000) / 1000 : null;
        setConnStats((prev) => (prev && prev.sendLoss === loss ? prev : { sendLoss: loss }));
      },
      // Fala: espelha no MEU anel verde e reemite pros outros pelo nosso
      // socket. O engine próprio já desconta mudo/portão fechado
      // (apertar-pra-falar sem a tecla, abaixo da sensibilidade).
      onLocalSpeaking: (raw) => {
        const speaking = !!raw;
        if (speaking) localSoundAtRef.current = Date.now();
        if (localSpeakingRef.current === speaking) return;
        localSpeakingRef.current = speaking;
        setLocalSpeaking(speaking);
        socket?.emit('voice:speaking', { channelId: callRef.current?.channelId, speaking });
      },
      onRemoteSpeaking: (uid, speaking) => {
        const uidStr = String(uid);
        setParticipants((s) => (s[uidStr] && !!s[uidStr].speaking !== speaking ? { ...s, [uidStr]: { ...s[uidStr], speaking } } : s));
      },
      onSelfMute: (m) => { mutedRef.current = m; setMuted(m); if (!m) setMicMissing(false); broadcastState({ muted: m }); },
      // Nível do microfone (engine próprio): liga o aviso "microfone sem som"
      // e alimenta quem assinou (subscribeMicLevel).
      onLocalLevel: (level, info) => {
        if (info && info.db > -70) localSoundAtRef.current = Date.now();
        if (!micMeterOnRef.current) { micMeterOnRef.current = true; setMicMeterOn(true); }
        micLevelListenersRef.current.forEach((fn) => { try { fn(level, info); } catch { /* ok */ } });
      },
      // Estado imposto pelo servidor de mídia (mudo/ensurdecer da moderação).
      onServerState: (st) => { if (st) applyServerMod({ serverMuted: !!st.serverMuted, serverDeafened: !!st.serverDeafened }); },
      // Erro de câmera/tela com mensagem amigável (seletor fechado = nada).
      onMediaError: ({ reason, cancelled } = {}) => { if (!cancelled && reason) useStore.getState().pushNotice(reason); },
      onTelemetry: (t) => { console.info('[voz] telemetria do engine:', t); },
      onSelfCamera: (on) => { setCameraOn(on); broadcastState({ video: on }); },
      onSelfScreen: (on) => { setScreenOn(on); broadcastState({ screenSharing: on }); },
      onError: (ev, payload) => { console.error('[voz] engine de voz reportou um erro:', ev, payload); },
      // Faixas por participante (servidor próprio/LiveKit) → grade/AudioSink.
      onMediaUser: (uid, present) => {
        const uidStr = String(uid);
        if (present) setMediaUids((s) => (s[uidStr] ? s : { ...s, [uidStr]: true }));
        else setMediaUids((s) => dropKey(s, uidStr));
      },
      onRemoteAudio: (uid, stream) => setRemoteAudioStreams((s) => ({ ...s, [String(uid)]: stream })),
      // Som da tela separado (volume próprio); null = parou.
      onRemoteScreenAudio: (uid, stream) => setRemoteScreenAudioStreams((s) => (stream ? { ...s, [String(uid)]: stream } : dropKey(s, String(uid)))),
      onRemoteVideo: (uid, stream) => setRemoteVideoStreams((s) => ({ ...s, [String(uid)]: stream })),
      onRemoteRemove: (uid, kind) => {
        const uidStr = String(uid);
        if (kind === 'audio' || kind === 'all') setRemoteAudioStreams((s) => dropKey(s, uidStr));
        if (kind === 'video' || kind === 'all') setRemoteVideoStreams((s) => dropKey(s, uidStr));
        if (kind === 'all') { setMediaUids((s) => dropKey(s, uidStr)); setRemoteScreenAudioStreams((s) => dropKey(s, uidStr)); }
      },
    };
    engine = createEngine(prov, callbacks, creds);
    if (!engine) {
      useStore.getState().pushNotice('Este provedor de voz ainda não está disponível neste aparelho.');
      return false;
    }
    engineRef.current = engine;
    // Apertar-pra-falar e sensibilidade valem desde o primeiro instante.
    applyEngineMicConfig(engine);
    // Jitsi tem um nó de iframe que ancoramos no host persistente; os demais
    // não têm nó (getNode()=null) — a grade é a nossa.
    const node = engine.getNode?.();
    if (node) { const host = ensureJitsiHost(); if (host) host.appendChild(node); }
    setJitsiNode(node || null);
    // Zera o auto-retrato local do engine anterior.
    setEngineLocalCameraStream(null);
    setEngineLocalScreenStream(null);
    joinStopRef.current = null;
    try {
      // Mudo/ensurdecido continuam valendo ao trocar de canal (igual ao Discord).
      const startMuted = mutedRef.current || deafenedRef.current;
      if (prov === 'jitsi') {
        // Jitsi é a reserva final: sem tempo limite (o iframe demora mais).
        await engine.join({ room: creds.room, jwt: creds.jwt, displayName: user?.displayName, startMuted });
      } else if (prov === 'livekit') {
        await withTimeout(engine.join({ url: creds.url, token: creds.token, userId: user?.id, displayName: user?.displayName, startMuted }), ENGINE_JOIN_TIMEOUT_MS, 'JOIN_TIMEOUT');
      } else {
        await withTimeout(engine.join({
          ...creds, userId: user?.id, displayName: user?.displayName, startMuted,
          // Ensurdecido: o servidor nem manda o áudio dos outros (economia de banda).
          startDeafened: deafenedRef.current,
          // Redutor de ruído (RNNoise) no engine próprio.
          noiseSuppression: getVoicePref('noiseReduction') !== false,
          noiseModel: pickNoiseModel({ quality: getVoicePref('noiseQuality'), availability: currentHighQualityAvailability() }),
          micDeviceId: getPreferredMicId() || null,
          // Token do servidor próprio venceu numa call longa (4401 expired):
          // pede um novo pelo mesmo /api/voice/join. Se a sala mudou de
          // provedor nesse meio-tempo, não renova (a troca cuida disso).
          refreshCredentials: async () => {
            const raw = await getVoiceJoin(channelId, readyProviders());
            const fresh = raw ? readJoinResponse(raw) : null;
            return fresh && fresh.provider === prov ? fresh[prov] : null;
          },
        }), ENGINE_JOIN_TIMEOUT_MS, 'JOIN_TIMEOUT');
      }
    } catch (err) {
      console.error(`[voz] Falha ao conectar no provedor ${prov}:`, err);
      if (engineRef.current === engine) teardownEngine();
      else { try { engine.dispose(); } catch { /* ok */ } }
      // Canal cheio / entrada abortada / sem internet / expulso: NÃO é falha
      // do provedor — não reporta nem pula pro próximo da cadeia.
      if (!isProviderFailure(err)) {
        joinStopRef.current = err?.code || 'aborted';
        if (err?.code === 'channel-full') useStore.getState().pushNotice('Canal cheio');
        else if (err?.code === 'offline') useStore.getState().pushNotice('Sem internet — conecte-se e tente entrar de novo.');
        else if (err?.code === 'rate-limited') useStore.getState().pushNotice('Muitas tentativas seguidas — aguarde alguns segundos e tente de novo.');
        return false;
      }
      const msg = reportVoiceFailure(prov, err, channelId);
      if (!quiet) useStore.getState().pushNotice(msg);
      return false;
    }
    if (!isSwitch && joiningChannelIdRef.current !== channelId) {
      if (engineRef.current === engine) teardownEngine();
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
  }, [socket, user?.id, user?.displayName, broadcastState, ensureJitsiHost, teardownEngine, readyProviders, applyEngineMicConfig, applyServerMod]);
  const connectEngineRef = useRef(connectEngine);
  useEffect(() => { connectEngineRef.current = connectEngine; }, [connectEngine]);

  const joinChannel = useCallback(async (serverId, channelId, channelName, channelType) => {
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
      // só pra este join).
      // Failover automático: se o provedor escolhido não conectar (ex.:
      // servidor próprio fora do ar), pede o PRÓXIMO da cadeia sem ele
      // (servidor próprio → LiveKit, se configurado → Jitsi) — a pessoa entra
      // mesmo assim. Provedores que falharam neste aparelho há pouco já saem
      // da lista.
      let ready = readyProviders();
      for (let attempt = 0; attempt < 4 && ready.length; attempt += 1) {
        const last = attempt === 3 || ready.length === 1;
        let raw = null;
        let serverMsg = null;
        for (let i = 0; i < 2; i += 1) {
          let fatal = false;
          // eslint-disable-next-line no-await-in-loop
          raw = await getVoiceJoin(channelId, ready).catch((err) => {
            console.error('[voz] Falha ao consultar o provedor de voz:', err);
            // 4xx (sem acesso, canal sumiu): não adianta repetir.
            if (err?.response?.status && err.response.status < 500) {
              fatal = true;
              serverMsg = typeof err.response.data?.error === 'string' ? err.response.data.error : null;
            }
            return null;
          });
          if (raw || fatal || joiningChannelIdRef.current !== channelId) break;
          await new Promise((r) => { setTimeout(r, 1000); });
        }
        if (joiningChannelIdRef.current !== channelId) return;
        const creds = raw ? readJoinResponse(raw) : null;
        if (!creds) {
          useStore.getState().pushNotice(serverMsg || 'Não foi possível conectar à chamada de voz agora. Tente de novo em instantes.');
          return;
        }

        const ok = await connectEngine({ serverId, channelId, channelName, channelType, provider: creds.provider, creds: creds[creds.provider], isSwitch: false, quiet: !last });
        if (ok || joiningChannelIdRef.current !== channelId || creds.provider === 'jitsi') return;
        // Canal cheio / abortada / sem internet: o aviso já saiu; não troca de provedor.
        if (joinStopRef.current) return;
        failureMemoryRef.current.mark(creds.provider);
        ready = ready.filter((p) => p !== creds.provider);
      }
      useStore.getState().pushNotice('Não foi possível conectar à chamada de voz agora. Tente de novo em instantes.');
    } finally {
      if (joiningChannelIdRef.current === channelId) joiningChannelIdRef.current = null;
      setJoiningChannelId((c) => (c === channelId ? null : c));
    }
  }, [connectEngine, teardownEngine, readyProviders]);

  const answerIncomingCall = useCallback(() => {
    if (!incomingCall) return;
    const { conversationId, channelId } = incomingCall;
    const convo = useStore.getState().conversations.find((c) => c.id === conversationId);
    const name = convo ? (convo.isGroup ? convo.name : (convo.members.find((m) => m.id !== user?.id)?.displayName || 'Chamada')) : 'Chamada';
    joinChannel(null, channelId, name, 'DM');
  }, [incomingCall, joinChannel, user?.id]);

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
    Object.values(soundboardAudiosRef.current).forEach((el) => { try { el.pause(); el.src = ''; } catch { /* ok */ } });
    soundboardAudiosRef.current = {};
    if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null; }
    setNetQuality({});
    setMyRtt(null);
    setConnStats(null);
    setReconnecting(null);
    setCallStartedAt(null);
    setScreenQuality(null);
    // Encerra a mídia do provedor atual (engine + captura nativa de tela) e
    // volta o provedor pro padrão pra próxima chamada. A tela limpa na hora
    // (sem esperar o provedor terminar de sair).
    teardownEngine();
    setProvider('projectclub');
    setReconnectingProvider(false);

    setCall(null);
    callRef.current = null;
    setParticipants({});
    setHandsRaised({});
    // Mudo/ensurdecido PERSISTEM entre canais (igual ao Discord). Só o mudo
    // forçado (plateia do palco / sem microfone) não vai junto.
    if (roleMutedRef.current || micMissingRef.current) { roleMutedRef.current = false; mutedRef.current = false; setMuted(false); }
    serverModRef.current = { serverMuted: false, serverDeafened: false };
    setServerMod(serverModRef.current);
    setCameraOn(false);
    setScreenOn(false);
    setMyRole('speaker');
    setMicMissing(false);
    setRemoteAudioStreams({});
    setRemoteScreenAudioStreams({});
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
  }, [socket, teardownEngine]);
  useEffect(() => { leaveChannelRef.current = leaveChannel; }, [leaveChannel]);

  const toggleMute = useCallback(async () => {
    if (toggleMuteBusyRef.current) return;
    toggleMuteBusyRef.current = true;
    try {
      const wantUnmute = mutedRef.current; // mutado agora => quero desmutar
      if (wantUnmute && callRef.current?.channelType === 'STAGE' && myRole === 'audience') return;
      if (wantUnmute && callRef.current && afkChannelRef.current === callRef.current.channelId) {
        useStore.getState().pushNotice('No canal AFK ninguém fala — entre em outro canal de voz.');
        return;
      }
      if (wantUnmute && serverModRef.current.serverMuted) useStore.getState().pushNotice('Você foi silenciado no servidor por um moderador.');
      const engine = callRef.current ? engineRef.current : null;
      // Desmutar estando ensurdecido também desensurdece (igual ao Discord).
      if (wantUnmute && deafenedRef.current) {
        if (serverModRef.current.serverDeafened) { useStore.getState().pushNotice('Você foi ensurdecido no servidor por um moderador.'); return; }
        deafenedRef.current = false;
        mutedBeforeDeafenRef.current = false;
        setDeafened(false);
        try { await engine?.setDeafened?.(false); } catch { /* engine sem ensurdecer no servidor */ }
        broadcastState({ deafened: false });
      }
      // Fora de uma chamada: só guarda a escolha (vale na próxima entrada).
      if (!engine) { mutedRef.current = !wantUnmute; setMuted(!wantUnmute); return; }
      // O microfone é controlado pelo engine; o estado real volta pelo
      // callback onSelfMute (que atualiza `muted` + avisa os outros via
      // socket). A trava só solta DEPOIS do engine responder (clique duplo).
      await engine.setMicEnabled(wantUnmute);
    } finally {
      toggleMuteBusyRef.current = false;
    }
  }, [myRole, broadcastState]);

  const toggleDeafenBusyRef = useRef(false);
  const toggleDeafen = useCallback(async () => {
    if (toggleDeafenBusyRef.current) return;
    toggleDeafenBusyRef.current = true;
    try {
      const next = !deafenedRef.current;
      if (!next && serverModRef.current.serverDeafened) { useStore.getState().pushNotice('Você foi ensurdecido no servidor por um moderador.'); return; }
      const engine = callRef.current ? engineRef.current : null;
      // Ensurdecer guarda o mudo de antes; desensurdecer volta pra ele.
      if (next) mutedBeforeDeafenRef.current = mutedRef.current;
      const nextMuted = next ? true : mutedBeforeDeafenRef.current;
      deafenedRef.current = next;
      setDeafened(next);
      // O áudio que CHEGA é zerado pelo AudioSink (estado `deafened`); o
      // engine próprio também pede pro servidor parar de mandar (banda).
      try { await engine?.setDeafened?.(next); } catch { /* engine sem ensurdecer no servidor */ }
      if (engine && nextMuted !== mutedRef.current) await engine.setMicEnabled(!nextMuted);
      mutedRef.current = nextMuted;
      setMuted(nextMuted);
      broadcastState({ deafened: next, muted: nextMuted });
    } finally {
      toggleDeafenBusyRef.current = false;
    }
  }, [broadcastState]);

  const toggleCamera = useCallback(async () => {
    if (toggleCameraBusyRef.current) return;
    toggleCameraBusyRef.current = true;
    try {
      // A câmera é comando do engine. O Jitsi não devolve faixa pra nossa
      // grade (null); o servidor próprio/LiveKit devolvem o MediaStream
      // local, que guardamos pro auto-retrato. O estado `cameraOn` volta
      // pelo callback onSelfCamera.
      const engine = engineRef.current;
      if (!engine) return;
      const stream = await engine.setCamera(!cameraOn);
      setEngineLocalCameraStream(stream || null);
    } catch (err) {
      useStore.getState().pushNotice('Não foi possível acessar a câmera.');
    } finally {
      toggleCameraBusyRef.current = false;
    }
  }, [cameraOn]);

  const toggleScreenShare = useCallback(async (options = {}) => {
    if (toggleScreenShareBusyRef.current) return;
    toggleScreenShareBusyRef.current = true;
    try {
      // A captura é do engine. O Jitsi mostra pros outros pelo iframe (sem
      // faixa local pra nós); o servidor próprio/LiveKit devolvem o
      // MediaStream local, guardado pro auto-retrato. O estado volta por
      // onSelfScreen.
      const engine = engineRef.current;
      if (!engine) return;
      if (screenOn) {
        await engine.setScreen(false);
        setEngineLocalScreenStream(null);
        // Captura nativa do app Android: também para o serviço de captura
        // (MediaProjection) — só tirar do ar não pararia a captura.
        if (androidScreenTrackRef.current) {
          stopAndroidScreenShare();
          androidScreenTrackRef.current = null;
        }
        setScreenQuality(null);
        return;
      }
      // Item pedido C ("o compartilhamento NÃO pode levar a voz do mic"):
      // a captura de tela (getDisplayMedia) só entrega vídeo da tela + ÁUDIO
      // DO SISTEMA/ABA, nunca o microfone — a voz continua indo pela faixa
      // do microfone, publicada à parte pelo engine.
      const cfg = buildScreenShareConfig(options);
      const isNativeApp = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
      if (isNativeApp && engine.capabilities?.().nativeScreenTrack) {
        // App Android (Capacitor): o plugin nativo (ScreenSharePlugin.java)
        // entrega os quadros da tela e native/androidScreenShare.js vira uma
        // faixa de vídeo de verdade (via <canvas>), publicada pelo engine.
        // 12fps/qualidade 65 (captura já em ~720p, ver ScreenCaptureService).
        try {
          const mediaStreamTrack = await startAndroidScreenShare({ fps: 12, quality: 65 });
          if (!mediaStreamTrack) return; // pessoa negou a permissão do sistema
          androidScreenTrackRef.current = mediaStreamTrack;
          const stream = await engine.setScreen(true, { track: mediaStreamTrack, audio: false });
          if (!stream) throw Object.assign(new Error('engine não publicou a tela'), { notified: true });
          setEngineLocalScreenStream(stream);
        } catch (err) {
          // O engine próprio já avisou o motivo (onMediaError).
          if (!err?.notified) useStore.getState().pushNotice('Não foi possível compartilhar a tela.');
          stopAndroidScreenShare();
          androidScreenTrackRef.current = null;
        }
        return;
      }
      const stream = await engine.setScreen(true, { audio: cfg.withSystemAudio, quality: cfg.quality, frameRate: cfg.frameRate });
      setEngineLocalScreenStream(stream || null);
      if (stream) setScreenQuality({ quality: cfg.quality, frameRate: cfg.frameRate });
    } finally {
      toggleScreenShareBusyRef.current = false;
    }
  }, [screenOn]);
  // Trocar a qualidade da tela SEM parar a transmissão (o engine aplica na
  // faixa que já está no ar). Também lembra a escolha pra próxima vez.
  const setScreenShareQuality = useCallback(async ({ quality, frameRate }) => {
    if (!SCREEN_QUALITY_PRESETS[quality] || !ALLOWED_FPS.includes(frameRate)) return false;
    try {
      const saved = JSON.parse(localStorage.getItem('screenShareOptions') || 'null') || {};
      localStorage.setItem('screenShareOptions', JSON.stringify({ audio: true, ...saved, quality, frameRate }));
    } catch { /* sem storage */ }
    const engine = engineRef.current;
    if (!engine || androidScreenTrackRef.current || typeof engine.setScreenQuality !== 'function') return false;
    try {
      const ok = await engine.setScreenQuality({ quality, frameRate });
      if (ok) setScreenQuality({ quality, frameRate });
      return !!ok;
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
  // o elemento <audio>. Lembrado por pessoa no localStorage.
  const setParticipantVolume = useCallback((userId, volume) => {
    const v = Math.min(2, Math.max(0, Number(volume) || 0));
    setVolumes((s) => {
      const next = { ...s, [userId]: v };
      saveVolumes(next);
      return next;
    });
  }, []);
  // Volume do SOM DA TELA de uma pessoa (0–2), separado da voz. Provedor
  // que não separa (Jitsi/LiveKit): o som da tela vem junto da voz e segue o
  // volume da pessoa.
  const setStreamVolume = useCallback((userId, volume) => {
    const v = Math.min(2, Math.max(0, Number(volume) || 0));
    setStreamVolumes((s) => {
      const next = { ...s, [userId]: v };
      saveStreamVolumes(next);
      return next;
    });
  }, []);
  // Onde cada vídeo remoto aparece (bloco visível? altura?) → o engine pausa
  // o que ninguém vê e escolhe a camada do simulcast pelo tamanho.
  const reportVideoViewport = useCallback((uid, kind, viewId, view) => {
    try { engineRef.current?.setVideoViewport?.(String(uid), kind, view, viewId); } catch { /* engine sem isso */ }
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
  // Troca a preferência e, no engine próprio (mediasoup), liga/desliga o
  // RNNoise na hora. Fora de uma chamada (ou em outro provedor) só guarda a
  // escolha pra valer na próxima vez.
  const setNoiseReduction = useCallback(async (on) => {
    setVoicePref('noiseReduction', !!on);
    const engine = engineRef.current;
    if (engine && typeof engine.setNoiseSuppression === 'function') {
      try { await engine.setNoiseSuppression(!!on); } catch (err) { console.error('[voz] redutor de ruído:', err); }
    }
  }, []);

  // Qualidade do redutor ('standard' = RNNoise | 'high' = DeepFilterNet3,
  // só com a flag VITE_VOICE_DFN3_URL — voice/noiseModels.js). Carrega na
  // hora quando escolhido; falhou/CPU lenta → RNNoise sozinho.
  const setNoiseQuality = useCallback(async (quality) => {
    const q = quality === NOISE_QUALITY.HIGH ? NOISE_QUALITY.HIGH : NOISE_QUALITY.STANDARD;
    setVoicePref('noiseQuality', q);
    const engine = engineRef.current;
    if (!engine || typeof engine.setNoiseModel !== 'function') return null;
    const model = pickNoiseModel({ quality: q, availability: currentHighQualityAvailability() });
    const running = await engine.setNoiseModel(model);
    if (q === NOISE_QUALITY.HIGH && running && running !== NOISE_MODELS.DFN3) {
      useStore.getState().pushNotice('O redutor de alta qualidade não rodou neste aparelho — usando o padrão.');
    }
    return running;
  }, []);

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

  // ---------- Moderação de voz do servidor (igual ao Discord) ----------
  // O servidor confere a permissão (no canal) e a hierarquia de cargos e
  // aplica NA MÍDIA também; aqui só manda e mostra o erro, se houver.
  const runModeration = useCallback((event, payload) => new Promise((resolve) => {
    if (!socket?.connected) { useStore.getState().pushNotice('Sem conexão com o servidor.'); resolve({ ok: false }); return; }
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      useStore.getState().pushNotice('O servidor não respondeu — tente de novo.');
      resolve({ ok: false });
    }, 8000);
    socket.emit(event, payload, (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!r?.ok) useStore.getState().pushNotice(r?.error || 'Não foi possível concluir a ação.');
      resolve(r || { ok: false });
    });
  }), [socket]);
  const serverMuteMember = useCallback((targetUserId, mutedFlag, channelId = callRef.current?.channelId) => (
    runModeration('voice:server-mute', { channelId, userId: targetUserId, muted: !!mutedFlag })
  ), [runModeration]);
  const serverDeafenMember = useCallback((targetUserId, deafFlag, channelId = callRef.current?.channelId) => (
    runModeration('voice:server-deafen', { channelId, userId: targetUserId, deafened: !!deafFlag })
  ), [runModeration]);
  const moveMember = useCallback((targetUserId, toChannelId, channelId = callRef.current?.channelId) => (
    runModeration('voice:move', { channelId, userId: targetUserId, toChannelId })
  ), [runModeration]);
  const disconnectMember = useCallback((targetUserId, channelId = callRef.current?.channelId) => (
    runModeration('voice:disconnect', { channelId, userId: targetUserId })
  ), [runModeration]);
  // Medidor do microfone por assinatura (fn(level0a1, { db, gateOpen, transmitting })).
  const subscribeMicLevel = useCallback((fn) => {
    if (typeof fn !== 'function') return () => {};
    micLevelListenersRef.current.add(fn);
    return () => { micLevelListenersRef.current.delete(fn); };
  }, []);

  // Refs pros listeners abaixo: antes o efeito dependia de `deafened` e
  // `joinChannel`, então TODOS os listeners eram removidos e recolocados a
  // cada ensurdecer/desensurdecer — e a marca "caiu a conexão" (usada pra
  // reentrar sozinho na chamada ao reconectar) era zerada junto, fazendo
  // a reentrada automática se perder.
  const applyServerModRef = useRef(applyServerMod);
  useEffect(() => { applyServerModRef.current = applyServerMod; }, [applyServerMod]);
  const joinChannelRef = useRef(joinChannel);
  useEffect(() => { joinChannelRef.current = joinChannel; }, [joinChannel]);
  const sawDisconnectRef = useRef(false);

  useEffect(() => {
    if (!socket) return;

    const onJoined = ({ channelId, participants: existing, myRole: role, sync, afk }) => {
      if (callRef.current?.channelId !== channelId) return;
      // Canal AFK da comunidade: fica mudo enquanto estiver lá (o servidor
      // também não deixa falar); ao sair volta o mudo de antes.
      afkChannelRef.current = afk ? channelId : null;
      if (afk && !mutedRef.current) {
        roleMutedRef.current = true;
        try { engineRef.current?.setMicEnabled(false); } catch { /* engine trocou */ }
        mutedRef.current = true;
        setMuted(true);
      }
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
        if (role === 'audience') {
          if (!mutedRef.current) roleMutedRef.current = true;
          engineRef.current?.setMicEnabled(false);
          mutedRef.current = true;
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
      // O meu próprio estado vem do local (senão vira um bloco fantasma meu).
      if (String(userId) === String(user?.id)) return;
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
          if (!mutedRef.current) roleMutedRef.current = true;
          engineRef.current?.setMicEnabled(false);
          mutedRef.current = true;
          setMuted(true);
        } else if (role === 'speaker' && !deafenedRef.current) {
          roleMutedRef.current = false;
          engineRef.current?.setMicEnabled(true);
          mutedRef.current = false;
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
    // derrubada por dentro pelo servidor de mídia (dois clientes com o mesmo
    // usuário não ficam no mesmo canal), mas a TELA continuaria
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
    // Moderação do servidor (ver server/src/sockets/index.js).
    const onServerState = ({ channelId, serverMuted, serverDeafened }) => {
      if (callRef.current?.channelId !== channelId) return;
      applyServerModRef.current?.({ serverMuted: !!serverMuted, serverDeafened: !!serverDeafened });
      // Também no motor: servidor de mídia ANTIGO (sem /control) não aplica
      // nem avisa — assim o mic fica pausado aqui mesmo assim.
      try { engineRef.current?.applyModeration?.({ serverMuted: !!serverMuted, serverDeafened: !!serverDeafened }); } catch { /* engine sem moderação */ }
    };
    const findChannel = (id) => {
      const s = useStore.getState();
      return [...(s.channels || []), ...(s.categories || []).flatMap((c) => c.channels || [])].find((c) => c && c.id === id) || null;
    };
    const onForceMove = ({ channelId: toId, fromChannelId }) => {
      const current = callRef.current;
      if (!current || !toId || (fromChannelId && current.channelId !== fromChannelId)) return;
      forceMoveRef.current = { to: toId, at: Date.now() };
      const ch = findChannel(toId);
      useStore.getState().pushNotice(`Um moderador moveu você para ${ch?.name || 'outro canal'}.`);
      joinChannelRef.current?.(current.serverId, toId, ch?.name || 'Canal de voz', ch?.type || 'VOICE');
    };
    const onForceDisconnect = ({ channelId }) => {
      if (callRef.current?.channelId !== channelId) return;
      useStore.getState().pushNotice('Você foi desconectado da chamada por um moderador.');
      leaveChannelRef.current?.();
    };
    // Atendeu em OUTRO aparelho: este para de tocar.
    const onDmCallAnswered = ({ conversationId }) => {
      setIncomingCall((c) => (c && c.conversationId === conversationId ? null : c));
    };
    // 60s sem resposta: a chamada termina como perdida (os dois lados).
    const onDmCallMissed = ({ conversationId, channelId }) => {
      setIncomingCall((c) => (c && c.conversationId === conversationId ? null : c));
      const cid = channelId || `dm:${conversationId}`;
      if (callRef.current?.channelId === cid) {
        useStore.getState().pushNotice('Ninguém atendeu a chamada.');
        leaveChannelRef.current?.();
      }
    };
    // Varredura AFK do servidor (services/voiceAfk.js): parado na voz além do
    // tempo configurado → vai pro canal AFK (mudo). Igual ao force-move: a
    // sessão de mídia antiga cai com kicked/moved, ignorado por forceMoveRef.
    const onAfkMove = ({ channelId, channelName, fromChannelId }) => {
      const current = callRef.current;
      if (!current || !channelId || (fromChannelId && current.channelId !== fromChannelId)) return;
      forceMoveRef.current = { to: channelId, at: Date.now() };
      useStore.getState().pushNotice(`Você foi movido para ${channelName || 'o canal AFK'} por inatividade.`);
      joinChannelRef.current?.(current.serverId, channelId, channelName || 'AFK', 'VOICE');
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
    socket.on('voice:server-state', onServerState);
    socket.on('voice:force-move', onForceMove);
    socket.on('voice:force-disconnect', onForceDisconnect);
    socket.on('dm-call:answered', onDmCallAnswered);
    socket.on('dm-call:missed', onDmCallMissed);
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
      socket.off('voice:server-state', onServerState);
      socket.off('voice:force-move', onForceMove);
      socket.off('voice:force-disconnect', onForceDisconnect);
      socket.off('dm-call:answered', onDmCallAnswered);
      socket.off('dm-call:missed', onDmCallMissed);
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
  // Troca entre QUAISQUER dois provedores da cadeia, SEM te deslogar e SEM te
  // tirar da sala: derruba só a mídia atual (o engine) e sobe a do novo
  // provedor no MESMO canal,
  // mantendo sessão, socket, roster, reações e soundboard montados. Um aviso
  // curto "Reconectando…" aparece no meio.
  //
  // Dispara em quatro casos:
  //  (a) a equipe mudou a cadeia no painel / o disjuntor desarmou um provedor
  //      (voice:provider-changed pra comunidade) — troca IMEDIATA;
  //  (b) a sala migrou de provedor (voice:provider-changed com channelId da
  //      MINHA call) — todo mundo da call termina no MESMO provedor;
  //  (c) um provedor cruzou o limite mensal no meio da chamada — pego por um
  //      poll leve de /api/voice/join (que já devolve o provedor decidido);
  //  (d) RECUPERAÇÃO: a mídia atual falhou (engine desistiu de reconectar,
  //      envio/recepção nunca conectou) → `force`, e o
  //      provedor que falhou fica de fora (`failed`). Se nenhum subir, aí sim
  //      a pessoa sai da call com um aviso — antes ficava numa call muda.
  // Se a troca falhar, tenta o próximo da cadeia (até 3), sem deixar a call
  // sem mídia: antes, uma troca que falhava derrubava a mídia atual e não
  // subia nada no lugar.
  const switchingRef = useRef(false);
  const pendingSwapRef = useRef(null);
  const runSwapCheckRef = useRef(null);
  useEffect(() => {
    if (!callChannelId) return undefined;
    let cancelled = false;
    const POLL_MS = 60000;
    const flushPending = () => {
      const p = pendingSwapRef.current;
      if (!p || cancelled) return;
      pendingSwapRef.current = null;
      runSwapCheckRef.current?.(p);
    };
    const check = async (opts = {}) => {
      if (cancelled) return;
      let force = !!opts.force;
      if (opts.failed) {
        failureMemoryRef.current.mark(opts.failed);
        force = true;
      }
      if (switchingRef.current || joiningChannelIdRef.current) {
        // Já trocando/entrando: guarda o pedido (força prevalece) pra depois.
        const prev = pendingSwapRef.current;
        pendingSwapRef.current = { force: force || !!prev?.force, mediaGone: !!opts.mediaGone || !!prev?.mediaGone };
        // Trocando: o fim da troca roda o pendente. Entrando: tenta de novo já já.
        if (!switchingRef.current) setTimeout(flushPending, 1000);
        return;
      }
      const current = callRef.current;
      if (!current || current.channelId !== callChannelId) return;
      switchingRef.current = true;
      let tornDown = !!opts.mediaGone;
      let switched = false;
      const before = activeProviderRef.current;
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          let raw;
          try { raw = await getVoiceJoin(current.channelId, readyProviders()); } catch { raw = null; }
          if (cancelled || callRef.current?.channelId !== current.channelId) return;
          const creds = raw ? readJoinResponse(raw) : null;
          if (!creds) { if (!force) return; await new Promise((r) => { setTimeout(r, 1500); }); continue; }
          const target = creds.provider;
          // O servidor não deveria mandar um provedor que o cliente não sabe usar
          // (mandamos clientReady), mas por garantia ignoramos se vier.
          if (!isClientReady(target)) { if (!tornDown) return; break; }
          if (!force && target === activeProviderRef.current) return; // nada mudou
          setReconnectingProvider(true);
          if (!tornDown) {
            // Derruba a mídia atual (preserva sessão/socket/roster/UI).
            teardownEngine();
            setRemoteAudioStreams({});
            setRemoteScreenAudioStreams({});
            setRemoteVideoStreams({});
            tornDown = true;
          }
          let ok = false;
          try {
            ok = await connectEngineRef.current?.({
              serverId: current.serverId, channelId: current.channelId,
              channelName: current.channelName, channelType: current.channelType,
              provider: target, creds: creds[target], isSwitch: true, quiet: true,
            });
          } catch (err) {
            console.error('[voz] Falha ao trocar de provedor no meio da chamada:', err);
            ok = false;
          }
          if (cancelled) return;
          if (!ok && joinStopRef.current) {
            const why = joinStopRef.current;
            joinStopRef.current = null;
            // Canal cheio / expulso: sai. Sem internet / abortada / limite:
            // não marca o provedor como ruim — espera e tenta de novo.
            if (why === 'channel-full' || why === 'kicked' || why === 'replaced') { tornDown = false; leaveChannelRef.current?.(); return; }
            await new Promise((r) => { setTimeout(r, 3000); });
            if (cancelled || callRef.current?.channelId !== current.channelId) return;
            force = true;
            continue;
          }
          if (ok) {
            switched = true;
            if (isReserveMode(target) && target !== before) {
              useStore.getState().pushNotice('A chamada trocou de provedor para continuar funcionando (modo reserva).');
            }
            break;
          }
          // Esse também não subiu: fora da lista e tenta o próximo da cadeia.
          failureMemoryRef.current.mark(target);
          force = true;
        }
        if (!switched && tornDown && !cancelled && callRef.current?.channelId === current.channelId) {
          useStore.getState().pushNotice('A chamada caiu e não foi possível reconectar. Entre de novo no canal.');
          leaveChannelRef.current?.();
        }
      } finally {
        if (!cancelled) setReconnectingProvider(false);
        switchingRef.current = false;
        if (pendingSwapRef.current && !cancelled) setTimeout(flushPending, 0);
      }
    };
    runSwapCheckRef.current = check;
    // Pedido de recuperação que chegou antes deste efeito montar (logo
    // depois de entrar): roda agora.
    if (pendingSwapRef.current && !switchingRef.current) setTimeout(flushPending, 0);
    const iv = setInterval(() => { check(); }, POLL_MS);
    return () => { cancelled = true; runSwapCheckRef.current = null; clearInterval(iv); };
  }, [callChannelId, teardownEngine, readyProviders]);

  // Recuperação da mídia (ver o efeito acima) — chamada pelos engines.
  useEffect(() => {
    requestMediaRecoveryRef.current = (opts = {}) => {
      if (!callRef.current && !joiningChannelIdRef.current) return;
      if (opts.failed) failureMemoryRef.current.mark(opts.failed);
      const run = runSwapCheckRef.current;
      if (run) { run({ ...opts, force: true }); return; }
      const prev = pendingSwapRef.current;
      pendingSwapRef.current = { force: true, mediaGone: !!opts.mediaGone || !!prev?.mediaGone };
    };
    return () => { requestMediaRecoveryRef.current = null; };
  }, []);

  // Reação imediata ao aviso do servidor: refaz a checagem na hora em vez de
  // esperar o próximo poll. Aviso de OUTRA sala (channelId diferente) não
  // mexe na minha call.
  useEffect(() => {
    if (!socket) return undefined;
    const onProviderChanged = (payload) => {
      const cid = payload && payload.channelId;
      if (cid && cid !== callRef.current?.channelId) return;
      // A sala migrou (todo mundo da call no MESMO provedor) ou a cadeia
      // mudou: o /join diz o provedor certo e a checagem troca se mudou.
      runSwapCheckRef.current?.({});
    };
    socket.on('voice:provider-changed', onProviderChanged);
    return () => { socket.off('voice:provider-changed', onProviderChanged); };
  }, [socket]);

  // ---------- Apertar pra falar (F) ----------
  // Mantém pttEnabled em sincronia com a preferência salva (pode mudar
  // nas Configurações enquanto a chamada está aberta).
  useEffect(() => onVoicePrefsChange((p) => setPttEnabled(p.pushToTalkEnabled === true)), []);
  // Tecla escolhida (KeyboardEvent.code) — reativa: trocar nas Configurações
  // vale na hora, inclusive pro apertar-pra-falar global do app de PC.
  const [pttKey, setPttKey] = useState(() => getVoicePref('pushToTalkKey') || 'Space');
  useEffect(() => onVoicePrefsChange((p) => setPttKey(p.pushToTalkKey || 'Space')), []);
  const pttGlobalNoticeRef = useRef(false);

  // Enquanto o "apertar pra falar" está ligado e você está numa chamada,
  // o microfone fica fechado por padrão e só vai ao ar enquanto a tecla
  // escolhida está pressionada (portão do engine — setMicGate). Ao desligar
  // o modo, volta pro estado normal (aberto, a não ser que você tenha mutado
  // na mão). Provedor sem portão (Jitsi/LiveKit): fica desligado.
  // Preferências de sensibilidade (Configurações → Voz e vídeo) — reativas.
  const sensitivityAuto = useExtra('sensitivityAuto');
  const sensitivityDb = useExtra('sensitivityDb');
  const inputVolume = useExtra('inputVolume');
  const [pttReleaseMs, setPttReleaseMs] = useState(() => pttReleaseFromPrefs(getVoicePref('pushToTalkReleaseMs')));
  useEffect(() => onVoicePrefsChange((p) => setPttReleaseMs(pttReleaseFromPrefs(p.pushToTalkReleaseMs))), []);
  useEffect(() => {
    if (!callChannelId) return;
    applyEngineMicConfig();
  }, [callChannelId, provider, pttEnabled, sensitivityAuto, sensitivityDb, inputVolume, pttReleaseMs, applyEngineMicConfig]);

  // Tecla do apertar-pra-falar: o portão (com 200ms de folga ao soltar) é do
  // engine (setPushToTalk/setPttPressed). Aqui: teclado, som e o "mudo" que
  // os outros veem. Engine sem PTT (Jitsi/LiveKit): fica desligado.
  useEffect(() => {
    if (!callChannelId) return undefined;
    const supported = () => typeof engineRef.current?.setPttPressed === 'function';
    const setTalking = (on) => {
      if (pttTalkingRef.current === on) return;
      pttTalkingRef.current = on;
      setPttTalking(on);
      playSound(on ? 'pttActivate' : 'pttDeactivate', 0.3);
      try { engineRef.current?.setPttPressed?.(on); } catch { /* engine trocou */ }
      // Os outros veem seu mudo refletir a tecla (igual a mutar/desmutar).
      socket?.emit('voice:state', { channelId: callChannelId, muted: !on || mutedRef.current });
      if (!on) socket?.emit('voice:speaking', { channelId: callChannelId, speaking: false });
    };
    if (!pttEnabled || !supported()) {
      // Fora do modo: vale o mudo manual.
      if (pttTalkingRef.current) {
        pttTalkingRef.current = false;
        setPttTalking(false);
        if (!mutedRef.current) socket?.emit('voice:state', { channelId: callChannelId, muted: false });
      }
      return undefined;
    }
    // Entrou no modo: o engine fecha o mic até segurar a tecla.
    try { engineRef.current?.setPttPressed?.(false); } catch { /* ok */ }
    socket?.emit('voice:state', { channelId: callChannelId, muted: true });

    const key = pttKey || 'Space';
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
    // App de PC (Electron): a mesma tecla funciona com o app FORA de foco
    // (desktop/globalPtt.js → ptt:down/ptt:up). Com o app em foco quem manda
    // é o teclado acima; o processo principal nem envia o down nesse caso.
    const gptt = typeof window !== 'undefined' ? window.electronAPI?.globalPtt : null;
    const offGlobal = [];
    if (gptt?.configure) {
      offGlobal.push(gptt.onDown?.(() => { if (!micMissing) setTalking(true); }));
      offGlobal.push(gptt.onUp?.(() => setTalking(false)));
      gptt.configure({ enabled: true, code: key, prompt: !pttGlobalNoticeRef.current }).then((r) => {
        if (r?.ok || pttGlobalNoticeRef.current) return;
        pttGlobalNoticeRef.current = true;
        if (r?.reason === 'accessibility') useStore.getState().pushNotice('Para o apertar-pra-falar funcionar com o app em segundo plano, permita o Project Club em Ajustes do Sistema → Privacidade e Segurança → Acessibilidade.');
        else if (r?.reason === 'unsupported-key') useStore.getState().pushNotice('Essa tecla só funciona com o app em foco. Escolha outra para usar o apertar-pra-falar em segundo plano.');
      }).catch(() => {});
    }
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      offGlobal.forEach((off) => { try { off?.(); } catch { /* ok */ } });
      if (gptt?.configure) gptt.configure({ enabled: false }).catch(() => {});
    };
  }, [pttEnabled, pttKey, callChannelId, micMissing, socket, provider]);

  // ---------- Nível do microfone + sensibilidade de entrada ----------
  // Medidos NO ENGINE (pipeline único do mic, voice/micPipeline.js): ele
  // manda onLocalLevel (~10/s) — que liga o aviso "microfone sem som"
  // (getMicLastSoundAt) — e aplica a sensibilidade escolhida
  // (applyEngineMicConfig). Se o navegador não deixar o Web Audio rodar, o
  // portão por voz fica sempre aberto (nunca muda a pessoa sem saber).

  // ---------- Aviso "sua conexão está instável" (D) ----------
  // Só pra VOCÊ: quando a sua qualidade de rede (0-6) fica ruim
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

  // Desmontagem: NADA aqui pode lançar (um erro na limpeza do React deixa
  // mídia/elementos vivos). leaveChannel é assíncrona: a rejeição é engolida.
  useEffect(() => () => {
    try {
      if (callRef.current) {
        const p = (leaveChannelRef.current || leaveChannel)();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch { /* desmontando */ }
    try { if (syncTimerRef.current) clearTimeout(syncTimerRef.current); } catch { /* ok */ }
    try { jitsiHostRef.current?.parentNode?.removeChild(jitsiHostRef.current); } catch { /* ok */ }
    jitsiHostRef.current = null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Painel "Voz conectada": estado em texto, ping e perda no envio.
  const connectionInfo = useMemo(() => {
    if (!call && !joiningChannelId) return null;
    let state = 'connected';
    if (reconnecting) state = reconnecting.offline ? 'offline' : 'reconnecting';
    else if (!call || reconnectingProvider) state = 'connecting';
    const LABELS = { connecting: 'Conectando', connected: 'Conectado', reconnecting: 'Reconectando', offline: 'Sem internet' };
    return { state, label: LABELS[state], ping: myRtt, sendLoss: connStats?.sendLoss ?? null, provider };
  }, [call, joiningChannelId, reconnecting, reconnectingProvider, myRtt, connStats, provider]);

  // Bytes de áudio recebidos de uma pessoa (pro AudioSink perceber "bytes
  // chegando mas nada tocando" e pro diagnóstico). null = desconhecido.
  const getInboundAudioBytes = useCallback((uid) => {
    try {
      const v = engineRef.current?.getInboundAudioBytes?.(uid);
      return Number.isFinite(v) ? v : null;
    } catch { return null; }
  }, []);

  return (
    <VoiceContext.Provider value={{
      call, muted, micMissing, deafened, cameraOn, screenOn, participants: shownParticipants, roster, rosterStartedAt, rosterSpeaking, myRole, handsRaised,
      // Mudo/ensurdecer da moderação (servidor) e as ações de moderação.
      serverMuted: serverMod.serverMuted, serverDeafened: serverMod.serverDeafened,
      serverMuteMember, serverDeafenMember, moveMember, disconnectMember,
      subscribeMicLevel,
      localSpeaking, joiningChannelId,
      remoteCameraStreams, remoteScreenStreams, remoteAudioStreams, volumes, getInboundAudioBytes,
      // Som da tela separado da voz + volume próprio por pessoa.
      remoteScreenAudioStreams, streamVolumes, setStreamVolume,
      reportVideoViewport, connectionInfo,
      // Auto-retrato local (MediaStream devolvido pelo engine).
      localCameraStream: engineLocalCameraStream,
      localScreenStream: engineLocalScreenStream,
      joinChannel, leaveChannel, toggleMute, toggleDeafen, toggleCamera, toggleScreenShare, setParticipantVolume,
      raiseHand, setParticipantRole, stepDownFromStage,
      incomingCall, answerIncomingCall, declineIncomingCall,
      switchMicrophone,
      // Sem medidor de nível rodando, null (o aviso "microfone sem som" fica desligado).
      netQuality, getMicLastSoundAt: micMeterOn ? () => localSoundAtRef.current : null,
      // Faixa do microfone (MediaStreamTrack) — pra gravação local da call.
      getLocalMicTrack: () => engineRef.current?.getLocalMicTrack?.() || null,
      myRtt, callStartedAt, screenQuality, setScreenShareQuality,
      // Extras novos:
      reactions, sendReaction,
      recording, recordingPrompt, recordingConsents, requestRecording, respondRecording, stopRecording,
      pttEnabled, pttTalking,
      setNoiseReduction,
      setNoiseQuality,
      // Provedor de mídia ATIVO na cadeia (projectclub / livekit / jitsi / ...).
      // fallbackActive = provedor depois do primário (servidor próprio).
      provider, fallbackActive: isReserveMode(provider), reconnectingProvider,
      reconnecting,
      providerLabel: providerLabel(provider),
      jitsiNode, attachJitsi, detachJitsi,
    }}
    >
      {children}
    </VoiceContext.Provider>
  );
}

export function useVoice() {
  return useContext(VoiceContext);
}
