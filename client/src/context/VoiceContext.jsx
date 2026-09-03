import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useSocket } from './SocketContext.jsx';
import { useStore } from '../store/useStore';
import { playSound } from '../utils/sounds';
import { getPreferredMicId, setPreferredMicId } from '../utils/audioDevices';
import { getAgoraToken } from '../api/endpoints';
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

// Pede um token novo e fresco pro Agora sempre que vai entrar numa
// chamada — nunca reaproveita um token velho (ver server/src/services/
// agoraToken.js, expira em 24h, mas o hábito certo é sempre pedir um
// novo na hora de entrar).
async function fetchAgoraToken(channelName) {
  const { token, appId } = await getAgoraToken(channelName);
  return { token, appId };
}

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
  const [myRole, setMyRole] = useState('speaker');
  const [handsRaised, setHandsRaised] = useState({});
  const [participants, setParticipants] = useState({});
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [remoteCameraStreams, setRemoteCameraStreams] = useState({});
  const [remoteScreenStreams, setRemoteScreenStreams] = useState({});
  const [remoteAudioStreams, setRemoteAudioStreams] = useState({});
  const [volumes, setVolumes] = useState({});
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

  const broadcastState = useCallback((patch) => {
    if (!socket || !callRef.current) return;
    socket.emit('voice:state', { channelId: callRef.current.channelId, ...patch });
  }, [socket]);

  const setupAgoraClient = useCallback(async () => {
    const AgoraRTC = await loadAgoraRTC();
    const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

    client.on('user-published', async (remoteUser, mediaType) => {
      try {
        await client.subscribe(remoteUser, mediaType);
      } catch (err) {
        console.error('[voz] Falha ao se inscrever na mídia de', remoteUser.uid, err);
        return;
      }
      const uid = String(remoteUser.uid);
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
        const isScreen = useStore.getState().voiceParticipantsSnapshot?.[uid]?.screenSharing;
        if (isScreen) setRemoteScreenStreams((s) => ({ ...s, [uid]: mediaStream }));
        else setRemoteCameraStreams((s) => ({ ...s, [uid]: mediaStream }));
      }
    });

    client.on('user-unpublished', (remoteUser, mediaType) => {
      const uid = String(remoteUser.uid);
      if (mediaType === 'audio') {
        setRemoteAudioStreams((s) => { const n = { ...s }; delete n[uid]; return n; });
      } else if (mediaType === 'video') {
        setRemoteCameraStreams((s) => { const n = { ...s }; delete n[uid]; return n; });
        setRemoteScreenStreams((s) => { const n = { ...s }; delete n[uid]; return n; });
      }
    });

    client.on('user-left', (remoteUser) => {
      const uid = String(remoteUser.uid);
      setRemoteAudioStreams((s) => { const n = { ...s }; delete n[uid]; return n; });
      setRemoteCameraStreams((s) => { const n = { ...s }; delete n[uid]; return n; });
      setRemoteScreenStreams((s) => { const n = { ...s }; delete n[uid]; return n; });
    });

    client.enableAudioVolumeIndicator();
    client.on('volume-indicator', (list) => {
      list.forEach(({ uid, level }) => {
        const speaking = level > 15;
        const uidStr = String(uid);
        if (uidStr === String(user?.id)) {
          setLocalSpeaking((prev) => {
            if (prev !== speaking) socket?.emit('voice:speaking', { channelId: callRef.current?.channelId, speaking });
            return speaking;
          });
        } else {
          setParticipants((s) => (s[uidStr] ? { ...s, [uidStr]: { ...s[uidStr], speaking } } : s));
        }
      });
    });

    agoraClientRef.current = client;
    return client;
  }, [socket, user?.id]);

  useEffect(() => {
    useStore.setState({ voiceParticipantsSnapshot: participants });
  }, [participants]);

  const connectMicrophone = useCallback(async () => {
    const AgoraRTC = await loadAgoraRTC();
    const preferredId = getPreferredMicId();
    const baseConfig = {
      AEC: true, ANS: true, AGC: true,
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

  const joinChannel = useCallback(async (serverId, channelId, channelName, channelType) => {
    if (callRef.current?.channelId === channelId) return;
    if (joiningChannelIdRef.current === channelId) return;
    joiningChannelIdRef.current = channelId;
    setJoiningChannelId(channelId);
    try {
      if (callRef.current) await leaveChannel();

      // Item pedido: "tem um delay pra entrar no canal de voz, corrija
      // aumentando a velocidade" — achei a causa real: pedir o token
      // (chamada pro NOSSO servidor) e carregar o SDK do Agora
      // (~1.5MB na primeira vez da sessão, ver loadAgoraRTC() acima)
      // rodavam um DEPOIS do outro, quando são completamente
      // independentes um do outro — nenhum precisa esperar o outro
      // terminar pra começar. Rodando os dois AO MESMO TEMPO (Promise.
      // all), o tempo total passa a ser só o do mais lento dos dois,
      // não a SOMA dos dois.
      const [{ token, appId }, client] = await Promise.all([
        fetchAgoraToken(channelId).catch((err) => {
          console.error('[voz] Falha ao pedir token do Agora:', err);
          return {};
        }),
        setupAgoraClient(),
      ]);
      if (!token || !appId) {
        useStore.getState().pushNotice('Não foi possível conectar à chamada de voz agora. Tente de novo em instantes.');
        return;
      }
      if (joiningChannelIdRef.current !== channelId) return;

      // Mesmo raciocínio de cima: entrar no canal (rede, Agora) e pedir
      // acesso ao microfone (permissão do sistema/navegador) também são
      // independentes — rodando junto em vez de um depois do outro,
      // corta ainda mais o tempo total até a pessoa realmente estar na
      // call.
      const [, gotMic] = await Promise.all([
        client.join(appId, channelId, token, user.id),
        connectMicrophone(),
      ]);
      if (joiningChannelIdRef.current !== channelId) { await client.leave(); return; }
      if (!gotMic) {
        useStore.getState().pushNotice('Microfone não encontrado. Você entrou no canal mudo — conecte um microfone e toque no botão de mudo para ativá-lo.');
        setMicMissing(true);
        setMuted(true);
      } else {
        await client.publish([localAudioTrackRef.current]);
      }

      const next = { serverId, channelId, channelName, channelType };
      setCall(next);
      callRef.current = next;
      setMyRole('speaker');
      socket?.emit('voice:join', { channelId });
      playSound('callJoin');
      startCallForegroundService(channelName);
      setIncomingCall((c) => (c && c.channelId === channelId ? null : c));
    } finally {
      if (joiningChannelIdRef.current === channelId) joiningChannelIdRef.current = null;
      setJoiningChannelId((c) => (c === channelId ? null : c));
    }
  }, [socket, connectMicrophone, setupAgoraClient, user?.id]);

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
    Object.values(soundboardAudiosRef.current).forEach((el) => { el.pause(); el.src = ''; });
    soundboardAudiosRef.current = {};

    try {
      if (agoraClientRef.current) await agoraClientRef.current.leave();
    } catch { /* já desconectado — ok */ }
    localAudioTrackRef.current?.close();
    cameraTrackRef.current?.close();
    screenTrackRef.current?.close();
    screenAudioTrackRef.current?.close();
    localAudioTrackRef.current = null;
    cameraTrackRef.current = null;
    screenTrackRef.current = null;
    screenAudioTrackRef.current = null;
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
    setRemoteCameraStreams({});
    setRemoteScreenStreams({});
    setLocalSpeaking(false);
    forceLocalVideoTick((n) => n + 1);
  }, [socket]);
  useEffect(() => { leaveChannelRef.current = leaveChannel; }, [leaveChannel]);

  const toggleMute = useCallback(async () => {
    if (toggleMuteBusyRef.current) return;
    toggleMuteBusyRef.current = true;
    try {
    if (callRef.current?.channelType === 'STAGE' && myRole === 'audience') return;
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
    const track = await AgoraRTC.createCameraVideoTrack({ encoderConfig: '360p' });
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
      const { quality = '1080p', frameRate = 30 } = options;
      const dims = QUALITY_PRESETS[quality] || QUALITY_PRESETS['1080p'];
      try {
        const AgoraRTC = await loadAgoraRTC();
        const result = await AgoraRTC.createScreenVideoTrack({
          encoderConfig: { width: dims.width, height: dims.height, frameRate },
          // BUG CORRIGIDO ("compartilhar tela demora pra carregar e fica
          // com pouco FPS"): 'detail' pede pro Agora priorizar NITIDEZ da
          // imagem em cima de fluidez de movimento — ótimo pra
          // compartilhar uma planilha parada, péssimo pra qualquer coisa
          // com movimento (jogo, vídeo, cursor se mexendo), que é onde o
          // "pouco FPS" mais aparece. 'motion' inverte a prioridade —
          // sacrifica um pouco de nitidez em cenas muito detalhadas em
          // troca de manter os quadros por segundo pedidos (frameRate
          // acima) de verdade, que é o que a pessoa realmente sente como
          // "travando" ou não.
          optimizationMode: 'motion',
        }, 'auto');
        const [screenTrack, screenAudioTrack] = Array.isArray(result) ? result : [result, null];
        screenTrackRef.current = screenTrack;
        screenAudioTrackRef.current = screenAudioTrack || null;
        const toPublish = [screenTrack, screenAudioTrack].filter(Boolean);
        await client.publish(toPublish);
        screenTrack.on('track-ended', () => toggleScreenShare());
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

  const setParticipantVolume = useCallback((userId, volume) => {
    setVolumes((s) => ({ ...s, [userId]: volume }));
    const ru = agoraClientRef.current?.remoteUsers.find((r) => String(r.uid) === String(userId));
    ru?.audioTrack?.setVolume(Math.round(volume * 100));
  }, []);

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

  useEffect(() => {
    if (!socket) return;

    const onJoined = ({ channelId, participants: existing, myRole: role }) => {
      if (callRef.current?.channelId !== channelId) return;
      const map = {};
      existing.forEach((p) => { map[p.userId] = p; });
      setParticipants(map);
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
      setParticipants((s) => ({ ...s, [userId]: { muted: role === 'audience', deafened: false, video: false, screenSharing: false, role } }));
    };
    const onUserLeft = ({ channelId, userId }) => {
      if (callRef.current?.channelId !== channelId) return;
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
        } else if (role === 'speaker' && !deafened) {
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
    const onSoundboardPlay = ({ channelId, sound }) => {
      if (callRef.current?.channelId !== channelId || deafened) return;
      try {
        const previous = soundboardAudiosRef.current[sound.id];
        if (previous) { previous.pause(); previous.src = ''; }
        const el = new Audio();
        el.volume = 0.7;
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
      joinChannel(callRef.current.serverId, channelId, channelName, 'VOICE');
    };

    let sawDisconnect = false;
    const onSocketDisconnect = () => { sawDisconnect = true; };
    const onSocketConnect = () => {
      if (!sawDisconnect) return;
      sawDisconnect = false;
      const current = callRef.current;
      if (!current) return;
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
    socket.on('dm-call:ringing', onDmCallRinging);
    socket.on('dm-call:declined', onDmCallDeclined);
    socket.on('dm-call:ended', onDmCallEnded);
    socket.on('voice:afk-move', onAfkMove);
    socket.on('connect', onSocketConnect);
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
      socket.off('dm-call:ringing', onDmCallRinging);
      socket.off('dm-call:declined', onDmCallDeclined);
      socket.off('dm-call:ended', onDmCallEnded);
      socket.off('voice:afk-move', onAfkMove);
      socket.off('connect', onSocketConnect);
      socket.off('disconnect', onSocketDisconnect);
    };
  }, [socket, user?.id, deafened, joinChannel]);

  useEffect(() => () => { if (callRef.current) leaveChannel(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <VoiceContext.Provider value={{
      call, muted, micMissing, deafened, cameraOn, screenOn, participants, roster, rosterStartedAt, rosterSpeaking, myRole, handsRaised,
      localSpeaking, joiningChannelId,
      remoteCameraStreams, remoteScreenStreams, remoteAudioStreams, volumes,
      localCameraStream: cameraTrackRef.current ? new MediaStream([cameraTrackRef.current.getMediaStreamTrack()]) : null,
      localScreenStream: screenTrackRef.current ? new MediaStream([screenTrackRef.current.getMediaStreamTrack()]) : null,
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
