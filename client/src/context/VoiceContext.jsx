import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AgoraRTC from 'agora-rtc-sdk-ng';
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

let ForegroundServicePlugin = null;
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
  const leaveChannelRef = useRef(null);
  const soundboardAudiosRef = useRef({});

  const agoraClientRef = useRef(null);
  const localAudioTrackRef = useRef(null);
  const cameraTrackRef = useRef(null);
  const screenTrackRef = useRef(null);
  const screenAudioTrackRef = useRef(null);
  const deafenedRef = useRef(false);
  useEffect(() => { deafenedRef.current = deafened; }, [deafened]);

  const broadcastState = useCallback((patch) => {
    if (!socket || !callRef.current) return;
    socket.emit('voice:state', { channelId: callRef.current.channelId, ...patch });
  }, [socket]);

  const setupAgoraClient = useCallback(() => {
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
        const mediaStream = new MediaStream([remoteUser.audioTrack.getMediaStreamTrack()]);
        setRemoteAudioStreams((s) => ({ ...s, [uid]: mediaStream }));
        if (!deafenedRef.current) remoteUser.audioTrack.play();
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
    try {
      const preferredId = getPreferredMicId();
      const track = await AgoraRTC.createMicrophoneAudioTrack({
        microphoneId: preferredId || undefined,
        AEC: true, ANS: true, AGC: true,
      });
      localAudioTrackRef.current = track;
      return true;
    } catch (err) {
      console.error('[voz] Não foi possível acessar o microfone:', err);
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
    try {
      if (callRef.current) await leaveChannel();

      const { token, appId } = await fetchAgoraToken(channelId).catch((err) => {
        console.error('[voz] Falha ao pedir token do Agora:', err);
        return {};
      });
      if (!token || !appId) {
        useStore.getState().pushNotice('Não foi possível conectar à chamada de voz agora. Tente de novo em instantes.');
        return;
      }
      if (joiningChannelIdRef.current !== channelId) return;

      const client = setupAgoraClient();
      await client.join(appId, channelId, token, user.id);
      if (joiningChannelIdRef.current !== channelId) { await client.leave(); return; }

      const gotMic = await connectMicrophone();
      if (joiningChannelIdRef.current !== channelId) return;
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
  }, [broadcastState, myRole, muted, connectMicrophone]);

  const toggleDeafen = useCallback(() => {
    setDeafened((prev) => {
      const next = !prev;
      if (next && localAudioTrackRef.current) {
        localAudioTrackRef.current.setEnabled(false);
        setMuted(true);
      }
      agoraClientRef.current?.remoteUsers.forEach((ru) => {
        if (ru.audioTrack) { if (next) ru.audioTrack.stop(); else ru.audioTrack.play(); }
      });
      broadcastState({ deafened: next, muted: next ? true : muted });
      return next;
    });
  }, [broadcastState, muted]);

  const toggleCamera = useCallback(async () => {
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
    try {
      const track = await AgoraRTC.createCameraVideoTrack({ encoderConfig: '360p' });
      cameraTrackRef.current = track;
      await client.publish([track]);
      setCameraOn(true);
      broadcastState({ video: true });
      forceLocalVideoTick((n) => n + 1);
    } catch (err) {
      useStore.getState().pushNotice('Não foi possível acessar a câmera.');
    }
  }, [cameraOn, broadcastState]);

  const toggleScreenShare = useCallback(async (options = {}) => {
    const client = agoraClientRef.current;
    if (!client) return;
    if (screenOn) {
      const tracks = [screenTrackRef.current, screenAudioTrackRef.current].filter(Boolean);
      await client.unpublish(tracks).catch(() => {});
      screenTrackRef.current?.close();
      screenAudioTrackRef.current?.close();
      screenTrackRef.current = null;
      screenAudioTrackRef.current = null;
      setScreenOn(false);
      broadcastState({ screenSharing: false });
      forceLocalVideoTick((n) => n + 1);
      return;
    }
    const isNativeApp = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
    if (isNativeApp) {
      useStore.getState().pushNotice('Compartilhar tela ainda não é possível pelo app Android — use pelo navegador (Chrome) por enquanto.');
      return;
    }
    const { quality = '1080p', frameRate = 30 } = options;
    const dims = QUALITY_PRESETS[quality] || QUALITY_PRESETS['1080p'];
    try {
      const result = await AgoraRTC.createScreenVideoTrack({
        encoderConfig: { width: dims.width, height: dims.height, frameRate },
        optimizationMode: 'detail',
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
      localSpeaking,
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
